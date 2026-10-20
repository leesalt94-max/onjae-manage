import type postgres from "postgres";
import { getSecret, getSetting, setSecret } from "./settings";

// 구글 Gemini API (무료 등급으로 충분). 키는 사장님이 /chatbot 에서 넣고 암호화해 저장한다.
const KEY = "gemini_api_key";
// 손님 질문에 몇 초 안에 답하도록 "생각"을 끈 2.5 Flash 를 기본으로 쓴다.
const DEFAULT_MODEL = "gemini-2.5-flash";

export async function getGeminiKey(sql: postgres.Sql): Promise<string | null> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // 암호화 키가 바뀌어 풀 수 없으면 키가 없는 것으로 보고 다시 넣게 한다 (화면이 깨지지 않도록)
  return getSecret(sql, KEY).catch(() => null);
}

export async function setGeminiKey(sql: postgres.Sql, key: string): Promise<void> {
  await setSecret(sql, KEY, key);
}

export interface GenerateOpts {
  system: string;
  turns: ChatTurn[];
  json?: boolean;
  // JSON 모양을 강제한다 (Gemini responseSchema). 모델이 깨진 JSON 을 내는 것을 막는다.
  schema?: object;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ChatTurn { role: "user" | "model"; text: string; image?: { mime: string; data: Buffer } }

// 기본 모델이 없어졌거나(404) 잠깐 붐비거나(429·500·503) 늦을 때 다음 모델로 한 번 더 시도한다.
const FALLBACK_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-latest"];
const RETRYABLE = /Gemini (404|429|500|503)|빈 답|timeout|aborted/i;

export async function geminiGenerate(
  sql: postgres.Sql,
  opts: GenerateOpts,
): Promise<string> {
  const key = await getGeminiKey(sql);
  if (!key) throw new Error("Gemini API 키가 없습니다.");
  const first = (await getSetting(sql, "gemini_model")) || DEFAULT_MODEL;
  const models = [first, ...FALLBACK_MODELS.filter((m) => m !== first)];
  let lastError: Error | null = null;
  for (const model of models) {
    try {
      return await callModel(key, model, opts);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (!RETRYABLE.test(`${lastError.name} ${lastError.message}`)) throw lastError;
    }
  }
  throw lastError ?? new Error("Gemini 호출 실패");
}

async function callModel(
  key: string,
  model: string,
  opts: GenerateOpts,
): Promise<string> {
  const res = await fetch(`${process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: opts.system }] },
      contents: opts.turns.map((t) => ({
        role: t.role,
        parts: [...(t.image ? [{ inline_data: { mime_type: t.image.mime, data: t.image.data.toString("base64") } }] : []), { text: t.text }],
      })),
      generationConfig: {
        // 최근 Gemini 모델은 답 전에 "생각"에 출력 토큰을 쓰므로 넉넉히 준다 (적으면 빈 답이 온다)
        maxOutputTokens: opts.maxTokens ?? 8192,
        temperature: 0.3,
        ...(opts.json || opts.schema ? { responseMimeType: "application/json" } : {}),
        ...(opts.schema ? { responseSchema: opts.schema } : {}),
        // 2.5 Flash 계열은 생각을 끌 수 있다. 안내 답변에는 생각이 필요 없고, 켜 두면 수십 초씩 걸린다.
        ...(model.startsWith("gemini-2.5-flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status} (${model}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const cand = body.candidates?.[0];
  const text = cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini 가 빈 답을 보냈습니다 (${model}, ${cand?.finishReason ?? "후보 없음"}).`);
  return text;
}
