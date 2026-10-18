import type { NormalizedReservation, ParseResult, ReservationStatus } from "../types";
import {
  detectCurrency, headerMatches, nightsBetween, parseAmount, parseDate, parseIntOrNull, pick, stripPersonal, type Row,
} from "./common";

// 에어비앤비 파일은 두 종류를 받는다.
// 1) 예약 목록 내보내기(호스팅 > 예약 > 내보내기): 인원수와 예상 수입
// 2) 거래 내역 CSV(호스팅 수입 > 수령 완료·예정 금액 > CSV 내보내기): 수수료·정산액. 2026-10 부터 수집기는 이것만 받는다
// 같은 예약번호로 합쳐지며, 각 파일은 자기가 가진 칸만 채운다.

const A = {
  confirmation: ["Confirmation code", "Confirmation Code", "확인 코드", "예약 번호"],
  status: ["Status", "상태"],
  adults: ["# of adults", "Number of adults", "성인 수", "성인"],
  children: ["# of children", "Number of children", "어린이 수", "어린이"],
  infants: ["# of infants", "Number of infants", "유아 수", "유아"],
  start: ["Start date", "Start Date", "체크인", "시작일"],
  end: ["End date", "End Date", "체크아웃", "종료일"],
  nights: ["# of nights", "Nights", "박", "숙박일수"],
  booked: ["Booked", "Booking date", "예약일"],
  listing: ["Listing", "숙소"],
  earnings: ["Earnings", "수입"],
  type: ["Type", "유형"],
  currency: ["Currency", "통화"],
  amount: ["Amount", "금액"],
  serviceFee: ["Service fee", "Host service fee", "서비스 수수료"],
  gross: ["Gross earnings", "총 수입"],
  taxes: ["Occupancy taxes", "숙박세"],
};

function mapStatus(value: string | null): ReservationStatus {
  const v = (value ?? "").toLowerCase();
  if (v.includes("cancel") || v.includes("취소")) return "cancelled";
  if (v.includes("past") || v.includes("completed") || v.includes("이전")) return "completed";
  return "confirmed";
}

function base(row: Row, index: number, skipped: ParseResult["skipped"]) {
  const confirmation = pick(row, A.confirmation);
  const checkIn = parseDate(pick(row, A.start));
  const checkOut = parseDate(pick(row, A.end));
  if (!confirmation || !checkIn || !checkOut) {
    skipped.push({ row: index + 2, reason: "예약번호 또는 날짜 없음" });
    return null;
  }
  return { confirmation, checkIn, checkOut };
}

export function parseAirbnb(rows: Row[]): ParseResult {
  const skipped: ParseResult["skipped"] = [];
  const reservations: NormalizedReservation[] = [];
  const isTransactions = headerMatches(rows, A.type) && headerMatches(rows, A.amount);

  rows.forEach((row, i) => {
    if (isTransactions) {
      const type = (pick(row, A.type) ?? "").toLowerCase();
      // 거래 내역에는 지급(Payout)·조정 행이 섞여 있다. 예약 행만 쓴다.
      if (!type.includes("reservation") && !type.includes("예약")) return;
    }
    const b = base(row, i, skipped);
    if (!b) return;
    const currency = pick(row, A.currency) ?? detectCurrency(pick(row, A.earnings) ?? pick(row, A.amount)) ?? "KRW";
    const nights = parseIntOrNull(pick(row, A.nights)) ?? nightsBetween(b.checkIn, b.checkOut);

    const common = {
      channel: "airbnb" as const,
      confirmation: b.confirmation,
      listing: pick(row, A.listing),
      bookedAt: parseDate(pick(row, A.booked)),
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      nights,
      currency,
      discountAmount: null,
      guestPaid: null,
      cancelledAt: null,
      raw: stripPersonal(row),
    };

    if (isTransactions) {
      const fee = parseAmount(pick(row, A.serviceFee));
      reservations.push({
        ...common,
        status: null,
        adults: null,
        children: null,
        infants: null,
        grossAmount: parseAmount(pick(row, A.gross)),
        commission: fee === null ? null : Math.abs(fee),
        taxes: parseAmount(pick(row, A.taxes)),
        payoutAmount: parseAmount(pick(row, A.amount)),
      });
    } else {
      reservations.push({
        ...common,
        status: mapStatus(pick(row, A.status)),
        adults: parseIntOrNull(pick(row, A.adults)),
        children: parseIntOrNull(pick(row, A.children)),
        infants: parseIntOrNull(pick(row, A.infants)),
        grossAmount: null,
        commission: null,
        taxes: null,
        payoutAmount: parseAmount(pick(row, A.earnings)),
      });
    }
  });

  return { reservations, skipped };
}
