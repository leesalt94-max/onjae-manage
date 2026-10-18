import type postgres from "postgres";
import { intEnv } from "./env";
import { getSetting } from "./settings";
import type { Channel } from "./types";

// 가동률 계산에 쓰는 객실(유닛) 수. 설정 화면에서 바꾸고, 없으면 ROOM_COUNT 환경변수, 그것도 없으면 1.
export async function getRoomCount(sql: postgres.Sql): Promise<number> {
  const n = Number.parseInt((await getSetting(sql, "room_count")) ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : intEnv("ROOM_COUNT", 1);
}

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

// 트립닷컴 선결제는 입금가(정산액)만 알려 준다. 수수료는 객실 요금에만 붙고 청소비는 그대로 들어온다
// (2026-10 사장님 확인). 그래서 설정의 수수료율·예약당 청소비로 역산한다:
// 객실 판매가 = (입금가 − 청소비) ÷ (1 − 수수료율), 결제액 = 객실 판매가 + 청소비, 수수료 = 결제액 − 입금가.
// 수수료율이 비어 있으면 역산하지 않는다.
export async function getTripCommissionPct(sql: postgres.Sql): Promise<number | null> {
  const n = Number((await getSetting(sql, "trip_commission_pct")) ?? "");
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

export async function getTripCleaningFee(sql: postgres.Sql): Promise<number> {
  const n = Number((await getSetting(sql, "trip_cleaning_fee")) ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 체크인 월 기준, 취소·노쇼 제외.
export async function monthlyByChannel(sql: postgres.Sql, months = 12): Promise<MonthlyChannelRow[]> {
  const [tripPct, cleaning] = await Promise.all([getTripCommissionPct(sql), getTripCleaningFee(sql)]);
  const tripRate = tripPct ?? 0;
  return sql<MonthlyChannelRow[]>`
    WITH r AS (
      SELECT *,
             CASE WHEN channel = 'trip' AND ${tripRate}::numeric > 0 AND guest_paid IS NULL AND commission IS NULL
                  THEN least(${cleaning}::numeric, payout_amount)
                       + (payout_amount - least(${cleaning}::numeric, payout_amount)) / (1 - ${tripRate}::numeric / 100)
             END AS trip_gross
      FROM reservations
      WHERE status IN ('confirmed', 'completed')
        AND check_in >= date_trunc('month', CURRENT_DATE) - make_interval(months => ${months - 1})
    )
    SELECT to_char(check_in, 'YYYY-MM') AS month, channel, currency,
           count(*)::int AS bookings,
           sum(nights)::int AS nights,
           -- 에어비앤비 거래 내역은 손님 결제액이 없어 호스트 총액(또는 정산액+수수료)으로 대신한다.
           coalesce(sum(coalesce(guest_paid, gross_amount, payout_amount + commission, trip_gross)), 0)::float AS "guestPaid",
           coalesce(sum(coalesce(commission, trip_gross - payout_amount)), 0)::float AS commission,
           coalesce(sum(payout_amount), 0)::float AS payout
    FROM r
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
    SELECT g.age_band AS band, count(*)::int AS count
    FROM guest_profiles g JOIN reservations r ON r.id = g.reservation_id
    WHERE r.check_in >= ${from} AND r.check_in < ${to}
    GROUP BY 1
    ORDER BY array_position(ARRAY['child', '10s', '20s', '30s', '40s', '50s', '60plus', 'unknown'], g.age_band)`;
}

// 손님 나라(예약 단위). 입력한 예약만 센다.
export async function regionBreakdown(sql: postgres.Sql, from: string, to: string) {
  return sql<{ region: string; count: number; nights: number; payout: number }[]>`
    SELECT guest_region AS region, count(*)::int AS count, sum(nights)::int AS nights,
           coalesce(sum(payout_amount) FILTER (WHERE currency = 'KRW'), 0)::float AS payout
    FROM reservations
    WHERE guest_region IS NOT NULL AND status IN ('confirmed', 'completed') AND check_in >= ${from} AND check_in < ${to}
    GROUP BY 1
    ORDER BY array_position(ARRAY['japan', 'china', 'asia', 'europe', 'usa', 'other'], guest_region)`;
}

// 성별·나이를 입력한 예약이 전체 중 얼마나 되는지 (입력 못 한 예약이 있으니 통계 해석용).
export async function guestCoverage(sql: postgres.Sql, from: string, to: string) {
  const [row] = await sql<{ entered: number; regionEntered: number; total: number }[]>`
    SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM guest_profiles g WHERE g.reservation_id = r.id))::int AS entered,
           count(*) FILTER (WHERE r.guest_region IS NOT NULL)::int AS "regionEntered",
           count(*)::int AS total
    FROM reservations r
    WHERE r.status IN ('confirmed', 'completed') AND r.check_in >= ${from} AND r.check_in < ${to}`;
  return row;
}

export async function upcoming(sql: postgres.Sql, days = 7) {
  return sql<{ id: number; channel: Channel; confirmation: string; check_in: string; check_out: string; adults: number | null; children: number | null; profiles: number; guest_region: string | null }[]>`
    SELECT r.id, r.channel, r.confirmation, to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
           to_char(r.check_out, 'YYYY-MM-DD') AS check_out, r.adults, r.children,
           (SELECT count(*)::int FROM guest_profiles g WHERE g.reservation_id = r.id) AS profiles, r.guest_region
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
