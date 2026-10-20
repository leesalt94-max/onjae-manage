import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { CHAT_TOPICS, LANG_NAMES, type ChatTopic, type GuideLang } from "@/lib/guide-page";
import { OwnerShell } from "../../nav";

export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");

// 챗봇 질문 통계. 주제·언어·답을 알았는지는 기간 제한 없이 남아 있어 월별로 볼 수 있다.
export default async function ChatStatsPage() {
  await requireOwner();
  const sql = db();
  const [months, topics, langs, unknown] = await Promise.all([
    sql<{ month: string; questions: number; convs: number; unknown: number }[]>`
      SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month,
             count(*)::int AS questions, count(DISTINCT conv_id)::int AS convs,
             count(*) FILTER (WHERE known = false)::int AS unknown
      FROM guide_chat GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    sql<{ topic: ChatTopic | null; n: number; unknown: number }[]>`
      SELECT topic, count(*)::int AS n, count(*) FILTER (WHERE known = false)::int AS unknown
      FROM guide_chat GROUP BY 1 ORDER BY 2 DESC`,
    sql<{ lang: GuideLang | "other" | null; n: number }[]>`
      SELECT coalesce(q_lang, lang) AS lang, count(*)::int AS n FROM guide_chat GROUP BY 1 ORDER BY 2 DESC`,
    sql<{ question: string; topic: ChatTopic | null; at: string }[]>`
      SELECT question, topic, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'MM/DD') AS at
      FROM guide_chat WHERE known = false AND question IS NOT NULL ORDER BY created_at DESC LIMIT 30`,
  ]);
  const total = topics.reduce((s, t) => s + t.n, 0);

  return (
    <OwnerShell>
      <h1>챗봇 질문 통계</h1>
      <p className="muted"><a href="/chatbot">← 손님 안내 챗봇</a> · <a href="/chatbot/log">대화 기록</a></p>
      {total === 0 ? (
        <div className="panel">아직 손님 질문이 없어요.</div>
      ) : (
        <>
          <h2>월별</h2>
          <div className="panel">
            <table>
              <thead><tr><th>월</th><th className="num">대화</th><th className="num">질문</th><th className="num">답 못 함</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}><td>{m.month}</td><td className="num">{m.convs}</td><td className="num">{m.questions}</td><td className="num">{m.unknown} ({pct(m.unknown, m.questions)})</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>주제별 (전체 {total}개)</h2>
          <div className="panel">
            <table>
              <thead><tr><th>주제</th><th className="num">질문</th><th className="num">비율</th><th className="num">답 못 함</th></tr></thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.topic ?? "none"}><td>{t.topic ? CHAT_TOPICS[t.topic] ?? t.topic : "분류 안 됨"}</td><td className="num">{t.n}</td><td className="num">{pct(t.n, total)}</td><td className="num">{t.unknown}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>손님이 쓴 언어</h2>
          <div className="panel">
            <table>
              <tbody>
                {langs.map((l) => (
                  <tr key={l.lang ?? "none"}><td>{l.lang && l.lang !== "other" ? LANG_NAMES[l.lang] : "기타"}</td><td className="num">{l.n}</td><td className="num">{pct(l.n, total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>챗봇이 답하지 못한 질문 (최근 30일)</h2>
          <div className="panel">
            <p className="muted small" style={{ marginTop: 0 }}>자주 나오는 질문은 챗봇 정보에 채우거나 &quot;내가 추가하는 질문&quot;에 넣으면 다음부터 답해요.</p>
            {unknown.length === 0 ? <p className="muted">없어요.</p> : (
              <ul>
                {unknown.map((u, i) => (
                  <li key={i}><span className="muted small">{u.at} · {u.topic ? CHAT_TOPICS[u.topic] ?? u.topic : "기타"}</span> {u.question}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </OwnerShell>
  );
}
