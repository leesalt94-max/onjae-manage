import type postgres from "postgres";
import { CHANNELS, type Channel } from "./types";

// 통계 화면용: 확정·완료 예약을 "밤" 단위로 펼쳐 월·요일·채널별로 모은다.
// 정산액은 숙박한 밤에 고르게 나눠 붙인다 (월을 걸친 예약도 각 달에 맞게 들어간다).
// 금액은 원화(KRW) 예약만 센다.

export interface StayRow {
  channel: Channel;
  check_in: string;
  check_out: string;
  nights: number;
  booked_at: string | null;
  adults: number | null;
  children: number | null;
  payout: number | null;
  commission: number | null;
}

export async function stayRows(sql: postgres.Sql, from: string, to: string): Promise<StayRow[]> {
  return sql<StayRow[]>`
    SELECT channel, to_char(check_in, 'YYYY-MM-DD') AS check_in, to_char(check_out, 'YYYY-MM-DD') AS check_out,
           nights, to_char(booked_at, 'YYYY-MM-DD') AS booked_at, adults, children, payout_amount::float AS payout,
           commission::float AS commission
    FROM reservations
    WHERE status IN ('confirmed', 'completed') AND currency = 'KRW'
      AND check_out > ${from} AND check_in < ${to}
    ORDER BY check_in`;
}

export interface MonthPoint {
  month: string; // YYYY-MM
  future: boolean; // 오늘 이후 달 (이미 들어온 예약만 반영)
  revenue: Record<Channel, number>;
  nights: number;
  occupancy: number | null; // 0~1+ (오버부킹이면 1을 넘을 수 있다). 오픈 전 달은 null
}

export interface Bucket { label: string; count: number; revenue: number; nights: number }

export interface Insights {
  months: MonthPoint[];
  past: { revenue: number; nights: number; occupancy: number; adr: number | null; days: number };
  channels: { channel: Channel; bookings: number; nights: number; revenue: number; commission: number; adr: number | null }[];
  weekdays: { label: string; nights: number; revenue: number; occupancy: number; adr: number | null }[];
  lead: Bucket[];
  stay: Bucket[];
  party: Bucket[];
  notes: string[];
}

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function bucketize<T>(labels: string[], pick: (row: T) => number | null, rows: T[], value: (row: T) => { revenue: number; nights: number }) {
  const out: Bucket[] = labels.map((label) => ({ label, count: 0, revenue: 0, nights: 0 }));
  for (const r of rows) {
    const i = pick(r);
    if (i === null) continue;
    out[i].count++;
    const v = value(r);
    out[i].revenue += v.revenue;
    out[i].nights += v.nights;
  }
  return out;
}

export interface InsightOptions {
  today: string; // 한국 날짜 YYYY-MM-DD
  from: string; // 분석 시작일 (포함)
  to: string; // 분석 끝 (포함하지 않음). 오늘보다 뒤면 오늘까지만 "지난 기간"으로 센다
  openedOn: string | null; // 숙소 오픈일. 이전 날은 가동률 분모에서 뺀다
  roomCount: number;
  monthsAhead: number; // 끝이 오늘 이후면 그래프에 앞으로 몇 달을 더 보여줄지
}

const maxDate = (a: Date, b: Date) => (a > b ? a : b);
const minDate = (a: Date, b: Date) => (a < b ? a : b);

