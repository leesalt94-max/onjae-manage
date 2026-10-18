import type { NormalizedReservation, ParseResult, ReservationStatus } from "../types";
import {
  detectCurrency, nightsBetween, parseAmount, parseDate, parseIntOrNull, pick, stripPersonal, type Row,
} from "./common";

// 부킹닷컴 엑스트라넷 > 예약 > 다운로드(CSV·xls) 파일. 2026-10 한국어 화면 실제 xls 헤더도 받는다.
const B = {
  confirmation: ["Book number", "Reservation number", "예약 번호"],
  checkIn: ["Check-in", "Arrival", "체크인"],
  checkOut: ["Check-out", "Departure", "체크아웃"],
  booked: ["Booked on", "예약일", "예약 날짜"],
  status: ["Status", "상태", "예약 상태"],
  people: ["People", "Persons", "인원"],
  adults: ["Adults", "성인"],
  children: ["Children", "아동"],
  price: ["Price", "Total price", "요금"],
  commissionAmount: ["Commission amount", "수수료 금액"],
  commissionPct: ["Commission %", "Commission", "수수료율"],
  currency: ["Currency", "통화"],
  cancelled: ["Cancellation date", "취소일"],
  unit: ["Unit type", "Room type", "객실 유형"],
  payment: ["Payment status", "결제 상태"],
  nights: ["Duration (nights)", "Nights", "박", "숙박일수(박)"],
};

function mapStatus(value: string | null): ReservationStatus {
  const v = (value ?? "").toLowerCase();
  if (v.includes("no_show") || v.includes("no show") || v.includes("노쇼")) return "no_show";
  if (v.includes("cancel") || v.includes("취소")) return "cancelled";
  return "confirmed";
}

// Booking.com 이 결제를 대행한 예약(결제 상태 "Booking.com을 통한 결제" / "Paid online")은 수수료와 별도로
// 결제 서비스 수수료 2.5%(청소비 포함 총액 기준)가 더 빠진다. 파일에는 없어 직접 계산한다.
// 2026-10 사장님 확인: 134,645 × (15% + 2.5%) 공제 → 입금액 111,082 원으로 화면과 일치.
export const BOOKING_PAYMENTS_FEE_PCT = 2.5;

function paidThroughBooking(value: string | null): boolean {
  return /booking\.com|paid online|online payment/i.test(value ?? "");
}

export function parseBooking(rows: Row[]): ParseResult {
  const skipped: ParseResult["skipped"] = [];
  const reservations: NormalizedReservation[] = [];

  rows.forEach((row, i) => {
    const confirmation = pick(row, B.confirmation);
    const checkIn = parseDate(pick(row, B.checkIn));
    const checkOut = parseDate(pick(row, B.checkOut));
    if (!confirmation || !checkIn || !checkOut) {
      skipped.push({ row: i + 2, reason: "예약번호 또는 날짜 없음" });
      return;
    }
    const priceRaw = pick(row, B.price);
    const price = parseAmount(priceRaw);
    let commission = parseAmount(pick(row, B.commissionAmount));
    if (commission === null && price !== null) {
      const pct = parseAmount(pick(row, B.commissionPct));
      if (pct !== null) commission = Math.round(price * pct) / 100;
    }
    if (commission !== null && price !== null && paidThroughBooking(pick(row, B.payment))) {
      commission = Math.round((commission + (price * BOOKING_PAYMENTS_FEE_PCT) / 100) * 100) / 100;
    }
    const adults = parseIntOrNull(pick(row, B.adults)) ?? parseIntOrNull(pick(row, B.people));

    reservations.push({
      channel: "booking",
      confirmation,
      status: mapStatus(pick(row, B.status)),
      listing: pick(row, B.unit),
      adults,
      children: parseIntOrNull(pick(row, B.children)),
      infants: null,
      bookedAt: parseDate(pick(row, B.booked)),
      checkIn,
      checkOut,
      nights: parseIntOrNull(pick(row, B.nights)) ?? nightsBetween(checkIn, checkOut),
      currency: pick(row, B.currency) ?? detectCurrency(priceRaw) ?? "KRW",
      grossAmount: price,
      discountAmount: null,
      guestPaid: price,
      commission,
      taxes: null,
      payoutAmount: price !== null && commission !== null ? price - commission : null,
      cancelledAt: parseDate(pick(row, B.cancelled)),
      raw: stripPersonal(row),
    });
  });

  return { reservations, skipped };
}
