import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { intEnv } from "@/lib/env";
import { money, pct } from "@/lib/format";
import { AGE_LABELS, GENDER_LABELS } from "@/lib/guests";
import { ageBands, genderBreakdown, guestCoverage, monthlyByChannel, occupancy, summary } from "@/lib/stats";
import { CHANNEL_LABELS } from "@/lib/types";
import { OwnerShell } from "../nav";

export const dynamic = "force-dynamic";

function Bars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (total === 0) return <p className="muted">아직 입력된 투숙객 정보가 없습니다.</p>;
  return (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td style={{ width: 90 }}>{r.label}</td>
            <td style={{ width: "60%" }}><div className="bar" style={{ width: `${(r.count / max) * 100}%` }} /></td>
            <td className="num">{r.count}명 ({pct(r.count, total)})</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function StatsPage() {
  await requireOwner();
  const sql = db();
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const yearAhead = new Date(Date.now() + 86_400_000 * 366).toISOString().slice(0, 10);
  const [monthly, occ, sum, genders, ages, coverage] = await Promise.all([
    monthlyByChannel(sql, 12),
    occupancy(sql, intEnv("ROOM_COUNT", 1), 12),
    summary(sql, yearAgo, yearAhead),
    genderBreakdown(sql, yearAgo, yearAhead),
    ageBands(sql, yearAgo, yearAhead),
    guestCoverage(sql, yearAgo, yearAhead),
  ]);

  // 채널별 실수익률 = 정산액 / 게스트 결제액
  const byChannel = new Map<string, { guestPaid: number; payout: number; commission: number; currency: string }>();
  for (const r of monthly) {
    const key = `${r.channel}|${r.currency}`;
    const cur = byChannel.get(key) ?? { guestPaid: 0, payout: 0, commission: 0, currency: r.currency };
    cur.guestPaid += r.guestPaid;
    cur.payout += r.payout;
    cur.commission += r.commission;
    byChannel.set(key, cur);
  }

  return (
    <OwnerShell>
      <h1>통계 (최근 12개월)</h1>
      <div className="grid">
        <div className="panel kpi"><div className="label">예약</div><div className="value">{sum.bookings}건</div></div>
        <div className="panel kpi"><div className="label">취소율</div><div className="value">{pct(sum.cancelled, sum.bookings + sum.cancelled)}</div></div>
        <div className="panel kpi"><div className="label">평균 인원</div><div className="value">{sum.avgPartySize ?? "-"}명</div></div>
        <div className="panel kpi"><div className="label">평균 숙박</div><div className="value">{sum.avgNights ?? "-"}박</div></div>
        <div className="panel kpi"><div className="label">평균 예약 리드타임</div><div className="value">{sum.avgLeadDays ?? "-"}일</div></div>
      </div>

      <h2>채널별 실수익률</h2>
      <div className="panel table-wrap">
        <table>
          <thead><tr><th>채널</th><th className="num">게스트 결제액</th><th className="num">수수료</th><th className="num">정산액</th><th className="num">실수익률</th></tr></thead>
          <tbody>
            {[...byChannel.entries()].map(([key, v]) => (
              <tr key={key}>
                <td>{CHANNEL_LABELS[key.split("|")[0] as keyof typeof CHANNEL_LABELS]}</td>
                <td className="num">{money(v.guestPaid, v.currency)}</td>
                <td className="num">{money(v.commission, v.currency)}</td>
                <td className="num">{money(v.payout, v.currency)}</td>
                <td className="num">{v.guestPaid > 0 ? pct(v.payout, v.guestPaid) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">에어비앤비는 거래 내역 파일이 들어와야 결제액·수수료가 채워집니다.</p>
      </div>

      <h2>월별</h2>
      <div className="panel table-wrap">
        <table>
          <thead><tr><th>월</th><th className="num">가동률</th><th className="num">예약</th><th className="num">숙박일</th><th className="num">정산액</th><th className="num">ADR(박당 정산)</th></tr></thead>
          <tbody>
            {occ.map((o) => {
              const rows = monthly.filter((r) => r.month === o.month);
              const currency = rows[0]?.currency ?? "KRW";
              const payout = rows.filter((r) => r.currency === currency).reduce((a, r) => a + r.payout, 0);
              const nights = rows.filter((r) => r.currency === currency).reduce((a, r) => a + r.nights, 0);
              return (
                <tr key={o.month}>
                  <td>{o.month}</td>
                  <td className="num">{pct(o.occupiedNights, o.availableNights)}</td>
                  <td className="num">{rows.reduce((a, r) => a + r.bookings, 0)}</td>
                  <td className="num">{rows.reduce((a, r) => a + r.nights, 0)}</td>
                  <td className="num">{money(payout, currency)}</td>
                  <td className="num">{nights > 0 ? money(payout / nights, currency) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>투숙객 성별·나이대</h2>
      <p className="muted">
        성별·나이를 입력한 예약 {coverage.entered}건 / 전체 {coverage.total}건 ({pct(coverage.entered, coverage.total)}) 기준입니다.
      </p>
      <div className="grid">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>성별</h2>
          <Bars rows={genders.map((g) => ({ label: GENDER_LABELS[g.gender] ?? g.gender, count: g.count }))} />
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>나이대</h2>
          <Bars rows={ages.map((a) => ({ label: AGE_LABELS[a.band] ?? a.band, count: a.count }))} />
        </div>
      </div>
    </OwnerShell>
  );
}
