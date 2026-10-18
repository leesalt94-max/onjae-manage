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
  guest_paid: string | null;
  commission: string | null;
  payout_amount: string | null;
  booked_at: string | null;
  genders: string | null;
  ages: string | null;
}

export async function listReservations(sql: postgres.Sql, filter: { channel?: Channel; from: string; to: string }) {
  return sql<ReservationRow[]>`
    SELECT r.id, r.channel, r.confirmation, r.status, r.listing,
           to_char(r.check_in, 'YYYY-MM-DD') AS check_in, to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
           r.nights, r.adults, r.children, r.infants, r.currency, r.guest_paid, r.commission, r.payout_amount,
           to_char(r.booked_at, 'YYYY-MM-DD') AS booked_at,
           string_agg(g.gender, ',' ORDER BY g.id) FILTER (WHERE g.id IS NOT NULL) AS genders,
           string_agg(coalesce(g.age::text, '?'), ',' ORDER BY g.id) FILTER (WHERE g.id IS NOT NULL) AS ages
    FROM reservations r LEFT JOIN guest_profiles g ON g.reservation_id = r.id
    WHERE r.check_in >= ${filter.from} AND r.check_in < ${filter.to}
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

export const GENDER_LABELS: Record<string, string> = {
  male: "남",
  female: "여",
  other: "기타",
  undisclosed: "미공개",
};
