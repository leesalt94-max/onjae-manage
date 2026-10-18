import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticator } from "otplib";
import { db } from "./db";
import { requireEnv } from "./env";
import { createSessionToken, SESSION_COOKIE, SESSION_HOURS, verifySessionToken } from "./session";

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(password: string, totp: string): Promise<LoginResult> {
  const sql = db();
  const ip = await clientIp();
  const [{ failures }] = await sql<{ failures: number }[]>`
    SELECT count(*)::int AS failures FROM login_attempts
    WHERE ip = ${ip} AND NOT ok AND created_at > now() - make_interval(mins => ${WINDOW_MINUTES})`;
  if (failures >= MAX_FAILURES) {
    return { ok: false, error: `로그인 실패가 많아 ${WINDOW_MINUTES}분 동안 잠겼습니다.` };
  }

  const passwordOk = await bcrypt.compare(password, requireEnv("ADMIN_PASSWORD_HASH"));
  const totpSecret = process.env.ADMIN_TOTP_SECRET;
  const totpOk = !totpSecret || authenticator.check(totp.replace(/\s/g, ""), totpSecret);
  const ok = passwordOk && totpOk;
  await sql`INSERT INTO login_attempts (ip, ok) VALUES (${ip}, ${ok})`;
  if (!ok) return { ok: false, error: "비밀번호 또는 인증 코드가 맞지 않습니다." };

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return { ok: true };
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
}

// 서버 액션·페이지에서 한 번 더 확인 (proxy 를 우회한 직접 호출 대비).
export async function requireOwner(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) redirect("/login");
}

export function totpEnabled(): boolean {
  return Boolean(process.env.ADMIN_TOTP_SECRET);
}
