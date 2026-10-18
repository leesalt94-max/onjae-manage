// 통계용 막대 그래프. 서버에서 HTML/CSS 로 그려 휴대폰에서도 글자가 작아지지 않는다.
// 색은 채널마다 고정(globals.css 의 --series-*), 글자는 항상 본문 색. 값은 막대에 올리면 title 로 보이고,
// 같은 숫자는 아래 표에도 있다.

export interface SeriesDef { key: string; label: string; color: string }

export function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}><i className="swatch" style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export interface ColumnPoint { key: string; label: string; values: Record<string, number>; muted?: boolean; title: string; minor?: boolean }

/** 세로 막대(쌓기). refLine 은 100% 같은 기준선. */
export function Columns({
  points, series, format, refLine, height = 180,
}: {
  points: ColumnPoint[]; series: SeriesDef[]; format: (n: number) => string; refLine?: number; height?: number;
}) {
  const totals = points.map((p) => series.reduce((a, s) => a + (p.values[s.key] ?? 0), 0));
  const max = niceMax(Math.max(refLine ?? 0, ...totals));
  const ticks = [max, max / 2, 0];
  return (
    <div className="cols" style={{ height }}>
      <div className="cols-axis">
        {ticks.map((t) => <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>{format(t)}</span>)}
      </div>
      <div className="cols-plot">
        {ticks.map((t) => <div key={t} className="grid-line" style={{ bottom: `${(t / max) * 100}%` }} />)}
        {refLine !== undefined && <div className="ref-line" style={{ bottom: `${(refLine / max) * 100}%` }} />}
        {points.map((p, i) => (
          <div key={p.key} className={`col${p.muted ? " muted-col" : ""}`} title={p.title}>
            <div className="col-stack" style={{ height: `${(totals[i] / max) * 100}%` }}>
              {series.map((s) => (p.values[s.key] ?? 0) > 0 && (
                // flex-grow 합이 1보다 작으면 막대를 다 채우지 못해서(가동률 0.83 등) 비율로 바꿔 넣는다.
                <div key={s.key} style={{ flex: `${p.values[s.key] / totals[i]} 1 0`, background: s.color }} />
              ))}
            </div>
            <span className={`col-label${p.minor ? " minor" : ""}`}>{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 가로 막대 한 줄씩. 값은 막대 끝에 쓴다. */
export function HBars({ rows, format, color = "var(--series-1)" }: {
  rows: { label: string; value: number; note?: string }[]; format: (n: number) => string; color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.label} className="hbar-row" title={r.note ? `${r.label}: ${format(r.value)} · ${r.note}` : undefined}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            {r.value > 0 && <span className="hbar" style={{ width: `${(r.value / max) * 100}%`, background: color }} />}
          </span>
          <span className="hbar-value">{format(r.value)}{r.note ? <small>{r.note}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}

/** 100% 가로 띠: 전체 중 각 채널 몫. */
export function ShareBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return <p className="muted">아직 데이터가 없습니다.</p>;
  return (
    <>
      <div className="share">
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.key} style={{ flex: `${p.value / total} 1 0`, background: p.color }} title={`${p.label} ${Math.round((p.value / total) * 100)}%`} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}><i className="swatch" style={{ background: p.color }} />{p.label} {Math.round((p.value / total) * 100)}%</span>
        ))}
      </div>
    </>
  );
}
