import Papa from "papaparse";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, monthRange } from "@/lib/format";
import { GENDER_LABELS, listReservations, STATUS_LABELS } from "@/lib/reservations";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/types";

export async function GET(req: Request) {
  await requireOwner();
  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth();
  const channelParam = url.searchParams.get("channel") as Channel | null;
  const channel = channelParam && CHANNELS.includes(channelParam) ? channelParam : undefined;
  const rows = await listReservations(db(), { channel, ...monthRange(month) });

  const csv = Papa.unparse(
    rows.map((r) => ({
      채널: CHANNEL_LABELS[r.channel],
      예약번호: r.confirmation,
      상태: STATUS_LABELS[r.status] ?? r.status,
      객실: r.listing ?? "",
      예약일: r.booked_at ?? "",
      체크인: r.check_in,
      체크아웃: r.check_out,
      박: r.nights,
      성인: r.adults ?? "",
      아동: r.children ?? "",
      유아: r.infants ?? "",
      통화: r.currency,
      게스트결제액: r.guest_paid ?? "",
      수수료: r.commission ?? "",
      정산액: r.payout_amount ?? "",
      성별: r.genders?.split(",").map((g) => GENDER_LABELS[g] ?? g).join(" ") ?? "",
      나이: r.ages?.replace(/,/g, " ") ?? "",
    })),
  );
  // 엑셀에서 한글이 깨지지 않도록 BOM 을 붙인다.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reservations-${month}${channel ? `-${channel}` : ""}.csv"`,
    },
  });
}
