import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

// 로그인 화면과 첫 설정 화면은 공개 (설정 화면은 관리자 비밀번호가 등록되면 스스로 닫힌다).
// /api/collector 는 쿠키 대신 PC 연결 코드로 직접 확인한다. /api/calendar-hints 는 청소매니저용 날짜·플랫폼만. 아이콘·manifest 는 홈 화면 추가용이라 공개.
const PUBLIC_PREFIXES = ["/login", "/setup", "/api/collector", "/api/calendar-hints", "/manifest.webmanifest", "/icon", "/apple-icon"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
