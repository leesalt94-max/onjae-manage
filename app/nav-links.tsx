"use client";

import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string; also?: string[] }[] = [
  { href: "/", label: "홈" },
  { href: "/reservations", label: "예약" },
  { href: "/stats", label: "통계" },
  // 파일 올리기·인증번호는 설정 안에서 들어간다 (사장님 요청 2026-10-18: 메뉴는 한 줄로)
  { href: "/settings", label: "설정", also: ["/upload", "/otp", "/chatbot"] },
];

// 지금 보고 있는 메뉴를 표시한다 (휴대폰에서 어디 있는지 바로 보이게).
export function NavLinks() {
  const path = usePathname();
  return (
    <nav>
      {LINKS.map((l) => {
        const on = l.href === "/" ? path === "/" : [l.href, ...(l.also ?? [])].some((h) => path.startsWith(h));
        return <a key={l.href} href={l.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>{l.label}</a>;
      })}
    </nav>
  );
}
