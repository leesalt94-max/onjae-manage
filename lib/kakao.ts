import type postgres from "postgres";
import { requireEnv } from "./env";
import { getSecret, setSecret } from "./settings";

// 카카오톡 "나에게 보내기". 사장님 카카오 계정으로 한 번 로그인해 받은 토큰을 암호화 저장해 두고 쓴다.
const AUTH_HOST = "https://kauth.kakao.com";
const API_HOST = "https://kapi.kakao.com";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export function kakaoRedirectUri(): string {
  return `${requireEnv("APP_URL")}/api/kakao/callback`;
}

export function kakaoAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("KAKAO_REST_API_KEY"),
    redirect_uri: kakaoRedirectUri(),
    response_type: "code",
    scope: "talk_message",
    state,
  });
  return `${AUTH_HOST}/oauth/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const secret = process.env.KAKAO_CLIENT_SECRET;
  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ client_id: requireEnv("KAKAO_REST_API_KEY"), ...(secret ? { client_secret: secret } : {}), ...body }),
  });
  if (!res.ok) throw new Error(`카카오 토큰 요청 실패 (${res.status})`);
  return (await res.json()) as TokenResponse;
}

async function storeTokens(sql: postgres.Sql, t: TokenResponse) {
  await setSecret(sql, "kakao.access_token", t.access_token);
  await setSecret(sql, "kakao.access_expires_at", String(Date.now() + (t.expires_in - 60) * 1000));
  // 리프레시 토큰은 만료 1개월 전부터 갱신 때 새로 내려온다. 내려올 때만 바꿔 저장.
  if (t.refresh_token) await setSecret(sql, "kakao.refresh_token", t.refresh_token);
}

export async function exchangeKakaoCode(sql: postgres.Sql, code: string): Promise<void> {
  await storeTokens(sql, await tokenRequest({ grant_type: "authorization_code", redirect_uri: kakaoRedirectUri(), code }));
}

async function accessToken(sql: postgres.Sql): Promise<string | null> {
  const token = await getSecret(sql, "kakao.access_token");
  const expiresAt = Number(await getSecret(sql, "kakao.access_expires_at"));
  if (token && expiresAt > Date.now()) return token;
  const refresh = await getSecret(sql, "kakao.refresh_token");
  if (!refresh) return null;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  await storeTokens(sql, t);
  return t.access_token;
}

export async function isKakaoConnected(sql: postgres.Sql): Promise<boolean> {
  return (await getSecret(sql, "kakao.refresh_token")) !== null;
}

// 알림 실패가 수집 자체를 멈추면 안 되므로 오류는 삼키고 false 를 돌려준다.
export async function sendKakao(sql: postgres.Sql, text: string, path = "/"): Promise<boolean> {
  try {
    const token = await accessToken(sql);
    if (!token) {
      console.warn("[kakao] 카카오가 연결되지 않아 알림을 보내지 못했습니다:", text);
      return false;
    }
    const url = `${requireEnv("APP_URL")}${path}`;
    const template = {
      object_type: "text",
      text: text.slice(0, 200),
      link: { web_url: url, mobile_web_url: url },
      button_title: "열기",
    };
    const res = await fetch(`${API_HOST}/v2/api/talk/memo/default/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ template_object: JSON.stringify(template) }),
    });
    if (!res.ok) console.warn(`[kakao] 전송 실패 (${res.status})`);
    return res.ok;
  } catch (err) {
    console.warn("[kakao] 전송 오류:", (err as Error).message);
    return false;
  }
}
