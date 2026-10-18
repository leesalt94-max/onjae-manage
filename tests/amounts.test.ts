import { describe, expect, it } from "vitest";
import { computeAmounts } from "../lib/amounts";

describe("예약 금액 역산", () => {
  it("트립닷컴: 청소비는 수수료 없이, 객실분만 15%로 역산한다", () => {
    const a = computeAmounts({ channel: "trip", guest_paid: null, commission: null, payout_amount: "373620.00" });
    // (373,620 − 50,000) ÷ 0.85 = 380,729.4 → + 50,000
    expect(a).toMatchObject({ guestPaid: 430729, commission: 57109, payout: 373620, estimated: true });
  });

  it("트립닷컴 11/11 예: 223,000 − 회원 특가 25% − 특별 할인(호스트) = 판매가 152,862, 리뷰 쿠폰만 트립 부담", () => {
    const sale = 223_000 - 55_750 - 14_388;
    const a = computeAmounts({ channel: "trip", guest_paid: null, commission: null, payout_amount: Math.round(sale * 0.85 + 50_000) });
    expect(Math.abs(a.commission! - sale * 0.15)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.guestPaid! - 8_700 - 194_162)).toBeLessThanOrEqual(1);
  });

  it("트립닷컴 10/14 예: 입금 92,500 → 객실 판매가 50,000, 수수료 7,500, 트립 쿠폰 전 결제액 100,000", () => {
    const a = computeAmounts({ channel: "trip", guest_paid: null, commission: null, payout_amount: 92_500 });
    expect(a).toMatchObject({ guestPaid: 100_000, commission: 7_500 });
    expect(a.steps.find((s) => s.label.includes("객실 판매가"))?.value).toBe(50_000);
  });

  it("에어비앤비: 결제액 = 정산액 + 수수료", () => {
    const a = computeAmounts({ channel: "airbnb", guest_paid: null, commission: "278380", payout_amount: "1517620" });
    expect(a).toMatchObject({ guestPaid: 1796000, commission: 278380, estimated: true });
  });

  it("부킹닷컴: 파일 값을 그대로 쓰고 결제 수수료 2.5% 포함 여부를 설명한다", () => {
    const a = computeAmounts({ channel: "booking", guest_paid: "134645", commission: "23563.88", payout_amount: "111081.12" });
    expect(a).toMatchObject({ guestPaid: 134645, estimated: false });
    expect(a.steps.map((s) => s.label)).toContain("− 결제 서비스 수수료 2.5%");
  });
});
