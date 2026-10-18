import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentMonth, money, monthRange } from "@/lib/format";
import { pendingOtps } from "@/lib/otp";
import { lastSyncs, monthlyByChannel, upcoming } from "@/lib/stats";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/types";
import { OwnerShell } from "./nav";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireOwner();
  const sql = db();
  const month = currentMonth();
  const [monthly, next, syncs, otps] = await Promise.all([
    monthlyByChannel(sql, 1),
    upcoming(sql, 7),
    lastSyncs(sql),
    pendingOtps(sql),
  ]);
  const thisMonth = monthly.filter((r) => r.month === month);
  const currencies = [...new Set(thisMonth.map((r) => r.currency))];
  const { from } = monthRange(month);

  return (
    <OwnerShell>
      {otps.length > 0 && (
        <div className="notice warn">
          인증번호를 기다리는 로그인이 있어요. <a href="/otp">지금 입력하기</a>
        </div>
      )}
      <h1>{month} 요약</h1>
      {currencies.length === 0 && <p className="muted">{from} 이후 체크인 예약이 아직 없습니다.</p>}
      {currencies.map((cur) => {
        const rows = thisMonth.filter((r) => r.currency === cur);
        const sum = (k: "payout" | "commission" | "guestPaid") => rows.reduce((a, r) => a + r[k], 0);
        return (
          <div className="grid" key={cur}>
            <div className="panel kpi"><div className="label">정산 예정액</div><div className="value">{money(sum("payout"), cur)}</div></div>
            <div className="panel kpi"><div className="label">게스트 결제액</div><div className="value">{money(sum("guestPaid"), cur)}</div></div>
            <div className="panel kpi"><div className="label">플랫폼 수수료</div><div className="value">{money(sum("commission"), cur)}</div></div>
            <div className="panel kpi"><div className="label">예약 / 숙박일</div><div className="value">{rows.reduce((a, r) => a + r.bookings, 0)}건 / {rows.reduce((a, r) => a + r.nights, 0)}박</div></div>
          </div>
        );
      })}

      <h2>7일 안의 체크인</h2>
      <div className="panel table-wrap">
        {next.length === 0 ? <p className="muted">없음</p> : (
          <table>
            <thead><tr><th>체크인</th><th>체크아웃</th><th>채널</th><th>예약번호</th><th className="num">인원</th><th>성별·나이</th></tr></thead>
            <tbody>
              {next.map((r) => (
                <tr key={r.id}>
                  <td>{r.check_in}</td><td>{r.check_out}</td>
                  <td><span className={`badge ${r.channel}`}>{CHANNEL_LABELS[r.channel]}</span></td>
                  <td>{r.confirmation}</td>
                  <td className="num">{(r.adults ?? 0) + (r.children ?? 0) || "-"}</td>
                  <td><a href={`/reservations/${r.id}`}>{r.profiles > 0 ? `${r.profiles}명 입력됨` : "입력하기"}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>자동 수집 상태</h2>
      <div className="panel table-wrap">
        <table>
          <thead><tr><th>채널</th><th>마지막 실행</th><th>결과</th><th>마지막 성공</th></tr></thead>
          <tbody>
            {CHANNELS.map((ch) => {
              const s = syncs.find((x) => x.channel === ch);
              return (
                <tr key={ch}>
                  <td>{CHANNEL_LABELS[ch]}</td>
                  <td>{s ? s.started_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}</td>
                  <td>{!s ? <span className="muted">기록 없음</span> : s.ok === null ? <span className="muted">진행 중</span> : s.ok ? <span className="ok">성공</span> : <span className="bad">실패: {s.error}</span>}</td>
                  <td>{s?.last_ok ? s.last_ok.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </OwnerShell>
  );
}
