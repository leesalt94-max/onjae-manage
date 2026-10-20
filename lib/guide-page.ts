import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { geminiGenerate } from "./gemini";
import { getGuideData, GUIDE_SECTIONS, type GuideData } from "./guide-bot";
import { listGuidePhotos } from "./guide-photos";
import { getSetting, setSetting } from "./settings";

// 손님용 다국어 안내 페이지(/guide/<링크 코드>). 사장님이 한국어로 채운 정보를 Gemini 로 한 번 번역해 저장해 두고,
// 정보가 바뀌면(원문 해시가 달라지면) 다시 번역할 때까지 한국어로 보여 준다.

export const GUIDE_LANGS = ["ko", "en", "ja", "zh-CN", "zh-TW"] as const;
export type GuideLang = (typeof GUIDE_LANGS)[number];
export const LANG_NAMES: Record<GuideLang, string> = { ko: "한국어", en: "English", ja: "日本語", "zh-CN": "简体中文", "zh-TW": "繁體中文" };
const LANG_FOR_MODEL: Record<GuideLang, string> = { ko: "Korean", en: "English", ja: "Japanese", "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese (Taiwan)" };

export interface GuidePhotoRef { id: string; field: string | null; caption: string }

export interface GuideContent {
  name: string;
  sections: { title: string; items: { key: string; label: string; value: string }[] }[];
  faq: { q: string; a: string }[];
  photos: GuidePhotoRef[];
}

export function contentFromData(data: GuideData, photos: GuidePhotoRef[] = []): GuideContent {
  return {
    name: data.answers.name?.trim() ?? "",
    sections: GUIDE_SECTIONS.map((s) => ({
      title: s.title,
      items: s.fields
        .filter((f) => f.key !== "name" && data.answers[f.key]?.trim())
        .map((f) => ({ key: f.key, label: f.label, value: data.answers[f.key].trim() })),
    })).filter((s) => s.items.length),
    faq: data.extras.filter((e) => e.q.trim() && e.a.trim()).map((e) => ({ q: e.q.trim(), a: e.a.trim() })),
    photos,
  };
}

async function koContent(sql: postgres.Sql): Promise<GuideContent> {
  const [data, photos] = await Promise.all([getGuideData(sql), listGuidePhotos(sql)]);
  return contentFromData(data, photos.map((p) => ({ id: p.id, field: p.field, caption: p.caption })));
}

// 번역할 글만 뽑는다. key·id 는 번역 뒤 순서대로 다시 붙인다.
function translatable(c: GuideContent) {
  return {
    sections: c.sections.map((s) => ({ title: s.title, items: s.items.map((i) => ({ label: i.label, value: i.value })) })),
    faq: c.faq,
    photos: c.photos.map((p) => p.caption),
  };
}

export function mergeTranslation(ko: GuideContent, t: ReturnType<typeof translatable>): GuideContent {
  if (!Array.isArray(t.sections) || t.sections.length !== ko.sections.length) throw new Error("모양이 다름");
  return {
    name: ko.name,
    sections: ko.sections.map((s, i) => ({
      title: t.sections[i]?.title || s.title,
      items: s.items.map((it, j) => ({ key: it.key, label: t.sections[i]?.items?.[j]?.label || it.label, value: t.sections[i]?.items?.[j]?.value || it.value })),
    })),
    faq: ko.faq.map((f, i) => ({ q: t.faq?.[i]?.q || f.q, a: t.faq?.[i]?.a || f.a })),
    photos: ko.photos.map((p, i) => ({ ...p, caption: (typeof t.photos?.[i] === "string" && t.photos[i]) || p.caption })),
  };
}

export function contentHash(c: GuideContent): string {
  return createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16);
}

interface Stored { source: string; langs: Partial<Record<GuideLang, GuideContent>> }
const I18N_KEY = "guide_bot_i18n";

async function getStored(sql: postgres.Sql): Promise<Stored | null> {
  const raw = await getSetting(sql, I18N_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Stored; } catch { return null; }
}

// 그 언어 번역이 지금 정보와 맞으면 번역본, 아니면 한국어 원문.
export async function getGuideContent(sql: postgres.Sql, lang: GuideLang): Promise<{ content: GuideContent; translated: boolean }> {
  const ko = await koContent(sql);
  if (lang === "ko") return { content: ko, translated: true };
  const stored = await getStored(sql);
  const t = stored?.source === contentHash(ko) ? stored.langs[lang] : undefined;
  return t ? { content: t, translated: true } : { content: ko, translated: false };
}

