import type postgres from "postgres";
import { getSecret, getSetting, setSecret } from "./settings";

// 구글 Gemini API (무료 등급으로 충분). 키는 사장님이 /chatbot 에서 넣고 암호화해 저장한다.
const KEY = "gemini_api_key";
const DEFAULT_MODEL = "gemini-flash-latest";

export async function getGeminiKey(sql: postgres.Sql): Promise<string | null> {
  return process.env.GEMINI_API_KEY || (await getSecret(sql, KEY));
}

export async function setGeminiKey(sql: postgres.Sql, key: string): Promise<void> {
  await setSecret(sql, KEY, key);
}

export interface ChatTurn { role: "user" | "model"; text: string }

export async function geminiGenerate(
  sql: postgres.Sql,
  opts: { system: string; turns: ChatTurn[]; json?: boolean; maxTokens?: number; timeoutMs?: number },
): Promise<string> {
  const key = await getGeminiKey(sql);
  if (!key) throw new Error("Gemini API 키가 없습니다.");
  const model = (await getSetting(sql, "gemini_model")) || DEFAULT_MODEL;
  const res = await fetch(`${process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: opts.system }] },
      contents: opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 1024,
        temperature: 0.3,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini 가 빈 답을 보냈습니다.");
  return text;
}
