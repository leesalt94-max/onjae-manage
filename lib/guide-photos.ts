import type postgres from "postgres";
import { geminiGenerate, getGeminiKey } from "./gemini";

// 손님 안내 사진. 사장님이 /chatbot 에서 올리고, 안내 페이지의 해당 항목 아래와 챗봇 답에 함께 보인다.
export const MAX_PHOTOS = 30;
export const MAX_PHOTO_BYTES = 1_500_000;
export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface GuidePhoto { id: string; field: string | null; caption: string; aiText: string | null }

export async function listGuidePhotos(sql: postgres.Sql): Promise<GuidePhoto[]> {
  return sql<GuidePhoto[]>`SELECT id::text AS id, field_key AS field, caption, ai_text AS "aiText" FROM guide_photos ORDER BY id`;
}

export async function getGuidePhoto(sql: postgres.Sql, id: string): Promise<{ mime: string; data: Buffer } | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const [row] = await sql<{ mime: string; data: Buffer }[]>`SELECT mime, data FROM guide_photos WHERE id = ${id}`;
  return row ?? null;
}

export async function addGuidePhoto(sql: postgres.Sql, p: { field: string | null; caption: string; mime: string; data: Buffer }): Promise<void> {
  await sql`INSERT INTO guide_photos (field_key, caption, mime, data) VALUES (${p.field}, ${p.caption}, ${p.mime}, ${p.data})`;
}

export async function deleteGuidePhoto(sql: postgres.Sql, id: string): Promise<void> {
  if (!/^\d{1,18}$/.test(id)) return;
  await sql`DELETE FROM guide_photos WHERE id = ${id}`;
}

export async function countGuidePhotos(sql: postgres.Sql): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM guide_photos`;
  return n;
}

// 아직 읽지 않은 사진을 Gemini 로 읽어 사진 속 글(한국어·영어 등)과 보이는 내용을 한국어로 적어 둔다.
// 챗봇은 이 글을 근거로 손님 언어로 설명하고, 사진은 그대로 보여 준다.
export async function describeMissingPhotos(sql: postgres.Sql): Promise<number> {
  if (!(await getGeminiKey(sql))) return 0;
  // 화면을 여러 번 열어도 동시에 같은 사진을 읽지 않게 3분짜리 잠금을 건다 (무료 한도 보호)
  const [lock] = await sql`
    INSERT INTO settings (key, value) VALUES ('photo_describe_lock', now()::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE settings.updated_at < now() - interval '3 minutes'
    RETURNING key`;
  if (!lock) return 0;
  try {
    return await describeLocked(sql);
  } finally {
    await sql`DELETE FROM settings WHERE key = 'photo_describe_lock'`;
  }
}

async function describeLocked(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ id: string; caption: string; mime: string; data: Buffer }[]>`
    SELECT id::text AS id, caption, mime, data FROM guide_photos WHERE ai_text IS NULL ORDER BY id LIMIT 10`;
  let done = 0;
  for (const r of rows) {
    try {
      const text = await geminiGenerate(sql, {
        system:
          "너는 숙소 안내 사진을 읽는 도우미야. 사진에 적힌 글자를 빠짐없이 그대로 옮기고, 사진에서 보이는 내용(위치, 버튼, 화살표·동그라미 표시가 가리키는 것, 순서)을 손님에게 설명할 수 있게 한국어로 정리해. " +
          "비밀번호·도어락 번호처럼 보이는 숫자는 옮기지 말고 [비밀번호]로 바꿔. 머리말 없이 내용만 써.",
        turns: [{ role: "user", text: `사장님이 붙인 설명: ${r.caption}`, image: { mime: r.mime, data: r.data } }],
        maxTokens: 2048,
        timeoutMs: 40_000,
      });
      await sql`UPDATE guide_photos SET ai_text = ${text.trim().slice(0, 3000)} WHERE id = ${r.id}`;
      done++;
    } catch (e) {
      console.error("photo describe", r.id, e);
    }
  }
  return done;
}