export async function translationStatus(sql: postgres.Sql): Promise<"none" | "stale" | "ok"> {
  const ko = await koContent(sql);
  const stored = await getStored(sql);
  if (!stored) return "none";
  return stored.source === contentHash(ko) && GUIDE_LANGS.every((l) => l === "ko" || stored.langs[l]) ? "ok" : "stale";
}

// 지금 정보로 4개 언어 번역을 새로 만든다. 언어마다 따로 불러 한 언어가 실패해도 나머지는 남긴다.
export async function translateGuide(sql: postgres.Sql): Promise<{ ok: GuideLang[]; failed: GuideLang[] }> {
  const ko = await koContent(sql);
  const source = contentHash(ko);
  const langs: Stored["langs"] = {};
  const ok: GuideLang[] = [];
  const failed: GuideLang[] = [];
  await Promise.all(
    GUIDE_LANGS.filter((l) => l !== "ko").map(async (lang) => {
      try {
        const text = await geminiGenerate(sql, {
          system:
            `Translate this Korean guesthouse guide JSON into ${LANG_FOR_MODEL[lang]} for foreign guests. ` +
            "Keep exactly the same JSON shape and order. Translate every string value, including section titles and labels. " +
            "Keep proper nouns (station, shop, place names) recognisable: give the local name plus the Korean name in parentheses when helpful. " +
            "Keep times, numbers, and addresses as they are. Output only the JSON.",
          turns: [{ role: "user", text: JSON.stringify(translatable(ko)) }],
          json: true,
          maxTokens: 8192,
          timeoutMs: 90_000,
        });
        langs[lang] = mergeTranslation(ko, JSON.parse(text));
        ok.push(lang);
      } catch (e) {
        console.error("guide translate", lang, e);
        failed.push(lang);
      }
    }),
  );
  await setSetting(sql, I18N_KEY, JSON.stringify({ source, langs } satisfies Stored));
  return { ok, failed };
}

// 손님에게 보내는 링크 코드. 주소·입구 안내가 들어가므로 아무나 찾아 들어오지 못하게 추측 불가능한 코드로 둔다.
export async function getGuideToken(sql: postgres.Sql, create = false): Promise<string | null> {
  const t = await getSetting(sql, "guide_token");
  if (t || !create) return t;
  return resetGuideToken(sql);
}

export async function resetGuideToken(sql: postgres.Sql): Promise<string> {
  const t = randomBytes(9).toString("base64url");
  await setSetting(sql, "guide_token", t);
  return t;
}

