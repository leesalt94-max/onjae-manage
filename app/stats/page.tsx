import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, pct } from "@/lib/format";
import { AGE_LABELS, GENDER_LABELS, REGION_LABELS } from "@/lib/guests";
import { buildInsights, stayRows } from "@/lib/insights";
import { ageBands, genderBreakdown, getRoomCount, guestCoverage, monthlyByChannel, regionBreakdown, summary } from "@/lib/stats";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/types";
import { OwnerShell } from "../nav";
import { Columns, HBars, Legend, ShareBar, type SeriesDef } from "./charts";

export const dynamic = "force-dynamic";

const MONTHS_BACK = 12;
const MONTHS_AHEAD = 3;

const SERIES: SeriesDef[] = CHANNELS.map((c) => ({ key: c, label: CHANNEL_LABELS[c], color: `var(--series-${c})` }));
const won = (n: number) => money(n, "KRW");
// 축 눈금은 짧게: 1,200,000 → 120만
const short = (n: number) => (n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString("ko-KR")}만` : `${Math.round(n)}`);
const pctOf = (n: number) => `${Math.round(n * 100)}%`;

export default async function StatsPage() {
  await requireOwner();
  const sql = db();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // 한국 날짜
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const yearAhead = new Date(Date.now() + 86_400_000 * 366).toISOString().slice(0, 10);
  const roomCount = await getRoomCount(sql);
  const [rows, monthly, sum, genders, ages, coverage, regions] = await Promise.all([
    stayRows(sql, yearAgo, yearAhead),
    monthlyByChannel(sql, MONTHS_BACK),
    summary(sql, yearAgo, today),
    genderBreakdown(sql, yearAgo, yearAhead),
    ageBands(sql, yearAgo, yearAhead),
    guestCoverage(sql, yearAgo, yearAhead),
    regionBreakdown(sql, yearAgo, yearAhead),
  ]);
  const regionTotal = regions.reduce((a, r) => a + r.count, 0);
  const ins = buildInsights(rows, { today, roomCount, monthsBack: MONTHS_BACK, monthsAhead: MONTHS_AHEAD });

  // 채널별 수수료: 체크인이 오늘 이전인 원화 예약만.
  const thisMonth = today.slice(0, 7);
  const commission = new Map<Channel, number>();
  for (const r of monthly) {
    if (r.currency !== "KRW" || r.month > thisMonth) continue;
    commission.set(r.channel, (commission.get(r.channel) ?? 0) + r.commission);
  }

  const monthLabel = (m: string, i: number) => (i === 0 || m.endsWith("-01") ? `${m.slice(2, 4)}.${Number(m.slice(5))}` : `${Number(m.slice(5))}`);
  const revenuePoints = ins.months.map((m, i) => ({
    key: m.month,
    label: monthLabel(m.month, i),
    minor: i % 2 === 1, // 휴대폰에서는 한 달 걸러 이름을 쓴다
    values: m.revenue,
    muted: m.future,
    title: `${m.month}${m.future ? " (예약된 것만)" : ""} · ${CHANNELS.map((c) => `${CHANNEL_LABELS[c]} ${won(m.revenue[c])}`).join(" · ")}`,
  }));
  const occPoints = ins.months.map((m, i) => ({
    key: m.month,
    label: monthLabel(m.month, i),
    minor: i % 2 === 1,
    values: { occ: m.occupancy },
    muted: m.future,
    title: `${m.month} 가동률 ${pctOf(m.occupancy)} (${m.nights}박)${m.future ? " · 예약된 것만" : ""}`,
  }));
  const leadTotal = ins.lead.reduce((a, b) => a + b.count, 0);
  const stayTotal = ins.stay.reduce((a, b) => a + b.count, 0);
  const partyTotal = ins.party.reduce((a, b) => a + b.count, 0);
  const share = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "-");

  return (
    <OwnerShell>
      <h1>통계</h1>
      <p className="muted">최근 12개월(오늘까지) 확정 예약 기준입니다. 취소된 예약은 빼고 계산해요.</p>

      {ins.notes.length > 0 && (
        <div className="panel insights">
          <strong>한눈에 보기</strong>
          <ul>{ins.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      <div className="grid">
        <div className="panel kpi"><div className="label">정산액 (12개월)</div><div className="value">{short(ins.past.revenue)}원</div></div>
        <div className="panel kpi"><div className="label">가동률</div><div className="value">{pctOf(ins.past.occupancy)}</div></div>
        <div className="panel kpi"><div className="label">박당 정산액</div><div className="value">{ins.past.adr ? won(ins.past.adr) : "-"}</div></div>
        <div className="panel kpi"><div className="label">평균 예약 시점</div><div className="value">{sum.avgLeadDays ?? "-"}일 전</div></div>
        <div className="panel kpi"><div className="label">취소율</div><div className="value">{pct(sum.cancelled, sum.bookings + sum.cancelled)}</div></div>
      </div>

      <h2>월별 정산액</h2>
      <div className="panel">
        <Legend series={SERIES} />
        <Columns points={revenuePoints} series={SERIES} format={short} />
        <p className="muted small">숙박한 밤 기준으로 나눠 담았어요. 흐린 막대는 앞으로의 달(지금까지 들어온 예약만)이에요.</p>
      </div>

      <h2>월별 가동률</h2>
      <div className="panel">
        <Columns points={occPoints} series={[{ key: "occ", label: "가동률", color: "var(--series-1)" }]} format={pctOf} refLine={1} />
        <p className="muted small">객실 {roomCount}개 기준. 100%를 넘는 달은 겹친 예약(오버부킹)이 있었다는 뜻이에요.</p>
      </div>

      <h2>채널</h2>
      <div className="panel">
        <ShareBar parts={ins.channels.map((c) => ({ key: c.channel, label: CHANNEL_LABELS[c.channel], value: c.revenue, color: `var(--series-${c.channel})` }))} />
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>채널</th><th className="num wide-only">예약</th><th className="num">숙박</th><th className="num">정산액</th><th className="num">박당 정산</th><th className="num wide-only">수수료</th></tr></thead>
            <tbody>
              {ins.channels.map((c) => (
                <tr key={c.channel}>
                  <td><span className={`badge ${c.channel}`}>{CHANNEL_LABELS[c.channel]}</span></td>
                  <td className="num wide-only">{c.bookings}건</td>
                  <td className="num">{c.nights}박</td>
                  <td className="num">{won(c.revenue)}</td>
                  <td className="num">{c.adr ? won(c.adr) : "-"}</td>
                  <td className="num wide-only">{commission.has(c.channel) ? won(commission.get(c.channel)!) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two">
        <div>
          <h2>요일별 가동률 (그날 밤)</h2>
          <div className="panel">
            <HBars rows={ins.weekdays.map((w) => ({ label: w.label, value: w.occupancy, note: w.adr ? `박당 ${short(w.adr)}` : undefined }))} format={pctOf} />
          </div>
        </div>
        <div>
          <h2>예약이 들어온 시점</h2>
          <div className="panel">
            <HBars rows={ins.lead.map((b) => ({ label: b.label, value: b.count, note: `${share(b.count, leadTotal)}${b.nights ? ` · 박당 ${short(b.revenue / b.nights)}` : ""}` }))} format={(n) => `${n}건`} />
          </div>
        </div>
        <div>
          <h2>숙박 길이</h2>
          <div className="panel">
            <HBars rows={ins.stay.map((b) => ({ label: b.label, value: b.count, note: share(b.count, stayTotal) }))} format={(n) => `${n}건`} />
          </div>
        </div>
        <div>
          <h2>인원</h2>
          <div className="panel">
            {partyTotal === 0 ? <p className="muted">인원 정보가 있는 예약이 없습니다.</p> : (
              <HBars rows={ins.party.map((b) => ({ label: b.label, value: b.count, note: share(b.count, partyTotal) }))} format={(n) => `${n}건`} />
            )}
            <p className="muted small">트립닷컴 파일에는 인원이 없어 빠져 있어요.</p>
          </div>
        </div>
      </div>

      <h2>손님 나라</h2>
      <p className="muted">나라를 고른 예약 {coverage.regionEntered}건 / 전체 {coverage.total}건 기준입니다. 예약 화면의 "입력"에서 고를 수 있어요.</p>
      <div className="panel">
        {regionTotal === 0 ? <p className="muted">아직 입력된 정보가 없습니다.</p> : (
          <HBars
            rows={regions.map((r) => ({
              label: REGION_LABELS[r.region] ?? r.region,
              value: r.count,
              note: `${share(r.count, regionTotal)} · 평균 ${r.count ? (r.nights / r.count).toFixed(1) : "-"}박${r.nights ? ` · 박당 ${short(r.payout / r.nights)}` : ""}`,
            }))}
            format={(n) => `${n}건`}
          />
        )}
      </div>

      <h2>투숙객 성별·나이대</h2>
      <p className="muted">
        성별·나이를 입력한 예약 {coverage.entered}건 / 전체 {coverage.total}건 ({pct(coverage.entered, coverage.total)}) 기준입니다.
      </p>
      <div className="grid two">
        <div className="panel">
          <strong>성별</strong>
          {genders.length === 0 ? <p className="muted">아직 입력된 정보가 없습니다.</p> : (
            <HBars rows={genders.map((g) => ({ label: GENDER_LABELS[g.gender] ?? g.gender, value: g.count }))} format={(n) => `${n}명`} />
          )}
        </div>
        <div className="panel">
          <strong>나이대</strong>
          {ages.length === 0 ? <p className="muted">아직 입력된 정보가 없습니다.</p> : (
            <HBars rows={ages.map((a) => ({ label: AGE_LABELS[a.band] ?? a.band, value: a.count }))} format={(n) => `${n}명`} />
          )}
        </div>
      </div>

      <details className="panel">
        <summary>월별 숫자 표로 보기</summary>
        <div className="table-wrap">
          <table>
            <thead><tr><th>월</th><th className="num">가동률</th><th className="num">숙박</th>{SERIES.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">합계</th><th className="num">박당</th></tr></thead>
            <tbody>
              {[...ins.months].reverse().map((m) => {
                const total = CHANNELS.reduce((a, c) => a + m.revenue[c], 0);
                return (
                  <tr key={m.month} className={m.future ? "muted" : undefined}>
                    <td>{m.month}{m.future ? " (예약분)" : ""}</td>
                    <td className="num">{pctOf(m.occupancy)}</td>
                    <td className="num">{m.nights}</td>
                    {CHANNELS.map((c) => <td key={c} className="num">{won(m.revenue[c])}</td>)}
                    <td className="num">{won(total)}</td>
                    <td className="num">{m.nights ? won(total / m.nights) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </OwnerShell>
  );
}
