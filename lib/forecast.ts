import type { StayRow } from "./insights";

// 연 총매출(수수료 빼기 전, 청소비 포함 = 정산액 + 수수료)이 기준(4,800만원)을 넘을지 달력 1년 기준으로 예측한다.
// 금액은 묵은 밤에 나눠 그 밤의 달에 넣는다 (통계의 월별 정산액과 같은 기준).
// 예측: 지난 달은 실제, 이번 달부터는 "이미 들어온 예약"과 "최근 달 평균" 중 큰 값.
// 최근 달 평균은 오픈 다음 달부터 지난달까지 중 최근 6개월. 범위는 그 6개월 중 가장 낮은·높은 달로 잡는다.

export const SALES_THRESHOLD = 48_000_000;
const RECENT_MONTHS = 6;

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

export interface YearForecast {
  year: number;
  actual: number; // 오늘 전까지 실제로 묵은 밤의 매출
  booked: number; // 오늘부터 연말까지 이미 들어온 예약
  expected: number; // 예상 연 매출
  low: number;
  high: number;
  monthsLeft: number; // 이번 달 포함 남은 달 (그 해가 미래면 12)
  neededPerMonth: number | null; // 남은 달 동안 기준을 넘으려면 필요한 월 평균 (이미 넘었으면 null)
  verdict: "over" | "under" | "close";
}

export interface SalesForecast {
  monthlyAvg: number;
  monthlyLow: number;
  monthlyHigh: number;
  basisMonths: string[];
  years: YearForecast[];
}

/** 월별 총매출 (YYYY-MM → 원). 오늘 전 밤은 actual, 오늘부터는 booked 에 넣는다. */
function monthlyGross(rows: StayRow[], today: string) {
  const actual = new Map<string, number>();
  const booked = new Map<string, number>();
  const todayT = toDate(today).getTime();
  for (const r of rows) {
    const start = toDate(r.check_in).getTime();
    const nights = Math.max(1, Math.round((toDate(r.check_out).getTime() - start) / DAY));
    const perNight = ((r.payout ?? 0) + (r.commission ?? 0)) / nights;
    for (let i = 0; i < nights; i++) {
      const t = start + i * DAY;
      const m = new Date(t).toISOString().slice(0, 7);
      const map = t < todayT ? actual : booked;
      map.set(m, (map.get(m) ?? 0) + perNight);
    }
  }
  return { actual, booked };
}

export function forecastSales(rows: StayRow[], today: string, openedOn: string | null, years: number[]): SalesForecast | null {
  const { actual, booked } = monthlyGross(rows, today);
  const thisMonth = today.slice(0, 7);
  const openedMonth = (openedOn ?? [...actual.keys()].sort()[0] ?? thisMonth).slice(0, 7);
  // 기준 달: 오픈한 달(며칠만 영업) 다음 달부터 지난달까지 중 최근 6개월
  const basis: string[] = [];
  for (let m = addMonths(thisMonth, -1); m > openedMonth && basis.length < RECENT_MONTHS; m = addMonths(m, -1)) basis.unshift(m);
  if (basis.length < 2) return null;
  const values = basis.map((m) => actual.get(m) ?? 0);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const low = Math.min(...values);
  const high = Math.max(...values);

  const out: YearForecast[] = years.map((year) => {
    let act = 0;
    let book = 0;
    let exp = 0;
    let lo = 0;
    let hi = 0;
    let monthsLeft = 0;
    for (let mo = 1; mo <= 12; mo++) {
      const m = `${year}-${String(mo).padStart(2, "0")}`;
      const a = actual.get(m) ?? 0;
      const b = booked.get(m) ?? 0;
      act += a;
      book += b;
      if (m < thisMonth || m < openedMonth) {
        exp += a;
        lo += a;
        hi += a;
        continue;
      }
      monthsLeft++;
      // 이번 달은 이미 지난 날 매출 + 남은 날 예약, 그리고 한 달 평균 중 큰 값
      exp += Math.max(a + b, avg);
      lo += Math.max(a + b, low);
      hi += Math.max(a + b, high);
    }
    const remainingNeed = SALES_THRESHOLD - act;
    return {
      year, actual: act, booked: book, expected: exp, low: lo, high: hi, monthsLeft,
      neededPerMonth: remainingNeed > 0 && monthsLeft > 0 ? remainingNeed / monthsLeft : null,
      verdict: lo > SALES_THRESHOLD ? "over" : hi < SALES_THRESHOLD ? "under" : "close",
    };
  });
  return { monthlyAvg: avg, monthlyLow: low, monthlyHigh: high, basisMonths: basis, years: out };
}