export function pickLang(param: string | undefined, acceptLanguage: string | null): GuideLang {
  if (param && (GUIDE_LANGS as readonly string[]).includes(param)) return param as GuideLang;
  for (const part of (acceptLanguage ?? "").toLowerCase().split(",")) {
    const tag = part.split(";")[0].trim();
    if (tag.startsWith("ko")) return "ko";
    if (tag.startsWith("ja")) return "ja";
    if (tag === "zh-tw" || tag === "zh-hk" || tag === "zh-mo" || tag.startsWith("zh-hant")) return "zh-TW";
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

// 화면 글자 (번역 없이 고정)
export const UI: Record<GuideLang, { title: string; ask: string; placeholder: string; send: string; thinking: string; error: string; limit: string; note: string; monitored: string; faq: string; photos: string; pending: string; empty: string }> = {
  ko: { title: "숙소 안내", ask: "궁금한 점을 물어보세요", placeholder: "예: 체크아웃 시간이 언제예요?", send: "보내기", thinking: "답변을 쓰는 중…", error: "답변을 가져오지 못했어요. 잠시 뒤 다시 시도하거나 예약한 사이트의 메시지로 호스트에게 물어봐 주세요.", limit: "질문이 너무 많아 잠시 쉬어요. 급하면 예약한 사이트의 메시지로 호스트에게 연락해 주세요.", note: "AI 안내 도우미가 위 정보를 바탕으로 답해요. 확실하지 않으면 호스트에게 물어봐 주세요.", monitored: "호스트가 대화 내용을 볼 수 있으며 30일 뒤 지워져요.", faq: "자주 묻는 질문", photos: "사진 안내", pending: "", empty: "아직 안내 정보가 준비되지 않았어요." },
  en: { title: "Guest guide", ask: "Ask us anything", placeholder: "e.g. What time is check-out?", send: "Send", thinking: "Writing an answer…", error: "Couldn't get an answer. Please try again shortly, or message the host on the site you booked with.", limit: "Too many questions right now. If it's urgent, please message the host on the site you booked with.", note: "Our AI guide answers from the information above. If unsure, please ask the host.", monitored: "The host can read this chat; it is deleted after 30 days.", faq: "FAQ", photos: "Photos", pending: "This page is still being translated, so it is shown in Korean for now. The chat below answers in your language.", empty: "The guide isn't ready yet." },
  ja: { title: "宿泊ガイド", ask: "気になることを質問してください", placeholder: "例：チェックアウトは何時ですか？", send: "送信", thinking: "回答を作成中…", error: "回答を取得できませんでした。しばらくしてから再度お試しいただくか、予約サイトのメッセージでホストにお問い合わせください。", limit: "質問が多いため少しお待ちください。お急ぎの場合は予約サイトのメッセージでホストにご連絡ください。", note: "AIガイドが上の情報をもとに回答します。不確かな場合はホストにお問い合わせください。", monitored: "ホストはこの会話を確認でき、30日後に削除されます。", faq: "よくある質問", photos: "写真ガイド", pending: "現在翻訳中のため韓国語で表示しています。下のチャットはご利用の言語で回答します。", empty: "ガイドはまだ準備中です。" },
  "zh-CN": { title: "入住指南", ask: "有问题请随时提问", placeholder: "例如：几点退房？", send: "发送", thinking: "正在回答…", error: "暂时无法回答。请稍后再试，或通过预订网站的消息联系房东。", limit: "提问过多，请稍候。如有急事，请通过预订网站的消息联系房东。", note: "AI 助手根据以上信息回答。如不确定，请联系房东。", monitored: "房东可以查看对话内容，30 天后自动删除。", faq: "常见问题", photos: "图片指南", pending: "本页正在翻译中，暂时以韩语显示。下方聊天会用您的语言回答。", empty: "指南尚未准备好。" },
  "zh-TW": { title: "入住指南", ask: "有問題請隨時提問", placeholder: "例如：幾點退房？", send: "送出", thinking: "正在回答…", error: "暫時無法回答。請稍後再試，或透過預訂網站的訊息聯絡房東。", limit: "提問過多，請稍候。如有急事，請透過預訂網站的訊息聯絡房東。", note: "AI 助手根據以上資訊回答。如不確定，請聯絡房東。", monitored: "房東可以查看對話內容，30 天後自動刪除。", faq: "常見問題", photos: "圖片指南", pending: "本頁正在翻譯中，暫時以韓文顯示。下方聊天會用您的語言回答。", empty: "指南尚未準備好。" },
};

// 챗봇 질문 통계용 주제. 답할 때 Gemini 가 같이 골라 준다.
export const CHAT_TOPICS = {
  checkin: "체크인·체크아웃",
  access: "위치·입구 찾기",
  transport: "교통·공항",
  wifi: "와이파이·전자기기",
  facilities: "시설·비품",
  rules: "규칙·쓰레기",
  luggage: "짐 보관",
  food: "식당·맛집",
  sights: "관광·볼거리",
  shopping: "편의점·약국·쇼핑",
  trouble: "고장·문제",
  booking: "예약·요금·환불",
  other: "기타",
} as const;
export type ChatTopic = keyof typeof CHAT_TOPICS;

export interface ChatReply { answer: string; topic: ChatTopic; known: boolean; language: GuideLang | "other"; photos: string[] }

// 모델이 돌려준 JSON 을 믿지 않고 하나씩 확인한다. JSON 이 아니면 글 전체를 답으로 쓴다.
export function parseChatReply(text: string, photoIds: string[] = []): ChatReply {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const answer = typeof v.answer === "string" ? v.answer.trim() : "";
    if (answer) {
      return {
        answer,
        topic: typeof v.topic === "string" && v.topic in CHAT_TOPICS ? (v.topic as ChatTopic) : "other",
        known: v.known !== false,
        language: typeof v.language === "string" && (GUIDE_LANGS as readonly string[]).includes(v.language) ? (v.language as GuideLang) : "other",
        photos: Array.isArray(v.photos) ? [...new Set(v.photos.map(String))].filter((id) => photoIds.includes(id)).slice(0, 3) : [],
      };
    }
  } catch {
    // 아래로
  }
  return { answer: text.trim(), topic: "other", known: true, language: "other", photos: [] };
}

export const CHAT_REPLY_FORMAT =
  "\n\n출력 형식: 반드시 JSON 하나만 출력해. " +
  '{"answer": 손님에게 보낼 답(문자열), "topic": 질문 주제, "known": 숙소 정보로 답할 수 있었으면 true·정보가 없어 호스트에게 물어보라고 했으면 false, "language": 손님이 쓴 언어, "photos": 답과 관련된 사진 id 배열(사진 목록에 있는 것만, 없으면 [], 최대 3개)}. ' +
  `topic 은 ${Object.keys(CHAT_TOPICS).join(", ")} 중 하나. language 는 ${GUIDE_LANGS.join(", ")}, other 중 하나 (대만·홍콩 번체는 zh-TW).`;
