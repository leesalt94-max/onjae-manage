import type postgres from "postgres";
import { decrypt, encrypt } from "./crypto";
import { sendKakao } from "./kakao";
import type { Channel } from "./types";
import { CHANNEL_LABELS } from "./types";

// 수집기가 2단계 인증 화면을 만나면 요청을 만들고 카톡으로 알린 뒤, 사장님이 사이트에 코드를 넣을 때까지 기다린다.
export async function requestOtp(
  sql: postgres.Sql,
  channel: Channel,
  prompt: string,
  waitMinutes: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string | null> {
  await sql`UPDATE otp_requests SET status = 'expired' WHERE channel = ${channel} AND status IN ('pending', 'answered')`;
  const [req] = await sql<{ id: number }[]>`
    INSERT INTO otp_requests (channel, prompt, expires_at)
    VALUES (${channel}, ${prompt}, now() + make_interval(mins => ${waitMinutes}))
    RETURNING id`;
  await sendKakao(sql, `[${CHANNEL_LABELS[channel]}] 인증번호가 필요해요. ${waitMinutes}분 안에 사이트에 입력해 주세요.\n${prompt}`, "/otp");

  const deadline = Date.now() + waitMinutes * 60_000;
  while (Date.now() < deadline) {
    const [row] = await sql<{ code_enc: string | null; status: string }[]>`
      SELECT code_enc, status FROM otp_requests WHERE id = ${req.id}`;
    if (row?.status === "answered" && row.code_enc) {
      await sql`UPDATE otp_requests SET status = 'used', code_enc = NULL WHERE id = ${req.id}`;
      return decrypt(row.code_enc);
    }
    await sleep(5_000);
  }
  await sql`UPDATE otp_requests SET status = 'expired' WHERE id = ${req.id} AND status = 'pending'`;
  return null;
}

export async function answerOtp(sql: postgres.Sql, id: number, code: string): Promise<boolean> {
  const rows = await sql`
    UPDATE otp_requests SET code_enc = ${encrypt(code)}, status = 'answered'
    WHERE id = ${id} AND status = 'pending' AND expires_at > now()
    RETURNING id`;
  return rows.length === 1;
}

export async function pendingOtps(sql: postgres.Sql) {
  return sql<{ id: number; channel: Channel; prompt: string; expires_at: Date }[]>`
    SELECT id, channel, prompt, expires_at FROM otp_requests
    WHERE status = 'pending' AND expires_at > now() ORDER BY created_at DESC`;
}
