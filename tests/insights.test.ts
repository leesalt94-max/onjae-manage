import { describe, expect, it } from "vitest";
import { buildInsights, type StayRow } from "../lib/insights";

const row = (channel: StayRow["channel"], checkIn: string, checkOut: string, payout: number, extra: Partial<StayRow> = {}): StayRow => ({
  channel, check_in: checkIn, check_out: checkOut, nights: Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000),
  booked_at: null, adults: null, children: null, payout, ...extra,
});

describe("통계 인사이트", () => {
  it("정산액을 숙박한 밤에 나눠 월·요일·채널별로 모은다", () => {
    const ins = buildInsights([
      // 9/29(화)~10/2: 3박, 30만원 → 9월 2박 20만, 10월 1박 10만
      row("booking", "2026-09-29", "2026-10-02", 300_000, { booked_at: "2026-09-27", adults: 2, children: 1 }),
      row("airbnb", "2026-10-09", "2026-10-11", 400_000, { booked_at: "2026-08-01" }), // 금·토 밤
      row("trip", "2026-11-05", "2026-11-07", 200_000), // 앞으로의 예약
    ], { today: "2026-10-18", roomCount: 1, monthsBack: 2, monthsAhead: 1 });

    expect(ins.months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(ins.months[0].revenue.booking).toBe(200_000);
    expect(ins.months[1].revenue).toEqual({ airbnb: 400_000, booking: 100_000, trip: 0 });
    expect(ins.months[1].nights).toBe(3);
    expect(ins.months[2]).toMatchObject({ future: true, nights: 2 });
    expect(ins.months[2].occupancy).toBeCloseTo(2 / 30);

    // 과거(오늘 이전) 밤만: 5박, 70만원
    expect(ins.past).toMatchObject({ nights: 5, revenue: 700_000, adr: 140_000 });
    expect(ins.channels.find((c) => c.channel === "airbnb")).toMatchObject({ bookings: 1, nights: 2, adr: 200_000 });
    expect(ins.channels.find((c) => c.channel === "trip")).toMatchObject({ bookings: 0, nights: 0, adr: null });
    expect(ins.weekdays[5]).toMatchObject({ label: "금", nights: 1, revenue: 200_000 });
    expect(ins.lead.map((b) => b.count)).toEqual([1, 0, 0, 0, 0, 1]);
    expect(ins.party.map((b) => b.count)).toEqual([0, 0, 1, 0, 0, 0]);
    expect(ins.stay.map((b) => b.count)).toEqual([0, 1, 1, 0, 0]);
  });
});
