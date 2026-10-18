import type { Channel } from "./types";

// 예약 한 건의 결제액·수수료·정산액을 화면에 보여 줄 때 쓰는 계산. 파일에 없는 값은 채널별 방식으로 역산한다.
// 2026-10 사장님이 확인한 구조:
// - 에어비앤비: 호스트 전액 부담 수수료. 손님 결제액 = 정산액 + 호스트 수수료 (파일의 Service fee).
// - 부킹닷컴: 요금(청소비 포함)에서 수수료 15% + (Booking.com 결제 시) 결제 서비스 수수료 2.5%.
// - 트립닷컴: 입금가만 줌. 수수료는 객실 요금에만, 청소비는 그대로 들어온다.
//   객실 판매가 = (입금가 − 청소비) ÷ (1 − 수수료율), 결제액 = 객실 판매가 + 청소비.
//   호스트가 건 프로모션(회원 특가 등)은 판매가에 이미 반영돼 있다. 트립닷컴이 부담하는 쿠폰(리뷰 리워드 등)은
//   파일에 없어서 실제 손님 결제액은 이보다 적을 수 있지만, 수수료·정산액은 그대로다 (2026-10 11/11 화면으로 확인).

export interface TripConfig { commissionPct: number; cleaningFee: number }
export const TRIP_DEFAULTS: TripConfig = { commissionPct: 15, cleaningFee: 50_000 };

export interface AmountInput {
  channel: Channel;
  guest_paid: number | string | null;
  commission: number | string | null;
  payout_amount: number | string | null;
}

export interface Amounts {
  guestPaid: number | null;
  commission: number | null;
  payout: number | null;
  estimated: boolean; // 결제액·수수료 중 하나라도 역산했으면 true
  steps: { label: string; value: number | null; note?: string }[]; // "계산 과정" 줄
  note: string;
}

const num = (v: number | string | null): number | null => (v === null || v === "" ? null : Number(v));

export function computeAmounts(r: AmountInput, trip: TripConfig = TRIP_DEFAULTS): Amounts {
  const paid = num(r.guest_paid);
  const fee = num(r.commission);
  const payout = num(r.payout_amount);

  if (r.channel === "airbnb") {
    const gross = paid ?? (payout !== null && fee !== null ? payout + fee : null);
    return {
      guestPaid: gross, commission: fee, payout, estimated: paid === null && gross !== null,
      steps: [
        { label: "정산액 (파일)", value: payout },
        { label: "+ 에어비앤비 수수료 (파일)", value: fee, note: gross && fee !== null ? `결제액의 ${((fee / gross) * 100).toFixed(1)}%` : undefined },
        { label: "= 손님 결제액", value: gross },
      ],
      note: "에어비앤비는 수수료를 호스트가 모두 내는 방식이라, 손님 결제액 = 정산액 + 수수료로 계산해요. 파일에 손님 결제액이 따로 없어서 더한 값이에요.",
    };
  }

  if (r.channel === "booking") {
    const pct = paid && fee !== null ? (fee / paid) * 100 : null;
    const withPayments = pct !== null && pct > 16;
    return {
      guestPaid: paid, commission: fee, payout, estimated: false,
      steps: [
        { label: "요금 (파일, 청소비 포함)", value: paid },
        { label: "− 수수료 15%", value: paid !== null ? Math.round(paid * 0.15) : null },
        ...(withPayments ? [{ label: "− 결제 서비스 수수료 2.5%", value: paid !== null ? Math.round(paid * 0.025) : null }] : []),
        { label: "= 정산액", value: payout },
      ],
      note: withPayments
        ? "Booking.com이 결제를 대행한 예약이라 수수료 15%에 결제 서비스 수수료 2.5%가 더 빠져요 (총 17.5%). 청소비에도 수수료가 붙어요."
        : "부킹닷컴은 청소비를 포함한 요금 전체에 수수료 15%가 붙어요.",
    };
  }

  // 트립닷컴
  if (paid !== null && fee !== null) {
    return { guestPaid: paid, commission: fee, payout, estimated: false, steps: [], note: "파일에 있는 금액이에요." };
  }
  if (payout === null) return { guestPaid: null, commission: null, payout, estimated: false, steps: [], note: "" };
  const rate = trip.commissionPct / 100;
  const cleaning = Math.min(trip.cleaningFee, payout);
  const roomPayout = payout - cleaning;
  const roomPrice = roomPayout / (1 - rate);
  const gross = Math.round(roomPrice + cleaning);
  return {
    guestPaid: gross, commission: gross - payout, payout, estimated: true,
    steps: [
      { label: "입금가 = 정산액 (파일)", value: payout },
      { label: "− 청소비 (수수료 없음)", value: cleaning },
      { label: "= 객실 입금분", value: roomPayout },
      { label: `÷ (1 − 수수료 ${trip.commissionPct}%) = 객실 판매가`, value: Math.round(roomPrice) },
      { label: "+ 청소비", value: cleaning },
      { label: "= 손님 결제액 (트립 쿠폰 전)", value: gross },
      { label: "수수료 = 결제액 − 정산액", value: gross - payout },
    ],
    note: `트립닷컴 파일에는 입금가만 있어서 역산했어요. 수수료 ${trip.commissionPct}%는 객실 요금에만 붙고, 청소비 ${trip.cleaningFee.toLocaleString("ko-KR")}원은 그대로 들어온다고 보고 계산해요 (설정에서 바꿀 수 있어요). 회원 특가처럼 사장님이 건 할인은 이미 반영돼 있어요. 리뷰 리워드 같은 트립닷컴 부담 쿠폰은 파일에 안 나와서 실제 손님 결제액은 그만큼 적을 수 있지만, 수수료와 정산액에는 영향이 없어요.`,
  };
}
