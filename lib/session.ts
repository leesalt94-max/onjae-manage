import { jwtVerify, SignJWT } from "jose";

// proxy.ts 에서도 쓰므로 node 전용 모듈을 들이지 않는다.
export const SESSION_COOKIE = "onjae_session";
export const SESSION_HOURS = 12;
// "이 기기에서 로그인 유지"를 고르면 (휴대폰에서 매번 로그인하지 않도록) 30일.
export const REMEMBER_HOURS = 30 * 24;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("환경변수 SESSION_SECRET 이(가) 설정되지 않았습니다.");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(hours = SESSION_HOURS): Promise<string> {
  return new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(secret());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.role === "owner";
  } catch {
    return false;
  }
}