export function buildInsights(rows: StayRow[], opts: InsightOptions): Insights {
  const { today, roomCount } = opts;
  const thisMonth = today.slice(0, 7);
  const todayD = toDate(today);
  const fromD = toDate(opts.from);
  const toD = toDate(opts.to);
  const opened = opts.openedOn ? toDate(opts.openedOn) : null;
  // "지난 기간": 오픈일·시작일 중 늦은 날부터, 끝·오늘 중 이른 날 전까지.
  const pastStart = opened ? maxDate(fromD, opened) : fromD;
  const pastEnd = minDate(toD, todayD);
  // 오픈 전 달은 그래프에서도 뺀다.
  const firstMonth = iso(pastStart > fromD && pastStart < toD ? pastStart : fromD).slice(0, 7);
  const lastMonth = toD >= todayD ? addMonths(thisMonth, opts.monthsAhead) : iso(new Date(toD.getTime() - DAY)).slice(0, 7);
  const start = toDate(`${firstMonth}-01`);
  const end = toDate(`${addMonths(lastMonth, 1)}-01`);

  const months = new Map<string, MonthPoint>();
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) {
    months.set(m, { month: m, future: m > thisMonth, revenue: { airbnb: 0, booking: 0, trip: 0 }, nights: 0, occupancy: null });
  }
  const weekdays = WEEKDAYS.map((label) => ({ label, nights: 0, revenue: 0, occupancy: 0, adr: null as number | null }));
  const channels = new Map(CHANNELS.map((c) => [c, { channel: c, bookings: 0, nights: 0, revenue: 0, commission: 0, adr: null as number | null }]));
  const past = {
    revenue: 0, nights: 0, occupancy: 0, adr: null as number | null,
    days: Math.max(0, Math.round((pastEnd.getTime() - pastStart.getTime()) / DAY)),
  };
  const pastStays: StayRow[] = [];

  for (const r of rows) {
    const nights = Math.max(1, Math.round((toDate(r.check_out).getTime() - toDate(r.check_in).getTime()) / DAY));
    const perNight = (r.payout ?? 0) / nights;
    const feePerNight = (r.commission ?? 0) / nights;
    let countedPast = false;
    for (let i = 0; i < nights; i++) {
      const d = new Date(toDate(r.check_in).getTime() + i * DAY);
      if (d >= start && d < end) {
        const mp = months.get(iso(d).slice(0, 7));
        if (mp) {
          mp.revenue[r.channel] += perNight;
          mp.nights++;
        }
      }
      if (d >= pastStart && d < pastEnd) {
        countedPast = true;
        past.revenue += perNight;
        past.nights++;
        const wd = weekdays[d.getUTCDay()];
        wd.nights++;
        wd.revenue += perNight;
        const ch = channels.get(r.channel)!;
        ch.nights++;
        ch.revenue += perNight;
        ch.commission += feePerNight;
      }
    }
    if (countedPast) {
      channels.get(r.channel)!.bookings++;
      pastStays.push(r);
    }
  }

  // 월 가동률: 그 달 중 오픈일 이후 날만 분모로. 오픈 전 달은 비워 둔다.
  for (const mp of months.values()) {
    const monthStart = toDate(`${mp.month}-01`);
    const monthEnd = toDate(`${addMonths(mp.month, 1)}-01`);
    const from = opened ? maxDate(monthStart, opened) : monthStart;
    const days = Math.round((monthEnd.getTime() - from.getTime()) / DAY);
    mp.occupancy = days > 0 ? mp.nights / (days * roomCount) : null;
  }
  past.occupancy = past.days > 0 ? past.nights / (past.days * roomCount) : 0;
  past.adr = past.nights > 0 ? past.revenue / past.nights : null;
  // 요일별 가동률: 그 요일이 기간 안에 몇 번 있었는지로 나눈다.
  const dowCount = Array(7).fill(0);
  for (let t = pastStart.getTime(); t < pastEnd.getTime(); t += DAY) dowCount[new Date(t).getUTCDay()]++;
  weekdays.forEach((w, i) => {
    w.occupancy = dowCount[i] > 0 ? w.nights / (dowCount[i] * roomCount) : 0;
    w.adr = w.nights > 0 ? w.revenue / w.nights : null;
  });
  for (const c of channels.values()) c.adr = c.nights > 0 ? c.revenue / c.nights : null;

  const value = (r: StayRow) => ({ revenue: r.payout ?? 0, nights: r.nights || 1 });
  const lead = bucketize(["당일~3일 전", "4~7일 전", "8~14일 전", "15~30일 전", "31~60일 전", "61일 이상"], (r: StayRow) => {
    if (!r.booked_at) return null;
    const d = Math.round((toDate(r.check_in).getTime() - toDate(r.booked_at).getTime()) / DAY);
    return d <= 3 ? 0 : d <= 7 ? 1 : d <= 14 ? 2 : d <= 30 ? 3 : d <= 60 ? 4 : 5;
  }, pastStays, value);
  const stay = bucketize(["1박", "2박", "3박", "4~6박", "7박 이상"], (r: StayRow) => {
    const n = r.nights || 1;
    return n === 1 ? 0 : n === 2 ? 1 : n === 3 ? 2 : n <= 6 ? 3 : 4;
  }, pastStays, value);
  const party = bucketize(["1명", "2명", "3명", "4명", "5명", "6명 이상"], (r: StayRow) => {
    if (r.adults === null) return null;
    const n = r.adults + (r.children ?? 0);
    return n <= 1 ? 0 : Math.min(n, 6) - 1;
  }, pastStays, value);

  const chList = [...channels.values()];
  return { months: [...months.values()], past, channels: chList, weekdays, lead, stay, party, notes: notesFor(chList, weekdays, lead, stay, [...months.values()]) };
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const LABEL: Record<Channel, string> = { airbnb: "에어비앤비", booking: "부킹닷컴", trip: "트립닷컴" };
const SUBJECT: Record<Channel, string> = { airbnb: "에어비앤비가", booking: "부킹닷컴이", trip: "트립닷컴이" };

