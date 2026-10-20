import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { geminiGenerate } from "./gemini";
import { getGuideData, GUIDE_SECTIONS, type GuideData } from "./guide-bot";
import { listGuidePhotos } from "./guide-photos";
import { getSetting, setSetting, tryLock, unlock } from "./settings";

// 손님용 다국어 안내 페이지(/guide/<링크 코드>). 사장님이 한국어로 채운 정보를 Gemini 로 언어마다 번역해 저장해 두고,
// 정보가 바뀌면(원문 해시가 달라지면) 그 언어를 다시 번역할 때까지 한국어로 보여 준다.

export const GUIDE_LANGS = ["ko", "en", "ja", "zh-CN", "zh-TW"] as const;
export type GuideLang = (typeof GUIDE_LANGS)[number];
export const LANG_NAMES: Record<GuideLang, string> = { ko: "한국어", en: "English", ja: "日本語", "zh-CN": "简体中文", "zh-TW": "繁體中文" };
const LANG_FOR_MODEL: Record<GuideLang, string> = { ko: "Korean", en: "English", ja: "Japanese", "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese (Taiwan)" };

// detail: 사진 속 글·표시를 Gemini 가 읽어 둔 설명. 사진 속 글이 한국어라 손님 언어로 옮겨 사진 아래 보여 준다.
export interface GuidePhotoRef { id: string; field: string | null; caption: string; detail: string | null }

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
  return contentFromData(data, photos.map((p) => ({ id: p.id, field: p.field, caption: p.caption, detail: p.aiText })));
}

// 번역할 글만 뽑는다. key·id 는 번역 뒤 순서대로 다시 붙인다.
function translatable(c: GuideContent) {
  return {
    sections: c.sections.map((s) => ({ title: s.title, items: s.items.map((i) => ({ label: i.label, value: i.value })) })),
    faq: c.faq,
    photos: c.photos.map((p) => ({ caption: p.caption, detail: p.detail ?? "" })),
  };
}

const TRANSLATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          items: { type: "ARRAY", items: { type: "OBJECT", properties: { label: { type: "STRING" }, value: { type: "STRING" } }, required: ["label", "value"] } },
        },
        required: ["title", "items"],
      },
    },
    faq: { type: "ARRAY", items: { type: "OBJECT", properties: { q: { type: "STRING" }, a: { type: "STRING" } }, required: ["q", "a"] } },
    photos: { type: "ARRAY", items: { type: "OBJECT", properties: { caption: { type: "STRING" }, detail: { type: "STRING" } }, required: ["caption", "detail"] } },
  },
  required: ["sections", "faq", "photos"],
};

export function mergeTranslation(ko: GuideContent, t: ReturnType<typeof translatable>): GuideContent {
  if (!Array.isArray(t.sections) || t.sections.length !== ko.sections.length) throw new Error("모양이 다름");
  return {
    name: ko.name,
    sections: ko.sections.map((s, i) => ({
      title: t.sections[i]?.title || s.title,
      items: s.items.map((it, j) => ({ key: it.key, label: t.sections[i]?.items?.[j]?.label || it.label, value: t.sections[i]?.items?.[j]?.value || it.value })),
    })),
    faq: ko.faq.map((f, i) => ({ q: t.faq?.[i]?.q || f.q, a: t.faq?.[i]?.a || f.a })),
    photos: ko.photos.map((p, i) => ({
      ...p,
      caption: t.photos?.[i]?.caption || p.caption,
      detail: p.detail ? t.photos?.[i]?.detail || p.detail : null,
    })),
  };
}

export function contentHash(c: GuideContent): string {
  return createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16);
}

// 언어마다 어떤 원문으로 번역했는지(source) 따로 둔다. 한 언어가 실패해도 다른 언어 번역은 그대로 쓴다.
interface Stored { langs: Partial<Record<GuideLang, { source: string; content: GuideContent }>> }
const I18N_KEY = "guide_bot_i18n_v2";
const TARGETS = GUIDE_LANGS.filter((l) => l !== "ko");

