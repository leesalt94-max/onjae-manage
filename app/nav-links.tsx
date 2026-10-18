"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "홈" },
  { href: "/reservations", label: "예약" },
  { href: "/stats", label: "통계" },
  { href: "/upload", label: "파일 올리기" },
  { href: "/otp", label: "인증번호" },
  { href: "/settings", label: "설정" },
];

// 지금 보고 있는 메뉴를 표시한다 (휴대폰에서 어디 있는지 바로 보이게).
export function NavLinks() {
  const path = usePathname();
  return (
    <nav>
      {LINKS.map((l) => {
        const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return <a key={l.href} href={l.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>{l.label}</a>;
      })}
    </nav>
  );
}
