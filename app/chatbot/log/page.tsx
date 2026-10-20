import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { LANG_NAMES, type GuideLang } from "@/lib/guide-page";
import { OwnerShell } from "../../nav";

export const dynamic = "force-dynamic";

interface Row { conv_id: string; lang: GuideLang; question: string; answer: string | null; error: string | null; at: string }

// 손님이 챗봇과 나눈 대화 (최근 30일). 한 번 페이지를 연 동안의 질문을 한 묶음으로 보여 준다.
export default async function ChatLogPage() {
  await requireOwner();
  const rows = await db()<Row[]>`
    SELECT conv_id, lang, question, answer, error,
           to_char(created_at AT TIME ZONE 'Asia/Seoul', 'MM/DD HH24:MI') AS at
    FROM guide_chat
    WHERE created_at > now() - interval '30 days'
    ORDER BY created_at DESC
    LIMIT 500`;
  const convs: { id: string; lang: GuideLang; turns: Row[] }[] = [];
  for (const r of rows) {
    let c = convs.find((x) => x.id === r.conv_id);
    if (!c) convs.push((c = { id: r.conv_id, lang: r.lang, turns: [] }));
    c.turns.unshift(r);
  }

  return (
    <OwnerShell>
      <h1>챗봇 대화 기록</h1>
      <p className="muted"><a href="/chatbot">← 손님 안내 챗봇</a> · 최근 30일, 새 대화가 위에 있어요. 30일이 지나면 자동으로 지워져요.</p>
      {convs.length === 0 && <div className="panel">아직 손님 질문이 없어요.</div>}
      {convs.map((c) => (
        <section key={c.id} className="panel">
          <p className="muted small" style={{ marginTop: 0 }}>
            {c.turns[0].at} · {LANG_NAMES[c.lang] ?? c.lang} · 질문 {c.turns.length}개
          </p>
          <div className="guide-msgs">
            {c.turns.map((t, i) => (
              <div key={i} style={{ display: "contents" }}>
                <div className="me"><p>{t.question}</p></div>
                <div className={t.answer ? "bot" : "bot bad"}><p>{t.answer ?? `(답하지 못함${t.error ? `: ${t.error}` : ""})`}</p></div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </OwnerShell>
  );
}
