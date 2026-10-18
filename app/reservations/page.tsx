import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, money, monthRange } from "@/lib/format";
import { AGE_LABELS, GENDER_LABELS } from "@/lib/guests";
import { listReservations, STATUS_LABELS } from "@/lib/reservations";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/types";
import type { SearchParams } from "../flash";
import { OwnerShell } from "../nav";

export const dynamic = "force-dynamic";

export default async function ReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const month = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const channel = CHANNELS.includes(params.channel as Channel) ? (params.channel as Channel) : undefined;
  const rows = await listReservations(db(), { channel, ...monthRange(month) });
  const query = new URLSearchParams({ month, ...(channel ? { channel } : {}) });

  return (
    <OwnerShell>
      <h1>예약 목록</h1>
      <form className="row panel" method="get">
        <label>월 <input type="month" name="month" defaultValue={month} /></label>
        <label>
          채널
          <select name="channel" defaultValue={channel ?? ""}>
            <option value="">전체</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
          </select>
        </label>
        <button type="submit">보기</button>
        <a href={`/api/reservations/export?${query}`}>엑셀(CSV)로 내려받기</a>
      </form>
      <div className="panel table-wrap">
        {rows.length === 0 ? <p className="muted">이 기간 예약이 없습니다.</p> : (
          <table>
            <thead>
              <tr>
                <th>체크인</th><th>박</th><th>채널</th><th>예약번호</th><th>상태</th><th className="num">성인/아동/유아</th>
                <th className="num">결제액</th><th className="num">수수료</th><th className="num">정산액</th><th>성별·나이</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.check_in}</td>
                  <td>{r.nights}</td>
                  <td><span className={`badge ${r.channel}`}>{CHANNEL_LABELS[r.channel]}</span></td>
                  <td>{r.confirmation}</td>
                  <td>{STATUS_LABELS[r.status] ?? r.status}</td>
                  <td className="num">{[r.adults, r.children, r.infants].map((v) => v ?? "-").join(" / ")}</td>
                  <td className="num">{money(r.guest_paid, r.currency)}</td>
                  <td className="num">{money(r.commission, r.currency)}</td>
                  <td className="num">{money(r.payout_amount, r.currency)}</td>
                  <td>
                    <a href={`/reservations/${r.id}`}>
                      {r.genders
                        ? r.genders.split(",").map((g, i) => `${GENDER_LABELS[g] ?? g}·${AGE_LABELS[r.ages?.split(",")[i] ?? "unknown"]}`).join(", ")
                        : "입력"}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </OwnerShell>
  );
}
