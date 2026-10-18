import { db } from "@/lib/db";

// 청소매니저(onjae-calendar)가 부킹닷컴·트립닷컴 iCal 의 "마감" 칸이 실제로 어느 플랫폼 예약인지 가리는 데 쓴다.
// 두 플랫폼 iCal 은 진짜 예약과 다른 채널 때문에 닫아 둔 날을 구분하지 않는다 (2026-10-18, 10/19 트립 예약이 부킹에도 잡힘).
// 청소매니저 /api/calendar 가 이미 공개로 보여 주는 정보(날짜·플랫폼)만 내보낸다. 손님 정보·금액은 없다.
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db()<{ channel: string; check_in: string; check_out: string }[]>`
    SELECT channel, to_char(check_in, 'YYYY-MM-DD') AS check_in, to_char(check_out, 'YYYY-MM-DD') AS check_out
    FROM reservations
    WHERE status IN ('confirmed', 'completed') AND channel IN ('booking', 'trip')
      AND check_out >= CURRENT_DATE - 60 AND check_in <= CURRENT_DATE + 400
    ORDER BY check_in`;
  return Response.json(
    { reservations: rows.map((r) => ({ checkin: r.check_in, checkout: r.check_out, platform: r.channel === "trip" ? "tripcom" : r.channel })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
