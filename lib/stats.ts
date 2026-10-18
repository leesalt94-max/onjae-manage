import type postgres from "postgres";
import type { Channel } from "./types";

export interface MonthlyChannelRow {
  month: string; // YYYY-MM
  channel: Channel;
  currency: string;
  bookings: number;
  nights: number;
  guestPaid: number;
  commission: number;
  payout: number;
}

// 체크인 월 기준, 취소·노쇼 제외.
export async function monthlyByChannel(sql: postgres.Sql, months = 12): Promise<MonthlyChannelRow[]> {
  return sql<MonthlyChannelRow[]>`
    SELECT to_char(check_in, 'YYYY-MM') AS month, channel, currency,
           count(*)::int AS bookings,
           sum(nights)::int AS nights,
           coalesce(sum(guest_paid), 0)::float AS "guestPaid",
           coalesce(sum(commission), 0)::float AS commission,
           coalesce(sum(payout_amount), 0)::float AS payout
    FROM reservations
    WHERE status IN ('confirmed', 'completed')
      AND check_in >= date_trunc('month', CURRENT_DATE) - make_interval(months => ${months - 1})
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 2`;
}

export interface OccupancyRow {
  month: string;
  occupiedNights: number;
  availableNights: number;
}

// 숙박한 밤을 하루씩 펼쳐 월별로 센다 (월을 걸친 예약도 정확히 나뉜다).
export async function occupancy(sql: postgres.Sql, roomCount: number, months = 12): Promise<OccupancyRow[]> {
  return sql<OccupancyRow[]>`
    WITH m AS (
      SELECT generate_series(date_trunc('month', CURRENT_DATE) - make_interval(months => ${months - 1}),
                             date_trunc('month', CURRENT_DATE), interval '1 month')::date AS start
    ), nights AS (
      SELECT d::date AS night
      FROM reservations r, generate_series(r.check_in, r.check_out - 1, interval '1 day') d
      WHERE r.status IN ('confirmed', 'completed')
    )
    SELECT to_char(m.start, 'YYYY-MM') AS month,
           (SELECT count(*) FROM nights WHERE night >= m.start AND night < m.start + interval '1 month')::int AS "occupiedNights",
           (${roomCount}::int * extract(day FROM (m.start + interval '1 month' - interval '1 day')))::int AS "availableNights"
    FROM m ORDER BY 1 DESC`;
}

export interface Summary {
  bookings: number;
  cancelled: number;
  avgLeadDays: number | null;
  avgPartySize: number | null;
  avgNights: number | null;
}

export async function summary(sql: postgres.Sql, from: string, to: string): Promise<Summary> {
  const [row] = await sql<Summary[]>`
    SELECT count(*) FILTER (WHERE status IN ('confirmed', 'completed'))::int AS bookings,
           count(*) FILTER (WHERE status IN ('cancelled', 'no_show'))::int AS cancelled,
           round(avg(check_in - booked_at) FILTER (WHERE booked_at IS NOT NULL), 1)::float AS "avgLeadDays",
           round(avg(coalesce(adults, 0) + coalesce(children, 0) + coalesce(infants, 0))
                 FILTER (WHERE adults IS NOT NULL), 1)::float AS "avgPartySize",
           round(avg(nights), 1)::float AS "avgNights"
    FROM reservations WHERE check_in >= ${from} AND check_in < ${to}`;
  return row;
}

export async function genderBreakdown(sql: postgres.Sql, from: string, to: string) {
  return sql<{ gender: string; count: number }[]>`
    SELECT g.gender, count(*)::int AS count
    FROM guest_profiles g JOIN reservations r ON r.id = g.reservation_id
    WHERE r.check_in >= ${from} AND r.check_in < ${to}
    GROUP BY 1 ORDER BY 2 DESC`;
}

export async function ageBands(sql: postgres.Sql, from: string, to: string) {
  return sql<{ band: string; count: number }[]>`
    SELECT CASE WHEN g.age IS NULL THEN '미입력'
                WHEN g.age < 20 THEN '20세 미만'
                WHEN g.age >= 60 THEN '60세 이상'
                ELSE (g.age / 10 * 10)::text || '대' END AS band,
           count(*)::int AS count
    FROM guest_profiles g JOIN reservations r ON r.id = g.reservation_id
    WHERE r.check_in >= ${from} AND r.check_in < ${to}
    GROUP BY 1 ORDER BY 1`;
}

export async function upcoming(sql: postgres.Sql, days = 7) {
  return sql<{ id: number; channel: Channel; confirmation: string; check_in: string; check_out: string; adults: number | null; children: number | null; profiles: number }[]>`
    SELECT r.id, r.channel, r.confirmation, to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
           to_char(r.check_out, 'YYYY-MM-DD') AS check_out, r.adults, r.children,
           (SELECT count(*)::int FROM guest_profiles g WHERE g.reservation_id = r.id) AS profiles
    FROM reservations r
    WHERE r.status = 'confirmed' AND r.check_in BETWEEN CURRENT_DATE AND CURRENT_DATE + ${days}::int
    ORDER BY r.check_in`;
}

export async function lastSyncs(sql: postgres.Sql) {
  return sql<{ channel: Channel; started_at: Date; ok: boolean | null; error: string | null; last_ok: Date | null }[]>`
    SELECT DISTINCT ON (channel) channel, started_at, ok, error,
           (SELECT max(started_at) FROM sync_runs s2 WHERE s2.channel = s.channel AND s2.ok) AS last_ok
    FROM sync_runs s ORDER BY channel, started_at DESC`;
}
