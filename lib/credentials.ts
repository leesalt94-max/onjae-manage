import type postgres from "postgres";
import { decrypt, encrypt } from "./crypto";
import type { Channel } from "./types";

export interface PlatformLogin {
  channel: Channel;
  username: string;
  password: string;
  sessionState: string | null;
}

export async function saveCredentials(sql: postgres.Sql, channel: Channel, username: string, password: string) {
  // 아이디·비밀번호가 바뀌면 예전 브라우저 세션은 버린다.
  await sql`
    INSERT INTO platform_credentials (channel, username_enc, password_enc, session_state_enc, enabled)
    VALUES (${channel}, ${encrypt(username)}, ${encrypt(password)}, NULL, TRUE)
    ON CONFLICT (channel) DO UPDATE SET
      username_enc = EXCLUDED.username_enc, password_enc = EXCLUDED.password_enc,
      session_state_enc = NULL, enabled = TRUE, updated_at = now()`;
}

export async function setEnabled(sql: postgres.Sql, channel: Channel, enabled: boolean) {
  await sql`UPDATE platform_credentials SET enabled = ${enabled}, updated_at = now() WHERE channel = ${channel}`;
}

export async function deleteCredentials(sql: postgres.Sql, channel: Channel) {
  await sql`DELETE FROM platform_credentials WHERE channel = ${channel}`;
}

export async function loadEnabledLogins(sql: postgres.Sql): Promise<{ logins: PlatformLogin[]; unreadable: Channel[] }> {
  const rows = await sql<{ channel: Channel; username_enc: string; password_enc: string; session_state_enc: string | null }[]>`
    SELECT channel, username_enc, password_enc, session_state_enc FROM platform_credentials WHERE enabled`;
  const logins: PlatformLogin[] = [];
  const unreadable: Channel[] = [];
  for (const r of rows) {
    try {
      logins.push({
        channel: r.channel,
        username: decrypt(r.username_enc),
        password: decrypt(r.password_enc),
        sessionState: r.session_state_enc ? decrypt(r.session_state_enc) : null,
      });
    } catch {
      unreadable.push(r.channel);
    }
  }
  return { logins, unreadable };
}

export async function saveSessionState(sql: postgres.Sql, channel: Channel, state: string | null) {
  await sql`
    UPDATE platform_credentials SET session_state_enc = ${state === null ? null : encrypt(state)}, updated_at = now()
    WHERE channel = ${channel}`;
}

// 화면에는 아이디 일부만 보여준다. 비밀번호는 절대 다시 보여주지 않는다.
export async function listCredentialStatus(sql: postgres.Sql) {
  const rows = await sql<{ channel: Channel; username_enc: string; enabled: boolean; has_session: boolean; updated_at: Date }[]>`
    SELECT channel, username_enc, enabled, session_state_enc IS NOT NULL AS has_session, updated_at
    FROM platform_credentials`;
  return rows.map((r) => {
    let masked: string;
    try {
      const username = decrypt(r.username_enc);
      masked = username.length <= 3 ? "***" : `${username.slice(0, 3)}***`;
    } catch {
      // ENCRYPTION_KEY 가 바뀌면 예전 값은 읽을 수 없다. 화면이 깨지지 않게 다시 입력을 안내한다.
      masked = "읽을 수 없음(다시 저장 필요)";
    }
    return { channel: r.channel, maskedUsername: masked, enabled: r.enabled, hasSession: r.has_session, updatedAt: r.updated_at };
  });
}
