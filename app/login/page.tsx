import { totpEnabled } from "@/lib/auth";
import { loginAction } from "../actions";
import { Flash, type SearchParams } from "../flash";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main style={{ maxWidth: 420 }}>
      <h1>온재 숙소 관리</h1>
      <Flash params={params} />
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
