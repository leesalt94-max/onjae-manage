import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { geminiGenerate } from "@/lib/gemini";
import { buildGemInstructions, getGuideData } from "@/lib/guide-bot";
import { listGuidePhotos } from "@/lib/guide-photos";
import { CHAT_REPLY_FORMAT, getGuideToken, GUIDE_LANGS, LANG_NAMES, parseChatReply } from "@/lib/guide-page";

// 손님 안내 페이지의 채팅. 링크 코드로만 열리고, IP 당 시간 30회·전체 하루 400회까지만 답한다.
// 질문과 답은 사장님이 볼 수 있게 30일 동안 남긴다 (손님 화면에 알림).
export const maxDuration = 60;

const PER_IP_HOUR = 30;
const PER_DAY = 400;

const bodySchema = z.object({
  token: z.string().min(1).max(64),
  convId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  lang: z.enum(GUIDE_LANGS),
  messages: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().trim().min(1).max(600) }))
    .min(1)
    .max(12),
});

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { token, convId, lang, messages } = parsed.data;
  if (messages[messages.length - 1].role !== "user") return NextResponse.json({ error: "bad request" }, { status: 400 });

  const sql = db();
  const expected = await getGuideToken(sql);
  if (!expected || !sameToken(token, expected)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const [{ ipCount, dayCount }] = await sql<{ ipCount: number; dayCount: number }[]>`
    SELECT count(*) FILTER (WHERE ip = ${ip} AND created_at > now() - interval '1 hour')::int AS "ipCount",
           count(*)::int AS "dayCount"
    FROM guide_chat WHERE created_at > now() - interval '1 day'`;
  if (ipCount >= PER_IP_HOUR || dayCount >= PER_DAY) return NextResponse.json({ error: "limit" }, { status: 429 });
  // 30일 지난 글은 지우고 통계용 주제·언어만 남긴다
  await sql`UPDATE guide_chat SET question = NULL, answer = NULL, ip = NULL WHERE created_at < now() - interval '30 days' AND ip IS NOT NULL`;
  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO guide_chat (conv_id, ip, lang, question) VALUES (${convId}, ${ip}, ${lang}, ${messages[messages.length - 1].text})
    RETURNING id`;

  const [data, photos] = await Promise.all([getGuideData(sql), listGuidePhotos(sql)]);
  const photoList = photos.length
    ? "\n\n[사진 목록] 답과 관련된 사진이 있으면 photos 에 id 를 넣어. 사진은 손님 화면에 답 아래 그대로 보여. " +
      "사진 속 안내 글은 한국어나 영어로만 적혀 있으니, 사진을 보낼 때는 사진 내용(아래 '사진 내용')을 바탕으로 해야 할 일을 손님 언어로 답에 직접 풀어서 설명해. \"사진을 확인하세요\"로만 끝내지 마.\n" +
      photos.map((p) => `- id ${p.id}: ${p.caption}${p.aiText ? `\n  사진 내용: ${p.aiText.replace(/\s*\n\s*/g, " / ")}` : ""}`).join("\n")
    : "";
  const system =
    buildGemInstructions(data) +
    photoList +
    `\n\n손님이 고른 화면 언어는 ${LANG_NAMES[lang]}야. 손님이 다른 언어로 물으면 그 언어로 답해. 답은 짧게, 마크다운 기호 없이 일반 문장으로 써.` +
    CHAT_REPLY_FORMAT;
  try {
    const reply = parseChatReply(await geminiGenerate(sql, { system, turns: messages, json: true }), photos.map((p) => p.id));
    const answer = reply.answer;
    await sql`UPDATE guide_chat SET answer = ${answer}, topic = ${reply.topic}, known = ${reply.known}, q_lang = ${reply.language} WHERE id = ${id}`;
    return NextResponse.json({ answer, photos: reply.photos.map((id) => `/guide/${token}/photo/${id}`) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("guide chat", e);
    // 사장님이 대화 기록에서 원인을 볼 수 있게 남긴다
    await sql`UPDATE guide_chat SET error = ${(e instanceof Error ? e.message : String(e)).slice(0, 500)} WHERE id = ${id}`.catch(() => undefined);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
