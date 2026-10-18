import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGE_BANDS, AGE_LABELS, getReservationGuests, MAX_GUESTS } from "@/lib/guests";
import { STATUS_LABELS } from "@/lib/reservations";
import { CHANNEL_LABELS } from "@/lib/types";
import { saveGuestsAction } from "../../actions";
import { Flash, type SearchParams } from "../../flash";
import { OwnerShell } from "../../nav";

export const dynamic = "force-dynamic";

export default async function ReservationGuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await requireOwner();
  const id = Number((await params).id);
  const query = await searchParams;
  const data = Number.isInteger(id) && id > 0 ? await getReservationGuests(db(), id) : null;
  if (!data) notFound();
  const { reservation: r, guests } = data;

  // 줄 수: 이미 입력한 인원, 플랫폼 인원수 중 큰 값. "한 명 추가"로 늘릴 수 있다.
  const headcount = (r.adults ?? 0) + (r.children ?? 0) + (r.infants ?? 0);
  const requested = Number(query.rows) || 0;
  const rows = Math.min(MAX_GUESTS, Math.max(1, guests.length, headcount, requested));

  return (
    <OwnerShell>
      <p><a href="/reservations">← 예약 목록</a></p>
      <h1>투숙객 정보</h1>
      <Flash params={query} />
      <div className="panel">
        <div className="row">
          <span className={`badge ${r.channel}`}>{CHANNEL_LABELS[r.channel]}</span>
          <strong>{r.confirmation}</strong>
          <span className="muted">{STATUS_LABELS[r.status] ?? r.status}</span>
        </div>
        <p style={{ margin: "8px 0 0" }}>
          {r.check_in} ~ {r.check_out} ({r.nights}박) · 플랫폼 인원: 성인 {r.adults ?? "-"}, 아동 {r.children ?? "-"}, 유아 {r.infants ?? "-"}
        </p>
      </div>

      <form action={saveGuestsAction} className="panel stack" style={{ maxWidth: 520 }}>
        <input type="hidden" name="reservationId" value={r.id} />
        {Array.from({ length: rows }, (_, i) => {
          const g = guests[i];
          // 아직 입력 전이면, 플랫폼이 알려준 아동·유아 인원만큼 뒤쪽 줄을 "아동"으로 미리 골라 둔다.
          const isChildSeat = !g && guests.length === 0 && i >= (r.adults ?? 0) && i < headcount;
          return (
            <div className="row" key={i}>
              <strong style={{ width: 40 }}>{i + 1}번</strong>
              <select name="gender" defaultValue={g?.gender ?? ""} aria-label={`${i + 1}번 성별`}>
                <option value="">성별</option>
                <option value="male">남</option>
                <option value="female">여</option>
                <option value="unknown">모름</option>
              </select>
              <select name="ageBand" defaultValue={g?.age_band ?? (isChildSeat ? "child" : "")} aria-label={`${i + 1}번 나이대`}>
                <option value="">나이대</option>
                {AGE_BANDS.map((band) => <option key={band} value={band}>{AGE_LABELS[band]}</option>)}
              </select>
            </div>
          );
        })}
        {rows < MAX_GUESTS && <a href={`?rows=${rows + 1}`}>+ 한 명 추가</a>}
        <p className="muted" style={{ margin: 0 }}>모르는 칸은 "모름"이나 빈칸으로 두세요. 성별·나이대가 둘 다 빈 줄은 저장되지 않고, 전부 비우면 이 예약은 미입력으로 남습니다.</p>
        <button type="submit">저장</button>
      </form>
    </OwnerShell>
  );
}
