import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, money, monthRange } from "@/lib/format";
import { pendingOtps } from "@/lib/otp";
import { REGION_LABELS } from "@/lib/guests";
import { computeAmounts } from "@/lib/amounts";
import { autoImportCalendarNotes } from "@/lib/calendar-notes";
import { monthTotals, stayRows } from "@/lib/insights";
import { getTripConfig, lastSyncs, upcoming } from "@/lib/stats";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/types";
import { Flash, type SearchParams } from "./flash";
import { OwnerShell } from "./nav";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const query = await searchParams;
  const sql = db();
  const month = currentMonth();
  const { from, to } = monthRange(month);
  await autoImportCalendarNotes(sql);
  const [stays, trip, next, syncs, otps] = await Promise.all([
    stayRows(sql, from, to),
    getTripConfig(sql),
    upcoming(sql, 7),
    lastSyncs(sql),
    pendingOtps(sql),
  ]);
  // 통계의 월별 정산액과 같은 기준: 이번 달에 묵는 밤만큼 나눠 더한다 (달을 넘는 예약은 이번 달 몫만).
  for (const r of stays) {
    if (r.commission === null) r.commission = computeAmounts({ channel: r.channel, guest_paid: null, commission: null, payout_amount: r.payout }, trip).commission;
  }
  const t = monthTotals(stays, from, to);

  return (
    <OwnerShell>
      <Flash params={query} />
      {otps.length > 0 && (
        <div className="notice warn">
          인증번호를 기다리는 로그인이 있어요. <a href="/otp">지금 입력하기</a>
        </div>
      )}
      <h1>{month} 요약</h1>
      {t.bookings === 0 ? <p className="muted">이번 달 숙박 예약이 아직 없습니다.</p> : (
        <div className="grid">
          <div className="panel kpi"><div className="label">정산 예정액</div><div className="value">{money(t.payout, "KRW")}</div></div>
          <div className="panel kpi"><div className="label">게스트 결제액</div><div className="value">{money(t.guestPaid, "KRW")}</div></div>
          <div className="panel kpi"><div className="label">플랫폼 수수료</div><div className="value">{money(t.commission, "KRW")}</div></div>
          <div className="panel kpi"><div className="label">예약 / 이번 달 숙박</div><div className="value">{t.bookings}건 / {t.nights}박</div></div>
        </div>
      )}
      <p className="muted small">이번 달에 묵는 밤 기준이에요. 달을 넘는 예약은 이번 달 몫만 넣어서 통계의 월별 정산액과 같아요.</p>

      <h2>7일 안의 체크인</h2>
      {next.length === 0 ? <div className="panel"><p className="muted">없음</p></div> : (
        <>
          <div className="panel table-wrap wide-only">
            <table>
              <thead><tr><th>체크인</th><th>체크아웃</th><th>채널</th><th>예약번호</th><th className="num">인원</th><th>나라·성별·나이</th></tr></thead>
              <tbody>
                {next.map((r) => (
                  <tr key={r.id}>
                    <td>{r.check_in}</td><td>{r.check_out}</td>
                    <td><span className={`badge ${r.channel}`}>{CHANNEL_LABELS[r.channel]}</span></td>
                    <td>{r.confirmation}</td>
                    <td className="num">{(r.adults ?? 0) + (r.children ?? 0) || "-"}</td>
                    <td><a href={`/reservations/${r.id}`}>{guestText(r)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel cards">
            {next.map((r) => (
              <a key={r.id} className="card card-link" href={`/reservations/${r.id}`}>
                <div className="top">
                  <strong>{r.check_in.slice(5).replace("-", "/")} ~ {r.check_out.slice(5).replace("-", "/")}</strong>
                  <span className={`badge ${r.channel}`}>{CHANNEL_LABELS[r.channel]}</span>
                </div>
                <div className="top">
                  <span className="muted">{(r.adults ?? 0) + (r.children ?? 0) ? `${(r.adults ?? 0) + (r.children ?? 0)}명` : "인원 모름"}</span>
                  <span className="link">{guestText(r)} ›</span>
                </div>
              </a>
            ))}
          </div>
        </>
      )}

      <h2>자동 수집 상태</h2>
      <div className="panel table-wrap wide-only">
        <table>
          <thead><tr><th>채널</th><th>마지막 실행</th><th>결과</th><th>마지막 성공</th></tr></thead>
          <tbody>
            {CHANNELS.map((ch) => {
              const s = syncs.find((x) => x.channel === ch);
              return (
                <tr key={ch}>
                  <td>{CHANNEL_LABELS[ch]}</td>
                  <td>{s ? when(s.started_at) : "-"}</td>
                  <td><SyncResult s={s} /></td>
                  <td>{s?.last_ok ? when(s.last_ok) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel cards">
        {CHANNELS.map((ch) => {
          const s = syncs.find((x) => x.channel === ch);
          return (
            <div key={ch} className="card">
              <div className="top"><span className={`badge ${ch}`}>{CHANNEL_LABELS[ch]}</span><SyncResult s={s} /></div>
              {s?.last_ok && <span className="muted small">마지막 성공 {when(s.last_ok)}</span>}
            </div>
          );
        })}
      </div>
      <div className="panel row" style={{ justifyContent: "space-between", marginTop: 24 }}>
        <span><strong>청소 매니저</strong> <span className="muted small">청소 일정 달력</span></span>
        <a className="button-link" href="https://onjae-calendar.vercel.app/" target="_blank" rel="noopener noreferrer">열기 ↗</a>
      </div>
      <div className="panel row" style={{ justifyContent: "space-between" }}>
        <span><strong>요금 계산기</strong> <span className="muted small">채널별 게시가·순수익</span></span>
        <a className="button-link" href="https://ota-pricing-calculator.vercel.app/" target="_blank" rel="noopener noreferrer">열기 ↗</a>
      </div>
    </OwnerShell>
  );
}

type Upcoming = Awaited<ReturnType<typeof upcoming>>[number];
type Sync = Awaited<ReturnType<typeof lastSyncs>>[number];

const when = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function guestText(r: Upcoming) {
  if (r.profiles === 0 && !r.guest_region) return "입력하기";
  return [r.guest_region ? REGION_LABELS[r.guest_region] : "", r.profiles > 0 ? `${r.profiles}명 입력됨` : ""].filter(Boolean).join(" · ");
}

function SyncResult({ s }: { s: Sync | undefined }) {
  if (!s) return <span className="muted">기록 없음</span>;
  if (s.ok === null) return <span className="muted">진행 중</span>;
  return s.ok ? <span className="ok">성공</span> : <span className="bad">실패: {s.error}</span>;
}
