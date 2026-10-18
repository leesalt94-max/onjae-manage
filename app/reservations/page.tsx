import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, money, monthRange } from "@/lib/format";
import { AGE_LABELS, GENDER_LABELS, REGION_LABELS } from "@/lib/guests";
import { countCancelled, listReservations, STATUS_LABELS } from "@/lib/reservations";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/types";
import type { SearchParams } from "../flash";
import { OwnerShell } from "../nav";
import { AmountCell } from "./amount";
import { computeAmounts } from "@/lib/amounts";
import { getTripConfig } from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function ReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const month = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const channel = CHANNELS.includes(params.channel as Channel) ? (params.channel as Channel) : undefined;
  const range = monthRange(month);
  const [rows, cancelled, trip] = await Promise.all([
    listReservations(db(), { channel, ...range }), countCancelled(db(), { channel, ...range }), getTripConfig(db()),
  ]);
  const amounts = new Map(rows.map((r) => [r.id, computeAmounts(r, trip)]));
  const query = new URLSearchParams({ month, ...(channel ? { channel } : {}) });
  const link = (m: string) => `/reservations?${new URLSearchParams({ month: m, ...(channel ? { channel } : {}) })}`;
  const shift = (n: number) => {
    const [y, mm] = month.split("-").map(Number);
    return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7);
  };
  const payoutSum = rows.reduce((a, r) => a + (r.currency === "KRW" ? Number(r.payout_amount ?? 0) : 0), 0);
  const nightsSum = rows.reduce((a, r) => a + (r.nights ?? 0), 0);
  const guestText = (r: (typeof rows)[number]) => {
    const people = r.genders
      ? r.genders.split(",").map((g, i) => `${GENDER_LABELS[g] ?? g}·${AGE_LABELS[r.ages?.split(",")[i] ?? "unknown"]}`).join(", ")
      : "";
    const text = [r.guest_region ? REGION_LABELS[r.guest_region] : "", people].filter(Boolean).join(" · ");
    return text || "입력";
  };

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
      <details className="panel">
        <summary>결제액·수수료는 어떻게 계산하나요? <span className="muted small">(* 표시는 역산한 값, 금액을 누르면 계산 과정이 보여요)</span></summary>
        <ul className="small">
          <li><b>부킹닷컴</b>: 파일의 요금(청소비 포함)이 결제액이에요. 수수료 15%에, Booking.com이 결제를 대행한 예약은 결제 서비스 수수료 2.5%가 더 빠져요 (총 17.5%).</li>
          <li><b>에어비앤비</b>: 호스트가 수수료를 모두 내는 방식이라 결제액 = 정산액 + 수수료(파일의 Service fee)예요.</li>
          <li><b>트립닷컴</b>: 파일에 입금가(정산액)만 있어요. 수수료 {trip.commissionPct}%는 객실 요금에만 붙고 청소비 {trip.cleaningFee.toLocaleString("ko-KR")}원은 그대로 들어오므로, 객실 판매가 = (입금가 − 청소비) ÷ (1 − {trip.commissionPct}%), 결제액 = 객실 판매가 + 청소비, 수수료 = 결제액 − 입금가로 계산해요. 회원 특가처럼 사장님이 건 할인은 이미 반영돼 있고, 리뷰 리워드 같은 트립닷컴 부담 쿠폰은 파일에 없어서 실제 손님 결제액은 그만큼 적을 수 있어요 (수수료·정산액에는 영향 없음). 수수료율·청소비는 <a href="/settings">설정</a>에서 바꿀 수 있어요.</li>
        </ul>
      </details>
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
              <div className="top small">
                <span className="muted">결제 <AmountCell amounts={amounts.get(r.id)!} field="guestPaid" currency={r.currency} /></span>
                <span className="muted">수수료 <AmountCell amounts={amounts.get(r.id)!} field="commission" currency={r.currency} /></span>
              </div>
              <div className="top">
                <span className="muted small">{r.confirmation}</span>
                <a href={`/reservations/${r.id}`}>{guestText(r)}</a>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="panel table-wrap wide-only calc-host">
        {rows.length === 0 ? <p className="muted">이 기간 예약이 없습니다.</p> : (
          <table>
            <thead>
              <tr>
                <th>체크인</th><th>박</th><th>채널</th><th>예약번호</th><th>상태</th><th className="num">성인/아동/유아</th>
                <th className="num">결제액</th><th className="num">수수료</th><th className="num">정산액</th><th>나라·성별·나이</th>
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
                  <td className="num"><AmountCell amounts={amounts.get(r.id)!} field="guestPaid" currency={r.currency} /></td>
                  <td className="num"><AmountCell amounts={amounts.get(r.id)!} field="commission" currency={r.currency} /></td>
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
