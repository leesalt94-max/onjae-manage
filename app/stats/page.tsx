import { after } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, pct } from "@/lib/format";
import { AGE_LABELS, GENDER_LABELS, REGION_LABELS } from "@/lib/guests";
import { buildInsights, getOpenedOn, stayRows } from "@/lib/insights";
import { computeAmounts } from "@/lib/amounts";
import { autoImportCalendarNotes } from "@/lib/calendar-notes";
import { forecastSales, SALES_THRESHOLD, type YearForecast } from "@/lib/forecast";
import { ageBands, genderBreakdown, getRateBasis, getRoomCount, getTripConfig, guestCoverage, regionBreakdown, summary } from "@/lib/stats";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/types";
import type { SearchParams } from "../flash";
import { OwnerShell } from "../nav";
import { Columns, HBars, Legend, ShareBar, type SeriesDef } from "./charts";

export const dynamic = "force-dynamic";

const MONTHS_AHEAD = 3;

const SERIES: SeriesDef[] = CHANNELS.map((c) => ({ key: c, label: CHANNEL_LABELS[c], color: `var(--series-${c})` }));
const won = (n: number) => money(n, "KRW");
// 축 눈금은 짧게: 1,200,000 → 120만
const short = (n: number) => (n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString("ko-KR")}만` : `${Math.round(n)}`);
const pctOf = (n: number) => `${Math.round(n * 100)}%`;
const man = (n: number) => `${(Math.round(n / 1_000_000) * 100).toLocaleString("ko-KR")}만원`;
// 예측 막대: 기준(4,800만원)이 막대의 80% 위치에 오도록
const pctBar = (n: number) => Math.min(100, (n / (SALES_THRESHOLD * 1.25)) * 100);
const VERDICT = { over: "넘을 가능성 높음", close: "넘을 수도 있음", under: "넘지 않을 듯" } as const;

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function StatsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const sql = db();
  const params = await searchParams;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // 한국 날짜
  // 메모 가져오기는 화면을 다 보낸 뒤에 한다 (화면이 메모 서버를 기다리지 않게, 2026-10-19).
  after(() => autoImportCalendarNotes(sql));
  const [roomCount, opened] = await Promise.all([getRoomCount(sql), getOpenedOn(sql)]);

  // 기간: 기본은 오늘 기준 최근 1년. 빠른 선택(올해·오픈 이후)이나 직접 고른 날짜(끝 날짜 포함).
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const preset = typeof params.range === "string" ? params.range : "";
  let from = yearAgo;
  let toIncl = today;
  if (preset === "year") from = `${today.slice(0, 4)}-01-01`;
  else if (preset === "opened" && opened.date) from = opened.date;
  else if (isDate(params.from) && isDate(params.to) && params.from <= params.to) {
    from = params.from;
    toIncl = params.to;
  }
  const to = addDays(toIncl, 1);
  const custom = !preset && (from !== yearAgo || toIncl !== today);
  const fetchTo = to > today ? addDays(today, 31 * (MONTHS_AHEAD + 1)) : to;

  const [rows, sum, genders, ages, coverage, regions] = await Promise.all([
    stayRows(sql, from, fetchTo),
    summary(sql, from, to < today ? to : addDays(today, 1)),
    genderBreakdown(sql, from, to),
    ageBands(sql, from, to),
    guestCoverage(sql, from, to),
    regionBreakdown(sql, from, to),
  ]);
  const regionTotal = regions.reduce((a, r) => a + r.count, 0);
  // 트립닷컴처럼 수수료가 파일에 없는 예약은 예약 목록과 같은 방식으로 역산해 채널 표에 넣는다.
  const trip = await getTripConfig(sql);
  for (const r of rows) {
    if (r.commission === null) r.commission = computeAmounts({ channel: r.channel, guest_paid: null, commission: null, payout_amount: r.payout }, trip).commission;
  }
  // 연 총매출 예측: 선택한 기간과 상관없이 작년 1월~내년 말 예약 전체로 계산한다.
  const year = Number(today.slice(0, 4));
  const yearRows = await stayRows(sql, `${year - 1}-01-01`, `${year + 2}-01-01`);
  for (const r of yearRows) {
    if (r.commission === null) r.commission = computeAmounts({ channel: r.channel, guest_paid: null, commission: null, payout_amount: r.payout }, trip).commission;
  }
  const forecast = forecastSales(yearRows, today, opened.date, [year, year + 1]);
  const ins = buildInsights(rows, { today, from, to, openedOn: opened.date, roomCount, monthsAhead: MONTHS_AHEAD, rates: await getRateBasis(sql) });
  const occStart = opened.date && opened.date > from ? opened.date : from;

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
    values: { occ: m.occupancy ?? 0 },
    muted: m.future,
    title: m.occupancy === null ? `${m.month} 오픈 전` : `${m.month} 가동률 ${pctOf(m.occupancy)} (${m.occupied}박)${m.future ? " · 예약된 것만" : ""}`,
  }));
  const pastMonths = ins.months.filter((m) => !m.future);
  const pastTotal = pastMonths.reduce((a, m) => a + CHANNELS.reduce((b, c) => b + m.revenue[c], 0), 0);
  const pastNights = pastMonths.reduce((a, m) => a + m.nights, 0);
  const monthText = (m: string) => `${m.slice(2, 4)}년 ${Number(m.slice(5))}월`;
  if (forecast) {
    const say = (f: YearForecast) => `${f.year}년 ${man(f.expected)}(${man(f.low)}~${man(f.high)})`;
    const over = forecast.years.filter((f) => f.verdict !== "under");
    ins.notes.unshift({
      tag: "연 매출 예측",
      tone: over.length ? "warn" : "good",
      text: `총매출(수수료 빼기 전, 청소비 포함) 예상은 ${forecast.years.map(say).join(", ")}이에요. ${over.length ? `${over.map((f) => `${f.year}년`).join("·")}은 4,800만원을 넘을 수 있어요.` : "두 해 모두 4,800만원을 넘지 않을 것 같아요."}`,
    });
  }
  const leadTotal = ins.lead.reduce((a, b) => a + b.count, 0);
  const stayTotal = ins.stay.reduce((a, b) => a + b.count, 0);
  const partyTotal = ins.party.reduce((a, b) => a + b.count, 0);
  const share = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "-");

  return (
    <OwnerShell>
      <h1>통계</h1>
      <div className="panel">
        <div className="row">
          <a className={`chip${!preset && !custom ? " on" : ""}`} href="/stats">최근 1년</a>
          <a className={`chip${preset === "year" ? " on" : ""}`} href="/stats?range=year">올해</a>
          {opened.date && <a className={`chip${preset === "opened" ? " on" : ""}`} href="/stats?range=opened">오픈 이후</a>}
        </div>
        <form method="get" className="row" style={{ marginTop: 10 }}>
          <input type="date" name="from" defaultValue={from} aria-label="시작 날짜" />
          <span>~</span>
          <input type="date" name="to" defaultValue={toIncl} aria-label="끝 날짜" />
          <button type="submit">보기</button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {from} ~ {toIncl} 확정 예약 기준이에요. 취소된 예약은 빼요.
          {opened.date && ` 가동률은 오픈일(${opened.date}${opened.fromSetting ? "" : ", 첫 체크인 기준"}) 이후 날만 셉니다.`}
          {opened.date && !opened.fromSetting && <> <a href="/settings">오픈일 바꾸기</a></>}
        </p>
      </div>

      {ins.notes.length > 0 && (
        <div className="panel insights">
          <h2 style={{ marginTop: 0 }}>분석 내용</h2>
          <ul>
            {ins.notes.map((n) => (
              <li key={n.text} className={n.tone}>
                <span className="note-tag">{n.tag}</span>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid">
        <div className="panel kpi"><div className="label">정산액</div><div className="value">{short(ins.past.revenue)}원</div></div>
        <div className="panel kpi"><div className="label">가동률 ({occStart.slice(5).replace("-", "/")}~)</div><div className="value">{pctOf(ins.past.occupancy)}</div></div>
        <div className="panel kpi"><div className="label">박당 정산액</div><div className="value">{ins.past.adr ? won(ins.past.adr) : "-"}</div></div>
        <div className="panel kpi"><div className="label">평균 예약 시점</div><div className="value">{sum.avgLeadDays ?? "-"}일 전</div></div>
        <div className="panel kpi"><div className="label">취소율</div><div className="value">{pct(sum.cancelled, sum.bookings + sum.cancelled)}</div></div>
      </div>

      {forecast && (
        <>
          <h2>연 총매출 4,800만원 예측</h2>
          <div className="grid two">
            {forecast.years.map((f) => (
              <div key={f.year} className="panel forecast">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{f.year}년</strong>
                  <span className={`verdict ${f.verdict}`}>{VERDICT[f.verdict]}</span>
                </div>
                <div className="kpi"><div className="label">예상 총매출</div><div className="value">{won(f.expected)}</div></div>
                <div className="meter" title={`4,800만원의 ${Math.round((f.expected / SALES_THRESHOLD) * 100)}%`}>
                  <span className="meter-range" style={{ left: `${pctBar(f.low)}%`, width: `${Math.max(1, pctBar(f.high) - pctBar(f.low))}%` }} />
                  <span className="meter-fill" style={{ width: `${pctBar(f.expected)}%` }} />
                  <span className="meter-line" style={{ left: `${pctBar(SALES_THRESHOLD)}%` }} />
                </div>
                <p className="small muted" style={{ margin: "4px 0 8px" }}>세로선이 4,800만원, 옅은 띠가 예상 범위({man(f.low)}~{man(f.high)})예요.</p>
                <table className="small">
                  <tbody>
                    <tr><td>지금까지 실제 매출</td><td className="num">{won(f.actual)}</td></tr>
                    <tr><td>이미 들어온 예약</td><td className="num">{won(f.booked)}</td></tr>
                    <tr><td>4,800만원까지 남은 금액 (예약 포함)</td><td className="num">{f.actual + f.booked >= SALES_THRESHOLD ? "이미 넘음" : won(SALES_THRESHOLD - f.actual - f.booked)}</td></tr>
                    {f.neededPerMonth !== null && <tr><td>넘으려면 남은 {f.monthsLeft}개월 월 평균</td><td className="num">{won(f.neededPerMonth)}</td></tr>}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <details className="panel">
            <summary>어떻게 예측하나요?</summary>
            <p className="small">
              총매출은 손님 결제액(수수료 빼기 전, 청소비 포함)이고, 묵은 밤의 달에 나눠 넣어요. 지난 달은 실제 매출, 이번 달부터는 이미 들어온 예약과
              최근 {forecast.basisMonths.length}개월({forecast.basisMonths[0].replace("-", ".")}~{forecast.basisMonths.at(-1)!.replace("-", ".")}) 월 평균 {won(forecast.monthlyAvg)} 중 큰 값으로 채워요.
              예상 범위는 그 기간 가장 낮은 달({won(forecast.monthlyLow)})과 높은 달({won(forecast.monthlyHigh)})로 계산했어요.
              아직 1년 치 자료가 없어 계절 차이는 반영하지 못해요. 트립닷컴은 쿠폰 전 금액이라 실제보다 조금 클 수 있어요. 세금 판단은 세무사와 확인해 주세요.
            </p>
          </details>
        </>
      )}

      <h2>월별 정산액</h2>
      <div className="panel">
        <Legend series={SERIES} />
        <Columns points={revenuePoints} series={SERIES} format={short} />
        <p className="muted small">숙박한 밤 기준으로 나눠 담았어요. 흐린 막대는 앞으로의 달(지금까지 들어온 예약만)이에요.</p>
        <table className="month-table">
          <thead><tr><th>월</th>{SERIES.map((s) => <th key={s.key} className="num wide-only">{s.label}</th>)}<th className="num">정산액</th><th className="num">숙박</th><th className="num">정산액 박당</th></tr></thead>
          <tbody>
            {ins.months.map((m) => {
              const total = CHANNELS.reduce((a, c) => a + m.revenue[c], 0);
              return (
                <tr key={m.month} className={m.future ? "muted" : undefined}>
                  <td>{monthText(m.month)}{m.future ? <span className="small"> 예약분</span> : null}</td>
                  {CHANNELS.map((c) => <td key={c} className="num wide-only">{won(m.revenue[c])}</td>)}
                  <td className="num"><strong>{won(total)}</strong></td>
                  <td className="num">{m.nights}박</td>
                  <td className="num">{m.nights ? won(total / m.nights) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>합계</td>
              {CHANNELS.map((c) => <td key={c} className="num wide-only">{won(ins.months.filter((m) => !m.future).reduce((a, m) => a + m.revenue[c], 0))}</td>)}
              <td className="num"><strong>{won(pastTotal)}</strong></td>
              <td className="num">{pastNights}박</td>
              <td className="num">{pastNights ? won(pastTotal / pastNights) : "-"}</td>
            </tr>
          </tfoot>
        </table>
        <p className="muted small">합계는 앞으로의 달(예약분)을 뺀 금액이에요.</p>
      </div>

      <h2>월별 가동률</h2>
      <div className="panel">
        <Columns points={occPoints} series={[{ key: "occ", label: "가동률", color: "var(--series-1)" }]} format={pctOf} refLine={1} />
        <p className="muted small">객실 {roomCount}개 기준, 오픈 전 날은 빼고 계산해요. 같은 밤에 예약이 겹친 날은 한 번만 세요.</p>
        <table className="month-table">
          <thead><tr><th>월</th><th className="num">가동률</th><th className="num">묵은 밤</th><th className="num">빈 밤</th></tr></thead>
          <tbody>
            {ins.months.map((m) => (
              <tr key={m.month} className={m.future ? "muted" : undefined}>
                <td>{monthText(m.month)}{m.future ? <span className="small"> 예약분</span> : null}</td>
                <td className="num"><strong>{m.occupancy === null ? "-" : pctOf(m.occupancy)}</strong></td>
                <td className="num">{m.occupied} / {m.available}</td>
                <td className="num">{m.available ? Math.max(0, m.available - m.occupied) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
                  <td className="num wide-only">{c.commission ? won(c.commission) : "-"}</td>
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
            <HBars rows={ins.weekdays.map((w) => ({ label: w.label, value: w.occupancy, note: w.adr ? `정산액 박당 ${short(w.adr)}` : undefined }))} format={pctOf} />
          </div>
        </div>
        <div>
          <h2>예약이 들어온 시점</h2>
          <div className="panel">
            <HBars rows={ins.lead.map((b) => ({ label: b.label, value: b.count, note: `${share(b.count, leadTotal)}${b.nights ? ` · 정산액 박당 ${short(b.revenue / b.nights)}` : ""}` }))} format={(n) => `${n}건`} />
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
              note: `${share(r.count, regionTotal)} · 평균 ${r.count ? (r.nights / r.count).toFixed(1) : "-"}박${r.nights ? ` · 정산액 박당 ${short(r.payout / r.nights)}` : ""}`,
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

    </OwnerShell>
  );
}
