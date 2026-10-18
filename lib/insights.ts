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
  available: number; // 그 달 팔 수 있던 밤 (오픈 전 날 제외, 객실 수 곱함)
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
  notes: Note[];
}

/** 분석 내용 한 줄. tag 는 주제(채널·요일·앞으로 등), good/warn 은 좋은 소식·챙길 일 표시. */
export interface Note { tag: string; text: string; tone?: "good" | "warn" }

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
    months.set(m, { month: m, future: m > thisMonth, revenue: { airbnb: 0, booking: 0, trip: 0 }, nights: 0, occupancy: null, available: 0 });
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
    mp.available = Math.max(0, days) * roomCount;
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
  const monthList = [...months.values()];
  const notes = notesFor(chList, weekdays, lead, stay, monthList, thisMonth, roomCount, pastStays);
  // 앞으로 30일: 기간 끝이 오늘 이후일 때만 (지난 기간만 볼 때는 의미 없다)
  if (toD > todayD) notes.push(...aheadNotes(rows, today, roomCount));
  return { months: monthList, past, channels: chList, weekdays, lead, stay, party, notes };
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const LABEL: Record<Channel, string> = { airbnb: "에어비앤비", booking: "부킹닷컴", trip: "트립닷컴" };
const SUBJECT: Record<Channel, string> = { airbnb: "에어비앤비가", booking: "부킹닷컴이", trip: "트립닷컴이" };

