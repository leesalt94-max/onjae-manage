import type { NormalizedReservation, ParseResult, ReservationStatus } from "../types";
import {
  detectCurrency, nightsBetween, parseAmount, parseDate, parseIntOrNull, pick, stripPersonal, type Row,
} from "./common";

// 트립닷컴 이부킹(ebooking) 주문 내보내기. 실제 파일을 아직 보지 못해 영어·중국어·한국어 헤더를 넓게 받는다.
// 첫 실제 파일을 받으면 헤더를 확인해 여기 별칭을 보강해야 한다.
const T = {
  confirmation: ["Order ID", "Order No.", "Booking No.", "订单号", "주문번호", "예약번호"],
  checkIn: ["Check-in", "Check-in date", "Arrival date", "入住日期", "체크인"],
  checkOut: ["Check-out", "Check-out date", "Departure date", "离店日期", "체크아웃"],
  booked: ["Booking date", "Order date", "预订日期", "下单时间", "예약일"],
  status: ["Status", "Order status", "订单状态", "상태"],
  adults: ["Adults", "成人", "성인"],
  children: ["Children", "儿童", "아동"],
  guests: ["Guests", "人数", "인원"],
  roomNights: ["Room nights", "Nights", "间夜", "숙박일수"],
  total: ["Total price", "Total amount", "Selling price", "总价", "판매가"],
  settlement: ["Settlement amount", "Payable amount", "Net price", "结算价", "结算金额", "정산금액"],
  commission: ["Commission", "佣金", "수수료"],
  currency: ["Currency", "币种", "통화"],
  room: ["Room type", "房型", "객실"],
};

function mapStatus(value: string | null): ReservationStatus {
  const v = (value ?? "").toLowerCase();
  if (v.includes("no show") || v.includes("noshow") || v.includes("未入住")) return "no_show";
  if (v.includes("cancel") || v.includes("取消") || v.includes("취소")) return "cancelled";
  if (v.includes("complete") || v.includes("离店") || v.includes("완료")) return "completed";
  return "confirmed";
}

export function parseTrip(rows: Row[]): ParseResult {
  const skipped: ParseResult["skipped"] = [];
  const reservations: NormalizedReservation[] = [];

  rows.forEach((row, i) => {
    const confirmation = pick(row, T.confirmation);
    const checkIn = parseDate(pick(row, T.checkIn));
    const checkOut = parseDate(pick(row, T.checkOut));
    if (!confirmation || !checkIn || !checkOut) {
      skipped.push({ row: i + 2, reason: "예약번호 또는 날짜 없음" });
      return;
    }
    const totalRaw = pick(row, T.total);
    const total = parseAmount(totalRaw);
    const settlement = parseAmount(pick(row, T.settlement));
    let commission = parseAmount(pick(row, T.commission));
    if (commission === null && total !== null && settlement !== null) commission = total - settlement;

    reservations.push({
      channel: "trip",
      confirmation,
      status: mapStatus(pick(row, T.status)),
      listing: pick(row, T.room),
      adults: parseIntOrNull(pick(row, T.adults)) ?? parseIntOrNull(pick(row, T.guests)),
      children: parseIntOrNull(pick(row, T.children)),
      infants: null,
      bookedAt: parseDate(pick(row, T.booked)),
      checkIn,
      checkOut,
      nights: parseIntOrNull(pick(row, T.roomNights)) ?? nightsBetween(checkIn, checkOut),
      currency: pick(row, T.currency) ?? detectCurrency(totalRaw) ?? "KRW",
      grossAmount: total,
      discountAmount: null,
      guestPaid: total,
      commission,
      taxes: null,
      payoutAmount: settlement ?? (total !== null && commission !== null ? total - commission : null),
      cancelledAt: null,
      raw: stripPersonal(row),
    });
  });

  return { reservations, skipped };
}
