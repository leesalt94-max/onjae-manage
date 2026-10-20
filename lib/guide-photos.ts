import type postgres from "postgres";

// 손님 안내 사진. 사장님이 /chatbot 에서 올리고, 안내 페이지의 해당 항목 아래와 챗봇 답에 함께 보인다.
export const MAX_PHOTOS = 30;
export const MAX_PHOTO_BYTES = 1_500_000;
export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface GuidePhoto { id: string; field: string | null; caption: string }

export async function listGuidePhotos(sql: postgres.Sql): Promise<GuidePhoto[]> {
  return sql<GuidePhoto[]>`SELECT id::text AS id, field_key AS field, caption FROM guide_photos ORDER BY id`;
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
