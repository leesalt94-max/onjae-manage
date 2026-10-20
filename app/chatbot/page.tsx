import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildGemInstructions, filledCount, getGuideData, GUIDE_FIELDS, GUIDE_SECTIONS, MAX_EXTRA } from "@/lib/guide-bot";
import { saveGuideBotAction } from "../actions";
import { Flash, type SearchParams } from "../flash";
import { OwnerShell } from "../nav";
import { CopyBox } from "./copy-box";

export const dynamic = "force-dynamic";

const GUEST_MESSAGE = `숙소 이용 중 궁금한 점은 아래 AI 안내 도우미에게 편한 언어로 물어보세요. 24시간 바로 답해 드려요.
Have a question during your stay? Ask our AI guide in any language, 24/7.
(여기에 내 Gem 링크)`;

export default async function ChatbotPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const data = await getGuideData(db());
  const filled = filledCount(data);
  // 빈 칸 3개는 항상 남겨 둔다
  const extras = [...data.extras, ...Array.from({ length: 3 }, () => ({ q: "", a: "" }))].slice(0, MAX_EXTRA);

  return (
    <OwnerShell>
      <h1>손님 안내 챗봇</h1>
      <Flash params={params} />

      <div className="panel">
        <p style={{ marginTop: 0 }}>
          아는 칸만 채우세요. 빈 칸은 챗봇이 &quot;확인되지 않아요&quot;라고 답하고 호스트에게 물어보라고 안내해요. 손님이 어떤 언어로 물어도 그 언어로 답합니다.
        </p>
        <p className="bad" style={{ marginBottom: 0 }}>
          도어락 번호, 공동현관 번호, 와이파이 비밀번호는 어느 칸에도 적지 마세요. 링크만 있으면 누구나 챗봇에 물어볼 수 있어요.
        </p>
      </div>

      <form action={saveGuideBotAction} className="guide-form">
        {GUIDE_SECTIONS.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            <div className="panel guide-fields">
              {s.fields.map((f) => (
                <label key={f.key}>
                  <span>{f.label}</span>
                  {f.long ? (
                    <textarea name={f.key} rows={2} defaultValue={data.answers[f.key] ?? ""} placeholder={f.hint} />
                  ) : (
                    <input name={f.key} defaultValue={data.answers[f.key] ?? ""} placeholder={f.hint ?? (f.choices ? "목록에서 고르거나 직접 입력" : "")} list={f.choices ? `dl-${f.key}` : undefined} />
                  )}
                  {f.choices && (
                    <datalist id={`dl-${f.key}`}>
                      {f.choices.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  )}
                  {f.hint && f.choices && <span className="muted small">{f.hint}</span>}
                </label>
              ))}
            </div>
          </section>
        ))}

        <h2>내가 추가하는 질문</h2>
        <div className="panel guide-fields">
          <p className="muted small" style={{ margin: 0 }}>위에 없는 질문을 직접 넣어요. 예: 다리미 있나요? / 없습니다. 저장하면 빈 칸이 3개씩 새로 생겨요.</p>
          {extras.map((e, i) => (
            <div key={i} className="guide-extra">
              <input name="extraQ" defaultValue={e.q} placeholder={`질문 ${i + 1}`} />
              <textarea name="extraA" rows={2} defaultValue={e.a} placeholder="답" />
            </div>
          ))}
        </div>

        <div className="row" style={{ marginBottom: 24 }}>
          <button type="submit">저장</button>
          <span className="muted small">{GUIDE_FIELDS.length}칸 중 {filled}칸을 채웠어요.{data.answers.name ? "" : " 숙소 이름은 꼭 적어 주세요."}</span>
        </div>
      </form>

      <h2>1. 안내문 복사하기</h2>
      <div className="panel">
        <CopyBox text={buildGemInstructions(data)} />
        <p className="muted small" style={{ marginBottom: 0 }}>저장한 내용으로 만든 글이에요. 정보를 고치면 저장한 뒤 다시 복사해 Gem에 덮어 붙여 넣으세요.</p>
      </div>

      <h2>2. 제미나이에서 Gem 만들기</h2>
      <div className="panel">
        <ol style={{ marginTop: 0 }}>
          <li>아래 버튼으로 제미나이를 열고 구글 계정으로 로그인해요.</li>
          <li>새 Gem 화면의 이름 칸에 숙소 이름을 적어요.</li>
          <li>요청 사항 칸에 복사한 안내문을 붙여 넣고 저장해요.</li>
          <li>Gem 목록에서 방금 만든 Gem의 공유 버튼(안 보이면 ⋮)을 눌러 링크를 복사해요.</li>
        </ol>
        <p className="muted small">새 Gem 화면이 바로 안 열리면 제미나이 왼쪽 메뉴에서 Gem → 새 Gem을 누르세요.</p>
        <a className="button-link" href="https://gemini.google.com/gems/create" target="_blank" rel="noopener noreferrer">제미나이 열기 ↗</a>
      </div>

      <h2>3. 손님에게 보내기</h2>
      <div className="panel">
        <p className="muted small" style={{ marginTop: 0 }}>체크인 안내 메시지에 아래 글과 Gem 링크를 함께 붙여 넣으세요.</p>
        <CopyBox text={GUEST_MESSAGE} rows={4} />
      </div>
    </OwnerShell>
  );
}
