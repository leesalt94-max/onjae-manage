import type postgres from "postgres";
import type { Channel } from "./types";

export interface ReservationRow {
  id: number;
  channel: Channel;
  confirmation: string;
  status: string;
  listing: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number | null;
  children: number | null;
  infants: number | null;
  currency: string;
  guest_region: string | null;
  guest_paid: string | null;
  commission: string | null;
  payout_amount: string | null;
  booked_at: string | null;
  genders: string | null;
  ages: string | null;
}

// 취소·노쇼는 목록에서 뺀다 (사장님 결정 2026-10-18: 취소 예약에 정산액이 보여 헷갈림). 개수만 따로 센다.
export async function countCancelled(sql: postgres.Sql, filter: { channel?: Channel; from: string; to: string }): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM reservations
    WHERE status IN ('cancelled', 'no_show') AND check_in >= ${filter.from} AND check_in < ${filter.to}
      ${filter.channel ? sql`AND channel = ${filter.channel}` : sql``}`;
  return row.n;
}

export async function listReservations(sql: postgres.Sql, filter: { channel?: Channel; from: string; to: string }) {
  return sql<ReservationRow[]>`
    SELECT r.id, r.channel, r.confirmation, r.status, r.listing,
           to_char(r.check_in, 'YYYY-MM-DD') AS check_in, to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
           r.nights, r.adults, r.children, r.infants, r.currency, r.guest_region, r.guest_paid, r.commission, r.payout_amount,
           to_char(r.booked_at, 'YYYY-MM-DD') AS booked_at,
           string_agg(g.gender, ',' ORDER BY g.id) FILTER (WHERE g.id IS NOT NULL) AS genders,
           string_agg(g.age_band, ',' ORDER BY g.id) FILTER (WHERE g.id IS NOT NULL) AS ages
    FROM reservations r LEFT JOIN guest_profiles g ON g.reservation_id = r.id
    WHERE r.check_in >= ${filter.from} AND r.check_in < ${filter.to}
      AND r.status IN ('confirmed', 'completed')
      ${filter.channel ? sql`AND r.channel = ${filter.channel}` : sql``}
    GROUP BY r.id
    ORDER BY r.check_in DESC`;
}

export const STATUS_LABELS: Record<string, string> = {
  confirmed: "확정",
  completed: "완료",
  cancelled: "취소",
  no_show: "노쇼",
};
