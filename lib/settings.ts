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
