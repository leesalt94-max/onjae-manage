import { logoutAction } from "./actions";

export function OwnerShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="top">
        <strong>온재 숙소 관리</strong>
        <nav>
          <a href="/">홈</a>
          <a href="/reservations">예약</a>
          <a href="/stats">통계</a>
          <a href="/upload">파일 올리기</a>
          <a href="/otp">인증번호</a>
          <a href="/settings">설정</a>
        </nav>
        <form action={logoutAction} style={{ marginLeft: "auto" }}>
          <button className="secondary" type="submit">로그아웃</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
