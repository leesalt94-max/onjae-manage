import { db } from "@/lib/db";
import { getGuideToken } from "@/lib/guide-page";
import { getGuidePhoto } from "@/lib/guide-photos";

// 손님 안내 사진. 링크 코드가 맞을 때만 보여 준다.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const sql = db();
  const [expected, photo] = await Promise.all([getGuideToken(sql), getGuidePhoto(sql, id)]);
  if (!expected || token !== expected || !photo) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: { "content-type": photo.mime, "cache-control": "private, max-age=86400" },
  });
}
