import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, stripPersonal } from "../lib/parsers/common";
import { parseExport } from "../lib/parsers";

describe("공통 변환", () => {
  it.each([
    ["2026-10-18", "2026-10-18"],
    ["10/18/2026", "2026-10-18"],
    ["2026.10.18", "2026-10-18"],
    ["2026년 10월 18일", "2026-10-18"],
    ["18 Oct 2026", "2026-10-18"],
    ["Oct 18, 2026", "2026-10-18"],
    ["2026-02-30", null],
    ["", null],
  ])("날짜 %s → %s", (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it.each([
    ["₩123,456", 123456],
    ["1,234.56 USD", 1234.56],
    ["1.234,56", 1234.56],
    ["-15,000", -15000],
    ["150000 KRW", 150000],
    ["12,5", 12.5],
    ["", null],
  ])("금액 %s → %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("이름·연락처·국적 칸은 원본 보관에서 뺀다", () => {
    const kept = stripPersonal({
      "guest name": "Kim",
      "phone number": "010",
      "booker country": "kr",
      remarks: "late arrival",
      adults: "2",
      price: "100",
    });
    expect(kept).toEqual({ adults: "2", price: "100" });
  });
});

const AIRBNB_RESERVATIONS = `Confirmation code,Status,Guest name,Contact,# of adults,# of children,# of infants,Start date,End date,# of nights,Booked,Listing,Earnings
HMABC123,Confirmed,Jane Doe,+1 555,2,1,0,10/20/2026,10/23/2026,3,09/01/2026,Onjae Room,"₩450,000"
HMDEF456,Canceled by guest,John Roe,+44 777,1,0,0,11/02/2026,11/04/2026,2,10/01/2026,Onjae Room,₩0`;

const AIRBNB_TRANSACTIONS = `Date,Type,Confirmation Code,Booking date,Start date,End date,Nights,Guest,Listing,Details,Reference code,Currency,Amount,Paid out,Service fee,Fast pay fee,Cleaning fee,Gross earnings,Occupancy taxes,Earnings year
10/24/2026,Payout,,,,,,,,Transfer to ***1234,,KRW,,436500,,,,,,2026
10/24/2026,Reservation,HMABC123,09/01/2026,10/20/2026,10/23/2026,3,Jane Doe,Onjae Room,,,KRW,436500,,13500,,30000,450000,,2026`;

describe("에어비앤비", () => {
  it("예약 목록에서 인원·상태·정산 예정액을 읽는다", () => {
    const { reservations, skipped } = parseExport("airbnb", AIRBNB_RESERVATIONS);
    expect(skipped).toEqual([]);
    expect(reservations).toHaveLength(2);
    expect(reservations[0]).toMatchObject({
      confirmation: "HMABC123", status: "confirmed", adults: 2, children: 1, infants: 0,
      checkIn: "2026-10-20", checkOut: "2026-10-23", nights: 3, bookedAt: "2026-09-01",
      currency: "KRW", payoutAmount: 450000,
    });
    expect(reservations[1].status).toBe("cancelled");
    expect(JSON.stringify(reservations)).not.toMatch(/Jane|John|\+1 555/);
  });

  it("거래 내역에서는 예약 행만 골라 수수료와 정산액을 읽고 상태는 건드리지 않는다", () => {
    const { reservations } = parseExport("airbnb", AIRBNB_TRANSACTIONS);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      confirmation: "HMABC123", status: null, commission: 13500, payoutAmount: 436500, grossAmount: 450000, adults: null,
    });
  });
});

const BOOKING = `Book number,Booked by,Guest name(s),Check-in,Check-out,Booked on,Status,Rooms,People,Adults,Children,Children's ages,Price,Commission %,Commission amount,Payment status,Payment method,Remarks,Booker country,Unit type,Duration (nights),Cancellation date,Phone number
4012345678,Lee Min,Lee Min,2026-10-25,2026-10-27,2026-10-01 12:30:00,ok,1,3,2,1,7,240000 KRW,15,36000 KRW,Paid online,,Quiet room please,kr,Double Room,2,,+82 10
4087654321,Wang Fang,Wang Fang,2026-11-01,2026-11-03,2026-10-05 08:00:00,cancelled_by_guest,1,2,2,0,,180000 KRW,15,,,,,cn,Double Room,2,2026-10-10,`;

describe("부킹닷컴", () => {
  it("예약·수수료·정산액을 계산하고 개인정보 칸은 남기지 않는다", () => {
    const { reservations } = parseExport("booking", BOOKING);
    expect(reservations[0]).toMatchObject({
      confirmation: "4012345678", status: "confirmed", adults: 2, children: 1, nights: 2,
      guestPaid: 240000, commission: 36000, payoutAmount: 204000, currency: "KRW", listing: "Double Room",
    });
    expect(reservations[0].raw).not.toHaveProperty("guest name s");
    expect(reservations[0].raw).not.toHaveProperty("remarks");
    expect(reservations[0].raw["children s ages"]).toBe("7");
  });

  it("수수료 금액이 없으면 수수료율로 계산하고 취소를 인식한다", () => {
    const { reservations } = parseExport("booking", BOOKING);
    expect(reservations[1]).toMatchObject({ status: "cancelled", commission: 27000, cancelledAt: "2026-10-10" });
  });
});

const TRIP = `订单号,入住人,入住日期,离店日期,预订日期,订单状态,成人,儿童,间夜,总价,结算价,币种,房型
1128000001,ZHANG/SAN,2026-12-01,2026-12-04,2026-11-01,已确认,2,0,3,600000,510000,KRW,Twin Room
1128000002,LI/SI,2026-12-10,2026-12-11,2026-11-02,已取消,1,0,1,200000,170000,KRW,Twin Room`;

describe("트립닷컴", () => {
  it("중국어 헤더 파일을 읽고 결제액-정산액으로 수수료를 계산한다", () => {
    const { reservations } = parseExport("trip", TRIP);
    expect(reservations[0]).toMatchObject({
      confirmation: "1128000001", status: "confirmed", adults: 2, nights: 3,
      guestPaid: 600000, payoutAmount: 510000, commission: 90000,
    });
    expect(reservations[1].status).toBe("cancelled");
    expect(JSON.stringify(reservations)).not.toMatch(/ZHANG|LI\/SI/);
  });
});

describe("엑셀(xlsx) 내보내기", () => {
  it("첫 시트를 CSV 로 바꿔 트립닷컴 화면과 같은 헤더를 읽고, 게스트 이름은 버린다", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { xlsxToCsv } = await import("../lib/parsers/xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Reservations");
    ws.addRow(["Guest(s)", "Amount", "Check-in", "Check-out", "Room type", "Booking date", "Reservation", "Status"]);
    ws.addRow(["KIM/TEST", "KRW 237169.00", "Nov 7, 2026", "Nov 8, 2026", "Queen Bed 2 Room, 1 room(s)", "Sep 29, 2026", "1400829519763961", "Confirmed"]);
    const csv = await xlsxToCsv(Buffer.from(await wb.xlsx.writeBuffer()));
    const { reservations } = parseExport("trip", csv);
    expect(reservations).toHaveLength(1);
    const r = reservations[0];
    expect(r.confirmation).toBe("1400829519763961");
    expect(r.checkIn).toBe("2026-11-07");
    expect(r.nights).toBe(1);
    expect(r.status).toBe("confirmed");
    expect(JSON.stringify(r.raw)).not.toContain("KIM");
  });
});
