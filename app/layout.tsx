import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "온재 숙소 관리",
  description: "에어비앤비·부킹닷컴·트립닷컴 예약과 정산 통합",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
