import type postgres from "postgres";
import { decrypt, encrypt } from "./crypto";

export async function getSetting(sql: postgres.Sql, key: string): Promise<string | null> {
  const [row] = await sql<{ value: string }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return row?.value ?? null;
}

export async function setSetting(sql: postgres.Sql, key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function getSecret(sql: postgres.Sql, key: string): Promise<string | null> {
  const v = await getSetting(sql, key);
  return v === null ? null : decrypt(v);
}

export async function setSecret(sql: postgres.Sql, key: string, value: string): Promise<void> {
  await setSetting(sql, key, encrypt(value));
}

// 오래 걸리는 일(번역, 사진 읽기)을 여러 요청이 동시에 하지 않게 거는 간단한 잠금. 만료 시간이 지나면 다시 잡을 수 있다.
export async function tryLock(sql: postgres.Sql, key: string, minutes: number): Promise<boolean> {
  const [row] = await sql`
    INSERT INTO settings (key, value) VALUES (${key}, now()::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE settings.updated_at < now() - make_interval(mins => ${minutes})
    RETURNING key`;
  return !!row;
}

export async function unlock(sql: postgres.Sql, key: string): Promise<void> {
  await sql`DELETE FROM settings WHERE key = ${key}`;
}
