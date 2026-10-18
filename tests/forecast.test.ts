import { describe, expect, it } from "vitest";
import { forecastSales, SALES_THRESHOLD } from "../lib/forecast";
import type { StayRow } from "../lib/insights";

const row = (check_in: string, check_out: string, payout: number, commission = 0): StayRow =>
  ({ channel: "airbnb", check_in, check_out, nights: 0, booked_at: null, adults: null, children: null, payout, commission });

describe("연 총매출 예측", () => {
  it("지난 달은 실제, 남은 달은 최근 월 평균과 들어온 예약 중 큰 값으로 채운다", () => {
    // 2026-03~09 매달 1일에 30박짜리 300만원(정산 270 + 수수료 30) 예약 → 월 약 300만원
    const rows: StayRow[] = [];
    for (let m = 3; m <= 9; m++) {
      const mm = String(m).padStart(2, "0");
      const next = String(m + 1).padStart(2, "0");
      rows.push(row(`2026-${mm}-01`, `2026-${next}-01`, 2_700_000, 300_000));
    }
    rows.push(row("2026-11-01", "2026-11-11", 9_000_000, 1_000_000)); // 11월엔 큰 예약이 이미 있다
    const f = forecastSales(rows, "2026-10-18", "2026-02-25", [2026, 2027])!;
    expect(f.basisMonths).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(f.monthlyAvg).toBeCloseTo(3_000_000, -3);
    const [y26, y27] = f.years;
    expect(y26.actual).toBeCloseTo(21_000_000, -3); // 3~9월 7개월
    // 10월 평균 300 + 11월 예약 1,000 + 12월 평균 300
    expect(y26.expected).toBeCloseTo(21_000_000 + 3_000_000 + 10_000_000 + 3_000_000, -3);
    expect(y26.verdict).toBe("under");
    expect(y27.expected).toBeCloseTo(12 * 3_000_000, -3);
    expect(y27.neededPerMonth).toBeCloseTo(SALES_THRESHOLD / 12, 0);
  });
});