// 숫자에서 바로 읽히는 한 줄 요약. 근거가 약하면(표본이 적으면) 말하지 않는다.
function notesFor(channels: Insights["channels"], weekdays: Insights["weekdays"], lead: Bucket[], stay: Bucket[], months: MonthPoint[], thisMonth: string, roomCount: number, stays: StayRow[]): Note[] {
  const notes: Note[] = [];
  const pct = (a: number, b: number) => Math.round((a / b - 1) * 100);

  // 추세: 지난 3개월과 그 전 3개월 정산액 (이번 달·오픈 전 달 제외)
  // 오픈한 달처럼 며칠만 영업한 달은 비교에서 뺀다 (팔 수 있던 밤이 28밤 미만).
  const done = months.filter((m) => m.month < thisMonth && m.occupancy !== null && m.available >= 28 * roomCount);
  const total = (m: MonthPoint) => CHANNELS.reduce((a, c) => a + m.revenue[c], 0);
  if (done.length >= 6) {
    const recent = done.slice(-3).reduce((a, m) => a + total(m), 0);
    const before = done.slice(-6, -3).reduce((a, m) => a + total(m), 0);
    if (before > 0) {
      const d = pct(recent, before);
      notes.push({ tag: "추세", tone: d >= 0 ? "good" : "warn", text: `최근 3개월 정산액은 ${won(recent)}으로, 그 전 3개월보다 ${d >= 0 ? `${d}% 늘었어요` : `${-d}% 줄었어요`}.` });
    }
  }
  if (done.length >= 3) {
    const best = [...done].sort((a, b) => total(b) - total(a))[0];
    const worst = [...done].sort((a, b) => total(a) - total(b))[0];
    notes.push({ tag: "최고의 달", text: `${monthName(best.month)}이 ${won(total(best))}(가동률 ${Math.round((best.occupancy ?? 0) * 100)}%)으로 가장 좋았고, ${monthName(worst.month)}이 ${won(total(worst))}으로 가장 낮았어요.` });
  }

  const ranked = channels.filter((c) => c.adr !== null && c.nights >= 5).sort((a, b) => b.adr! - a.adr!);
  if (ranked.length >= 2) {
    const [hi, lo] = [ranked[0], ranked[ranked.length - 1]];
    notes.push({ tag: "채널", text: `박당 정산액은 ${SUBJECT[hi.channel]} ${won(hi.adr!)}으로 가장 높고, ${LABEL[lo.channel]}(${won(lo.adr!)})보다 ${pct(hi.adr!, lo.adr!)}% 많아요.` });
  }
  const feeTotal = channels.reduce((a, c) => a + c.commission, 0);
  const revTotal = channels.reduce((a, c) => a + c.revenue, 0);
  if (feeTotal > 0 && revTotal > 0) {
    const rated = channels.filter((c) => c.commission > 0 && c.nights >= 5).map((c) => ({ ...c, rate: c.commission / (c.revenue + c.commission) }));
    const top = rated.sort((a, b) => b.rate - a.rate)[0];
    notes.push({ tag: "수수료", text: `이 기간 수수료로 ${won(feeTotal)}이 나갔어요 (손님 결제액의 ${Math.round((feeTotal / (revTotal + feeTotal)) * 100)}%).${top ? ` 수수료 비중은 ${SUBJECT[top.channel]} ${Math.round(top.rate * 100)}%로 가장 커요.` : ""}` });
  }

  const sum = (ws: typeof weekdays, k: "revenue" | "nights") => ws.reduce((a, w) => a + w[k], 0);
  const guest = weekdayWeekendRates(stays, (r) => (r.payout ?? 0) + (r.commission ?? 0));
  const host = weekdayWeekendRates(stays, (r) => r.payout ?? 0);
  if (guest && host) {
    const d = pct(guest.weekend, guest.weekday);
    notes.push({ tag: "평일·주말 요금", text: `1박 평균 요금은 평일(일~목) ${won(guest.weekday)}, 주말(금·토) ${won(guest.weekend)}이에요 (손님 결제 기준, 청소비 제외${d ? `, 주말이 ${d > 0 ? `${d}% 비쌈` : `${-d}% 쌈`}` : ""}). 사장님 수령액으로는 평일 ${won(host.weekday)}, 주말 ${won(host.weekend)}이에요.` });
  }
  const filled = weekdays.filter((w) => w.nights > 0 || w.occupancy > 0);
  if (filled.length === 7 && sum(weekdays, "nights") >= 20) {
    const lo = [...weekdays].sort((a, b) => a.occupancy - b.occupancy)[0];
    const hi = [...weekdays].sort((a, b) => b.occupancy - a.occupancy)[0];
    if (hi.occupancy - lo.occupancy >= 0.15) {
      notes.push({ tag: "요일", tone: "warn", text: `${lo.label}요일 밤이 가장 비어요 (가동률 ${Math.round(lo.occupancy * 100)}%, ${hi.label}요일은 ${Math.round(hi.occupancy * 100)}%). ${lo.label}요일만 요금을 조금 낮춰 볼 만해요.` });
    }
  }

  const leadTotal = lead.reduce((a, b) => a + b.count, 0);
  if (leadTotal >= 10) {
    const late = lead.slice(0, 2);
    const early = lead.slice(2);
    const lateCount = late.reduce((a, b) => a + b.count, 0);
    notes.push({ tag: "예약 시점", text: `예약의 ${Math.round((lateCount / leadTotal) * 100)}%가 체크인 7일 이내에 들어왔어요.` });
    const adr = (bs: Bucket[]) => { const n = bs.reduce((a, b) => a + b.nights, 0); return n >= 5 ? bs.reduce((a, b) => a + b.revenue, 0) / n : null; };
    const la = adr(late);
    const ea = adr(early);
    if (la && ea && Math.abs(pct(la, ea)) >= 5) {
      const d = pct(la, ea);
      notes.push({ tag: "예약 시점", text: `임박 예약(7일 이내)은 박당 ${won(la)}으로, 미리 한 예약(${won(ea)})보다 ${d > 0 ? `${d}% 비싸게` : `${-d}% 싸게`} 팔렸어요.` });
    }
  }
  const stayTotal = stay.reduce((a, b) => a + b.count, 0);
  if (stayTotal >= 10) {
    const top = [...stay].sort((a, b) => b.count - a.count)[0];
    const nights = stay.reduce((a, b) => a + b.nights, 0);
    notes.push({ tag: "숙박 길이", text: `가장 흔한 숙박 길이는 ${top.label}이에요 (${Math.round((top.count / stayTotal) * 100)}%). 평균은 ${(nights / stayTotal).toFixed(1)}박이에요.` });
  }
  const ahead = months.filter((m) => m.future);
  if (ahead.length) {
    notes.push({ tag: "앞으로", text: `${ahead.map((m) => `${Number(m.month.slice(5))}월 ${Math.round((m.occupancy ?? 0) * 100)}%`).join(", ")} 예약이 차 있어요.` });
  }
  return notes;
}

const monthName = (m: string) => `${Number(m.slice(5))}월`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

