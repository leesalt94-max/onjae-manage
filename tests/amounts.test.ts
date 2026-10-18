import { describe, expect, it } from "vitest";
import { computeAmounts } from "../lib/amounts";

describe("예약 금액 역산", () => {
  it("트립닷컴: 청소비는 수수료 없이, 객실분만 15%로 역산한다", () => {
    const a = computeAmounts({ channel: "trip", guest_paid: null, commission: null, payout_amount: "373620.00" });
    // (373,620 − 50,000) ÷ 0.85 = 380,729.4 → + 50,000
    expect(a).toMatchObject({ guestPaid: 430729, commission: 57109, payout: 373620, estimated: true });
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
