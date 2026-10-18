export const CHANNELS = ["airbnb", "booking", "trip"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  airbnb: "에어비앤비",
  booking: "부킹닷컴",
  trip: "트립닷컴",
};

export type ReservationStatus = "confirmed" | "cancelled" | "no_show" | "completed";

// 플랫폼별 파일을 이 형태로 맞춘 뒤 DB 에 넣는다.
export interface NormalizedReservation {
  channel: Channel;
  confirmation: string;
  status: ReservationStatus | null; // null = 이 파일로는 알 수 없음
  listing: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  bookedAt: string | null; // YYYY-MM-DD
  checkIn: string;
  checkOut: string;
  nights: number;
  currency: string;
  grossAmount: number | null;
  discountAmount: number | null;
  guestPaid: number | null;
  commission: number | null;
  taxes: number | null;
  payoutAmount: number | null;
  cancelledAt: string | null;
  raw: Record<string, string>;
}

export interface ParseResult {
  reservations: NormalizedReservation[];
  skipped: { row: number; reason: string }[];
}