/** 오늘부터 30일: 빈 밤, 비어 있는 금·토요일, 앞뒤가 막힌 1박짜리 빈 날. */
export function aheadNotes(rows: StayRow[], today: string, roomCount: number): Note[] {
  const taken = new Map<string, number>();
  for (const r of rows) {
    for (let t = toDate(r.check_in).getTime(); t < toDate(r.check_out).getTime(); t += DAY) {
      const d = iso(new Date(t));
      taken.set(d, (taken.get(d) ?? 0) + 1);
    }
  }
  const days = Array.from({ length: 30 }, (_, i) => iso(new Date(toDate(today).getTime() + i * DAY)));
  const free = days.filter((d) => (taken.get(d) ?? 0) < roomCount);
  const notes: Note[] = [];
  notes.push({
    tag: "다음 30일",
    tone: free.length > 15 ? "warn" : "good",
    text: free.length === 0 ? "다음 30일은 모두 예약됐어요." : `다음 30일 중 ${30 - free.length}밤이 찼고 ${free.length}밤이 비어 있어요 (가동률 ${Math.round(((30 - free.length) / 30) * 100)}%).`,
  });
  const weekendFree = free.filter((d) => [5, 6].includes(toDate(d).getUTCDay()));
  if (weekendFree.length) {
    notes.push({ tag: "빈 주말", tone: "warn", text: `아직 빈 금·토요일 밤: ${weekendFree.slice(0, 6).map(md).join(", ")}${weekendFree.length > 6 ? ` 외 ${weekendFree.length - 6}밤` : ""}.` });
  }
  // 앞뒤 밤이 모두 차 있는 1박 빈 날은 최소 숙박 조건 때문에 안 팔리기 쉽다.
  const isTaken = (d: string) => (taken.get(d) ?? 0) >= roomCount;
  const orphan = free.filter((d) => {
    const t = toDate(d).getTime();
    return d > today && isTaken(iso(new Date(t - DAY))) && isTaken(iso(new Date(t + DAY)));
  });
  if (orphan.length) {
    notes.push({ tag: "끼인 하루", tone: "warn", text: `예약 사이에 끼인 1박: ${orphan.map(md).join(", ")}. 최소 숙박일이 2박 이상이면 이 날은 팔리지 않으니 1박 허용이나 할인을 고려해 보세요.` });
  }
  return notes;
}

/** 한 달(from~to) 안에 묵은 밤만큼 금액을 나눠 더한다. 통계의 월별 정산액과 같은 기준이라 숫자가 맞는다. */
export function monthTotals(rows: StayRow[], from: string, to: string) {
  const out = { payout: 0, commission: 0, guestPaid: 0, nights: 0, bookings: 0 };
  const fromT = toDate(from).getTime();
  const toT = toDate(to).getTime();
  for (const r of rows) {
    const nights = Math.max(1, Math.round((toDate(r.check_out).getTime() - toDate(r.check_in).getTime()) / DAY));
    let inside = 0;
    for (let i = 0; i < nights; i++) {
      const t = toDate(r.check_in).getTime() + i * DAY;
      if (t >= fromT && t < toT) inside++;
    }
    if (!inside) continue;
    const share = inside / nights;
    out.bookings++;
    out.nights += inside;
    out.payout += (r.payout ?? 0) * share;
    out.commission += (r.commission ?? 0) * share;
    out.guestPaid += ((r.payout ?? 0) + (r.commission ?? 0)) * share;
  }
  return out;
}

/**
 * 평일(일~목 밤)·주말(금·토 밤) 1박 평균 요금. 예약 금액 = 예약당 고정분(청소비 등) + 평일 박수 × 평일 요금 + 주말 박수 × 주말 요금
 * 으로 보고 모든 예약에 가장 잘 맞는 값을 찾는다(최소제곱). 여러 박 예약도 평일·주말 몫이 섞이지 않게 나눌 수 있다.
 */
export function weekdayWeekendRates(rows: StayRow[], value: (r: StayRow) => number) {
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rows) {
    if (r.payout === null) continue;
    let wd = 0;
    let we = 0;
    for (let t = toDate(r.check_in).getTime(); t < toDate(r.check_out).getTime(); t += DAY) {
      const dow = new Date(t).getUTCDay();
      if (dow === 5 || dow === 6) we++;
      else wd++;
    }
    X.push([1, wd, we]);
    y.push(value(r));
  }
  const weekendStays = X.filter((x) => x[2] > 0).length;
  const weekdayStays = X.filter((x) => x[1] > 0).length;
  if (X.length < 10 || weekendStays < 3 || weekdayStays < 3) return null;
  // 정규방정식 (XᵀX)b = Xᵀy 를 풀어 b = [고정분, 평일, 주말]
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((a, x) => a + x[i] * x[j], 0)));
  const v = [0, 1, 2].map((i) => X.reduce((a, x, k) => a + x[i] * y[k], 0));
  const b = solve3(A, v);
  if (!b || b[1] <= 0 || b[2] <= 0) return null;
  return { fixed: b[0], weekday: b[1], weekend: b[2], stays: X.length };
}

function solve3(A: number[][], v: number[]): number[] | null {
  const m = A.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-9) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[3] / row[i]);
}

// 숙소 오픈일: 설정값이 없으면 첫 체크인 날짜로 본다.
export async function getOpenedOn(sql: postgres.Sql): Promise<{ date: string | null; fromSetting: boolean }> {
  const [row] = await sql<{ setting: string | null; first: string | null }[]>`
    SELECT (SELECT value FROM settings WHERE key = 'opened_on') AS setting,
           (SELECT to_char(min(check_in), 'YYYY-MM-DD') FROM reservations WHERE status IN ('confirmed', 'completed')) AS first`;
  if (row.setting && /^\d{4}-\d{2}-\d{2}$/.test(row.setting)) return { date: row.setting, fromSetting: true };
  return { date: row.first, fromSetting: false };
}