async function getStored(sql: postgres.Sql): Promise<Stored> {
  const raw = await getSetting(sql, I18N_KEY);
  try {
    const v = raw ? (JSON.parse(raw) as Stored) : null;
    return v?.langs ? v : { langs: {} };
  } catch {
    return { langs: {} };
  }
}

// 그 언어 번역이 지금 정보와 맞으면 번역본, 아니면 한국어 원문 (needsTranslation 이면 호출한 쪽이 번역을 시작한다).
export async function getGuideContent(sql: postgres.Sql, lang: GuideLang): Promise<{ content: GuideContent; translated: boolean }> {
  const ko = await koContent(sql);
  if (lang === "ko") return { content: ko, translated: true };
  const t = (await getStored(sql)).langs[lang];
  return t?.source === contentHash(ko) ? { content: t.content, translated: true } : { content: ko, translated: false };
}

export async function translationStatus(sql: postgres.Sql): Promise<{ done: GuideLang[]; missing: GuideLang[] }> {
  const hash = contentHash(await koContent(sql));
  const stored = await getStored(sql);
  const done = TARGETS.filter((l) => stored.langs[l]?.source === hash);
  return { done, missing: TARGETS.filter((l) => !done.includes(l)) };
}

// 지금 정보와 맞지 않는 언어만 하나씩 번역한다 (무료 한도에 걸리지 않게 동시에 보내지 않는다).
export async function translateGuide(sql: postgres.Sql, opts: { force?: boolean } = {}): Promise<{ ok: GuideLang[]; failed: GuideLang[]; error?: string }> {
  const ok: GuideLang[] = [];
  const failed: GuideLang[] = [];
  let error: string | undefined;
  if (!(await tryLock(sql, "guide_translate_lock", 5))) return { ok, failed, error: "이미 번역하는 중이에요" };
  try {
    const ko = await koContent(sql);
    const source = contentHash(ko);
    for (const lang of TARGETS) {
      const stored = await getStored(sql);
      if (!opts.force && stored.langs[lang]?.source === source) {
        ok.push(lang);
        continue;
      }
      try {
        const text = await geminiGenerate(sql, {
          system:
            `Translate this Korean guesthouse guide JSON into ${LANG_FOR_MODEL[lang]} for foreign guests. ` +
            "Keep exactly the same structure, order and number of items. Translate every string completely, including section titles, labels, photo captions and photo details; no Korean may remain except proper nouns. " +
            "For station, shop and place names give the local reading plus the Korean name in parentheses when helpful. " +
            "Keep times, numbers, and addresses as they are. Empty strings stay empty.",
          turns: [{ role: "user", text: JSON.stringify(translatable(ko)) }],
          schema: TRANSLATION_SCHEMA,
          maxTokens: 32768,
          timeoutMs: 60_000,
        });
        const content = mergeTranslation(ko, JSON.parse(text));
        // 언어마다 바로 저장해서, 중간에 시간이 다 돼도 끝난 언어는 남긴다
        const latest = await getStored(sql);
        latest.langs[lang] = { source, content };
        await setSetting(sql, I18N_KEY, JSON.stringify(latest));
        ok.push(lang);
      } catch (e) {
        console.error("guide translate", lang, e);
        failed.push(lang);
        error ??= e instanceof Error ? e.message : String(e);
      }
    }
  } finally {
    await unlock(sql, "guide_translate_lock");
  }
  return { ok, failed, error };
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
export const UI: Record<GuideLang, { title: string; ask: string; placeholder: string; send: string; thinking: string; error: string; limit: string; note: string; monitored: string; faq: string; photos: string; more: string; greeting: string; pending: string; empty: string }> = {
  ko: { title: "숙소 안내", ask: "궁금한 점을 물어보세요", placeholder: "예: 체크아웃 시간이 언제예요?", send: "보내기", thinking: "답변을 쓰는 중…", error: "답변을 가져오지 못했어요. 잠시 뒤 다시 시도하거나 예약한 사이트의 메시지로 호스트에게 물어봐 주세요.", limit: "질문이 너무 많아 잠시 쉬어요. 급하면 예약한 사이트의 메시지로 호스트에게 연락해 주세요.", note: "AI 안내 도우미가 사장님이 입력한 숙소 정보를 바탕으로 답해요. 확실하지 않으면 호스트에게 물어봐 주세요.", monitored: "호스트가 대화 내용을 볼 수 있으며 30일 뒤 지워져요.", faq: "자주 묻는 질문", photos: "사진 안내", more: "숙소 안내 전체 보기", greeting: "안녕하세요! 숙소 이용에 궁금한 점을 편하게 물어보세요. 체크인, 와이파이, 쓰레기 버리는 법, 주변 맛집 등 무엇이든 좋아요.", pending: "", empty: "아직 안내 정보가 준비되지 않았어요." },
  en: { title: "Guest guide", ask: "Ask us anything", placeholder: "e.g. What time is check-out?", send: "Send", thinking: "Writing an answer…", error: "Couldn't get an answer. Please try again shortly, or message the host on the site you booked with.", limit: "Too many questions right now. If it's urgent, please message the host on the site you booked with.", note: "Our AI guide answers from the host's information. If unsure, please ask the host.", monitored: "The host can read this chat; it is deleted after 30 days.", faq: "FAQ", photos: "Photos", more: "See the full guest guide", greeting: "Hi! Ask me anything about your stay: check-in, Wi-Fi, trash, nearby food, and more.", pending: "This page is still being translated, so it is shown in Korean for now. The chat below answers in your language.", empty: "The guide isn't ready yet." },
  ja: { title: "宿泊ガイド", ask: "気になることを質問してください", placeholder: "例：チェックアウトは何時ですか？", send: "送信", thinking: "回答を作成中…", error: "回答を取得できませんでした。しばらくしてから再度お試しいただくか、予約サイトのメッセージでホストにお問い合わせください。", limit: "質問が多いため少しお待ちください。お急ぎの場合は予約サイトのメッセージでホストにご連絡ください。", note: "AIガイドがホストの登録した情報をもとに回答します。不確かな場合はホストにお問い合わせください。", monitored: "ホストはこの会話を確認でき、30日後に削除されます。", faq: "よくある質問", photos: "写真ガイド", more: "宿泊ガイドをすべて見る", greeting: "こんにちは！チェックイン、Wi-Fi、ゴミの出し方、近くのお店など、滞在中の疑問を気軽に聞いてください。", pending: "現在翻訳中のため韓国語で表示しています。下のチャットはご利用の言語で回答します。", empty: "ガイドはまだ準備中です。" },
  "zh-CN": { title: "入住指南", ask: "有问题请随时提问", placeholder: "例如：几点退房？", send: "发送", thinking: "正在回答…", error: "暂时无法回答。请稍后再试，或通过预订网站的消息联系房东。", limit: "提问过多，请稍候。如有急事，请通过预订网站的消息联系房东。", note: "AI 助手根据房东提供的信息回答。如不确定，请联系房东。", monitored: "房东可以查看对话内容，30 天后自动删除。", faq: "常见问题", photos: "图片指南", more: "查看完整入住指南", greeting: "您好！入住、Wi-Fi、垃圾分类、附近美食等，有任何问题都可以问我。", pending: "本页正在翻译中，暂时以韩语显示。下方聊天会用您的语言回答。", empty: "指南尚未准备好。" },
  "zh-TW": { title: "入住指南", ask: "有問題請隨時提問", placeholder: "例如：幾點退房？", send: "送出", thinking: "正在回答…", error: "暫時無法回答。請稍後再試，或透過預訂網站的訊息聯絡房東。", limit: "提問過多，請稍候。如有急事，請透過預訂網站的訊息聯絡房東。", note: "AI 助手根據房東提供的資訊回答。如不確定，請聯絡房東。", monitored: "房東可以查看對話內容，30 天後自動刪除。", faq: "常見問題", photos: "圖片指南", more: "查看完整入住指南", greeting: "您好！入住、Wi-Fi、垃圾分類、附近美食等，有任何問題都可以問我。", pending: "本頁正在翻譯中，暫時以韓文顯示。下方聊天會用您的語言回答。", empty: "指南尚未準備好。" },
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

export const CHAT_REPLY_SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    topic: { type: "STRING", enum: Object.keys(CHAT_TOPICS) },
    known: { type: "BOOLEAN" },
    language: { type: "STRING", enum: [...GUIDE_LANGS, "other"] },
    photos: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["answer", "topic", "known", "language", "photos"],
  propertyOrdering: ["answer", "photos", "topic", "known", "language"],
};

// 모델이 돌려준 JSON 을 믿지 않고 하나씩 확인한다. JSON 이 깨졌으면 answer 와 사진 번호만이라도 건져 낸다.
export function parseChatReply(text: string, photoIds: string[] = []): ChatReply {
  const pickPhotos = (list: unknown[]) => [...new Set(list.map(String))].filter((id) => photoIds.includes(id)).slice(0, 3);
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const answer = typeof v.answer === "string" ? v.answer.trim() : "";
    if (answer) {
      return {
        answer,
        topic: typeof v.topic === "string" && v.topic in CHAT_TOPICS ? (v.topic as ChatTopic) : "other",
        known: v.known !== false,
        language: typeof v.language === "string" && (GUIDE_LANGS as readonly string[]).includes(v.language) ? (v.language as GuideLang) : "other",
        photos: Array.isArray(v.photos) ? pickPhotos(v.photos) : [],
      };
    }
  } catch {
    // 아래에서 건져 낸다
  }
  const m = text.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    let answer = m[1];
    try { answer = JSON.parse(`"${m[1]}"`); } catch { /* 그대로 */ }
    const photosPart = text.match(/"photos"\s*:\s*\[([^\]]*)/)?.[1] ?? "";
    return { answer: answer.trim(), topic: "other", known: true, language: "other", photos: pickPhotos(photosPart.match(/\d+/g) ?? []) };
  }
  return { answer: text.trim(), topic: "other", known: true, language: "other", photos: [] };
}

