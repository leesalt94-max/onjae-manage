import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, money, monthRange } from "@/lib/format";
import { AGE_LABELS, GENDER_LABELS } from "@/lib/guests";
import { countCancelled, listReservations, STATUS_LABELS } from "@/lib/reservations";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/types";
import type { SearchParams } from "../flash";
import { OwnerShell } from "../nav";

export const dynamic = "force-dynamic";

export default async function ReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const month = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const channel = CHANNELS.includes(params.channel as Channel) ? (params.channel as Channel) : undefined;
  const range = monthRange(month);
  const [rows, cancelled] = await Promise.all([listReservations(db(), { channel, ...range }), countCancelled(db(), { channel, ...range })]);
  const query = new URLSearchParams({ month, ...(channel ? { channel } : {}) });
  const link = (m: string) => `/reservations?${new URLSearchParams({ month: m, ...(channel ? { channel } : {}) })}`;
  const shift = (n: number) => {
    const [y, mm] = month.split("-").map(Number);
    return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7);
  };
  const payoutSum = rows.reduce((a, r) => a + (r.currency === "KRW" ? Number(r.payout_amount ?? 0) : 0), 0);
  const nightsSum = rows.reduce((a, r) => a + (r.nights ?? 0), 0);
  const guestText = (r: (typeof rows)[number]) =>
    r.genders
      ? r.genders.split(",").map((g, i) => `${GENDER_LABELS[g] ?? g}·${AGE_LABELS[r.ages?.split(",")[i] ?? "unknown"]}`).join(", ")
      : "입력";

  return (
    <OwnerShell>
      <h1>예약 목록</h1>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="month-nav">
          <a href={link(shift(-1))} aria-label="이전 달">‹ 이전</a>
          <strong>{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</strong>
          <a href={link(shift(1))} aria-label="다음 달">다음 ›</a>
        </div>
        {month !== currentMonth() && <a href={link(currentMonth())}>이번 달로</a>}
      </div>
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
      <p className="muted">
        {rows.length}건 · {nightsSum}박 · 정산 {money(payoutSum, "KRW")}
        {cancelled > 0 && ` · 취소 ${cancelled}건은 목록에서 뺐어요`}
      </p>
      {rows.length > 0 && (
        <div className="panel cards">
          {rows.map((r) => (
            <div key={r.id} className="card">
              <div className="top">
                <span>{r.check_in.slice(5).replace("-", "/")} · {r.nights}박</span>
                <strong>{money(r.payout_amount, r.currency)}</strong>
              </div>
              <div className="top">
                <span className={`badge ${r.channel}`}>{CHANNEL_LABELS[r.channel]}</span>
                <span className="muted">{(r.adults ?? 0) + (r.children ?? 0) ? `${(r.adults ?? 0) + (r.children ?? 0)}명` : ""}</span>
              </div>
              <div className="top">
                <span className="muted small">{r.confirmation}</span>
                <a href={`/reservations/${r.id}`}>{guestText(r)}</a>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="panel table-wrap wide-only">
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
                    <a href={`/reservations/${r.id}`}>{guestText(r)}</a>
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
