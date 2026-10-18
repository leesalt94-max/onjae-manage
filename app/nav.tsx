import { logoutAction } from "./actions";
import { NavLinks } from "./nav-links";

export function OwnerShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="top">
        <strong>온재 숙소 관리</strong>
        <NavLinks />
        <form action={logoutAction} className="logout">
          <button className="secondary" type="submit">로그아웃</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
