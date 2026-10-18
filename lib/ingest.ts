import type postgres from "postgres";
import type { Channel, NormalizedReservation } from "./types";

// auto_login: 서버 자동 수집, owner_pc: 사장님 컴퓨터 수집 프로그램, csv_upload: 파일 올리기 화면
export type ImportSource = "auto_login" | "owner_pc" | "csv_upload";

// 예약을 넣거나 갱신한다. 새 파일에 없는 칸(null)은 기존 값을 지워버리지 않는다.
export async function upsertReservations(
  sql: postgres.Sql,
  rows: NormalizedReservation[],
  source: ImportSource,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const [res] = await sql<{ inserted: boolean }[]>`
      INSERT INTO reservations (
        channel, confirmation, status, listing, adults, children, infants,
        booked_at, check_in, check_out, nights, currency, gross_amount, discount_amount, guest_paid,
        commission, taxes, payout_amount, cancelled_at, source, raw
      ) VALUES (
        ${r.channel}, ${r.confirmation}, ${r.status ?? "confirmed"}, ${r.listing},
        ${r.adults}, ${r.children}, ${r.infants}, ${r.bookedAt}, ${r.checkIn}, ${r.checkOut}, ${r.nights},
        ${r.currency}, ${r.grossAmount}, ${r.discountAmount}, ${r.guestPaid}, ${r.commission}, ${r.taxes},
        ${r.payoutAmount}, ${r.cancelledAt}, ${source}, ${sql.json(r.raw)}
      )
      ON CONFLICT (channel, confirmation) DO UPDATE SET
        status          = CASE WHEN reservations.status_by_owner THEN reservations.status
                               ELSE COALESCE(${r.status}::text, reservations.status) END,
        listing         = COALESCE(EXCLUDED.listing, reservations.listing),
        adults          = COALESCE(EXCLUDED.adults, reservations.adults),
        children        = COALESCE(EXCLUDED.children, reservations.children),
        infants         = COALESCE(EXCLUDED.infants, reservations.infants),
        booked_at       = COALESCE(EXCLUDED.booked_at, reservations.booked_at),
        check_in        = EXCLUDED.check_in,
        check_out       = EXCLUDED.check_out,
        nights          = EXCLUDED.nights,
        currency        = EXCLUDED.currency,
        gross_amount    = COALESCE(EXCLUDED.gross_amount, reservations.gross_amount),
        discount_amount = COALESCE(EXCLUDED.discount_amount, reservations.discount_amount),
        guest_paid      = COALESCE(EXCLUDED.guest_paid, reservations.guest_paid),
        commission      = COALESCE(EXCLUDED.commission, reservations.commission),
        taxes           = COALESCE(EXCLUDED.taxes, reservations.taxes),
        payout_amount   = COALESCE(EXCLUDED.payout_amount, reservations.payout_amount),
        cancelled_at    = COALESCE(EXCLUDED.cancelled_at, reservations.cancelled_at),
        raw             = reservations.raw || EXCLUDED.raw,
        updated_at      = now()
      RETURNING (xmax = 0) AS inserted
    `;
    if (res?.inserted) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

export async function startSyncRun(sql: postgres.Sql, channel: Channel, source: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO sync_runs (channel, source) VALUES (${channel}, ${source}) RETURNING id`;
  return row.id;
}

export async function finishSyncRun(
  sql: postgres.Sql,
  id: number,
  result: { ok: boolean; inserted?: number; updated?: number; error?: string },
): Promise<void> {
  await sql`
    UPDATE sync_runs SET finished_at = now(), ok = ${result.ok}, inserted = ${result.inserted ?? 0},
      updated = ${result.updated ?? 0}, error = ${result.error ?? null}
    WHERE id = ${id}`;
}