// 숫자에서 바로 읽히는 한 줄 요약. 근거가 약하면(표본이 적으면) 말하지 않는다.
function notesFor(channels: Insights["channels"], weekdays: Insights["weekdays"], lead: Bucket[], stay: Bucket[], months: MonthPoint[]): string[] {
  const notes: string[] = [];
  const ranked = channels.filter((c) => c.adr !== null && c.nights >= 5).sort((a, b) => b.adr! - a.adr!);
  if (ranked.length >= 2) {
    const [hi, lo] = [ranked[0], ranked[ranked.length - 1]];
    notes.push(`박당 정산액은 ${SUBJECT[hi.channel]} ${won(hi.adr!)}으로 가장 높고, ${LABEL[lo.channel]}(${won(lo.adr!)})보다 ${Math.round((hi.adr! / lo.adr! - 1) * 100)}% 많아요.`);
  }
  const weekend = weekdays.filter((_, i) => i === 5 || i === 6);
  const weekday = weekdays.filter((_, i) => i >= 0 && i <= 4);
  const avg = (ws: typeof weekdays, k: "revenue" | "nights") => ws.reduce((a, w) => a + w[k], 0);
  if (avg(weekend, "nights") >= 5 && avg(weekday, "nights") >= 5) {
    const we = avg(weekend, "revenue") / avg(weekend, "nights");
    const wd = avg(weekday, "revenue") / avg(weekday, "nights");
    const diff = Math.round((we / wd - 1) * 100);
    notes.push(`금·토요일 밤은 박당 ${won(we)}, 일~목요일 밤은 ${won(wd)}이에요 (${diff >= 0 ? `주말이 ${diff}% 높음` : `주말이 ${-diff}% 낮음`}).`);
  }
  const leadTotal = lead.reduce((a, b) => a + b.count, 0);
  if (leadTotal >= 10) {
    const late = lead[0].count + lead[1].count;
    notes.push(`예약의 ${Math.round((late / leadTotal) * 100)}%가 체크인 7일 이내에 들어왔어요.`);
  }
  const stayTotal = stay.reduce((a, b) => a + b.count, 0);
  if (stayTotal >= 10) {
    const top = [...stay].sort((a, b) => b.count - a.count)[0];
    notes.push(`가장 흔한 숙박 길이는 ${top.label}이에요 (${Math.round((top.count / stayTotal) * 100)}%).`);
  }
  const ahead = months.filter((m) => m.future);
  if (ahead.length) {
    notes.push(`앞으로: ${ahead.map((m) => `${Number(m.month.slice(5))}월 ${Math.round((m.occupancy ?? 0) * 100)}%`).join(", ")} 예약이 차 있어요.`);
  }
  return notes;
}

// 숙소 오픈일: 설정값이 없으면 첫 체크인 날짜로 본다.
export async function getOpenedOn(sql: postgres.Sql): Promise<{ date: string | null; fromSetting: boolean }> {
  const [row] = await sql<{ setting: string | null; first: string | null }[]>`
    SELECT (SELECT value FROM settings WHERE key = 'opened_on') AS setting,
           (SELECT to_char(min(check_in), 'YYYY-MM-DD') FROM reservations WHERE status IN ('confirmed', 'completed')) AS first`;
  if (row.setting && /^\d{4}-\d{2}-\d{2}$/.test(row.setting)) return { date: row.setting, fromSetting: true };
  return { date: row.first, fromSetting: false };
}
