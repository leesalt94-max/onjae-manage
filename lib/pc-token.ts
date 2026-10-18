import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { getSetting, setSetting } from "./settings";

// 사장님 컴퓨터의 수집 프로그램이 사이트에 예약 파일을 보낼 때 쓰는 연결 코드.
// 코드는 한 번만 보여 주고 DB 에는 해시만 둔다. 새로 만들면 예전 코드는 바로 무효.
const KEY = "pc_collector_token_sha256";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

export async function createPcToken(sql: postgres.Sql): Promise<string> {
  const token = `onjae_${randomBytes(24).toString("base64url")}`;
  await setSetting(sql, KEY, sha256(token).toString("hex"));
  return token;
}

export async function verifyPcToken(sql: postgres.Sql, token: string | null): Promise<boolean> {
  if (!token) return false;
  const stored = await getSetting(sql, KEY);
  if (!stored) return false;
  const a = Buffer.from(stored, "hex");
  const b = sha256(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hasPcToken(sql: postgres.Sql): Promise<boolean> {
  return (await getSetting(sql, KEY)) !== null;
}
