import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { geminiGenerate } from "@/lib/gemini";
import { buildGemInstructions, getGuideData } from "@/lib/guide-bot";
import { CHAT_REPLY_FORMAT, getGuideToken, GUIDE_LANGS, LANG_NAMES, parseChatReply } from "@/lib/guide-page";

// 손님 안내 페이지의 채팅. 링크 코드로만 열리고, IP 당 시간 30회·전체 하루 400회까지만 답한다.
// 질문과 답은 사장님이 볼 수 있게 30일 동안 남긴다 (손님 화면에 알림).
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

  const system =
    buildGemInstructions(await getGuideData(sql)) +
    `\n\n손님이 고른 화면 언어는 ${LANG_NAMES[lang]}야. 손님이 다른 언어로 물으면 그 언어로 답해. 답은 짧게, 마크다운 기호 없이 일반 문장으로 써.` +
    CHAT_REPLY_FORMAT;
  try {
    const reply = parseChatReply(await geminiGenerate(sql, { system, turns: messages, maxTokens: 1000, json: true }));
    const answer = reply.answer;
    await sql`UPDATE guide_chat SET answer = ${answer}, topic = ${reply.topic}, known = ${reply.known}, q_lang = ${reply.language} WHERE id = ${id}`;
    return NextResponse.json({ answer }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("guide chat", e);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
