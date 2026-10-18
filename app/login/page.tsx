import { totpEnabled } from "@/lib/auth";
import { loginAction } from "../actions";
import { Flash, type SearchParams } from "../flash";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main style={{ maxWidth: 420 }}>
      <h1>온재 숙소 관리</h1>
      <Flash params={params} />
      {!process.env.ADMIN_PASSWORD_HASH && (
        <div className="notice warn">
          아직 관리자 비밀번호가 등록되지 않았습니다. <a href="/setup">비밀값 만들기</a>에서 시작하세요.
        </div>
      )}
      <form action={loginAction} className="stack panel">
        <label>
          비밀번호
          <input type="password" name="password" autoComplete="current-password" required autoFocus />
        </label>
        {totpEnabled() && (
          <label>
            OTP 앱 인증 코드
            <input name="totp" inputMode="numeric" autoComplete="one-time-code" required />
          </label>
        )}
        <button type="submit">로그인</button>
      </form>
    </main>
  );
}