// 손님이 실제로 쓴 글자로 답할 언어를 정한다. 한자만 있으면 화면에서 고른 중국어(간체·번체)를 따른다.
export function questionLang(text: string, screen: GuideLang): GuideLang {
  if (/[\uac00-\ud7a3]/.test(text)) return "ko";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u4e00-\u9fff]/.test(text)) return screen === "zh-TW" || screen === "zh-CN" ? screen : "zh-CN";
  if (/[a-z]{2,}/i.test(text)) return screen === "ko" || screen === "ja" || screen.startsWith("zh") ? "en" : screen;
  return screen;
}

export const CHAT_REPLY_FORMAT =
  "\n\n출력 형식: JSON 하나만 출력해. " +
  '{"answer": 손님에게 보낼 답(문자열), "topic": 질문 주제, "known": 숙소 정보로 답할 수 있었으면 true·정보가 없어 호스트에게 물어보라고 했으면 false, "language": 손님이 쓴 언어, "photos": 답과 관련된 사진 id 배열(사진 목록에 있는 것만, 없으면 [], 최대 3개)}. ' +
  `topic 은 ${Object.keys(CHAT_TOPICS).join(", ")} 중 하나. language 는 ${GUIDE_LANGS.join(", ")}, other 중 하나 (대만·홍콩 번체는 zh-TW).`;
