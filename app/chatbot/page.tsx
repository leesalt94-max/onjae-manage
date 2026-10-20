import { headers } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGeminiKey } from "@/lib/gemini";
import { getGuideToken, translationStatus } from "@/lib/guide-page";
import { buildGemInstructions, filledCount, getGuideData, GUIDE_FIELDS, GUIDE_SECTIONS, MAX_EXTRA } from "@/lib/guide-bot";
import { deleteGuidePhotoAction, resetGuideTokenAction, saveGeminiKeyAction, saveGuideBotAction, translateGuideAction } from "../actions";
import { Flash, type SearchParams } from "../flash";
import { OwnerShell } from "../nav";
import { CopyBox } from "./copy-box";
import { PhotoUpload } from "./photo-upload";
import { listGuidePhotos, MAX_PHOTOS } from "@/lib/guide-photos";

export const dynamic = "force-dynamic";
// API 키를 넣거나 번역을 다시 만들 때 4개 언어 번역을 기다린다
export const maxDuration = 120;

function guestMessage(link: string) {
  return `숙소 안내와 AI 도우미예요. 궁금한 점은 편한 언어로 물어보세요. 24시간 바로 답해 드려요.
Guest guide and AI helper. Ask anything in your language, 24/7.
${link}`;
}

export default async function ChatbotPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const sql = db();
  const [data, token, key, tr, h] = await Promise.all([getGuideData(sql), getGuideToken(sql, true), getGeminiKey(sql), translationStatus(sql), headers()]);
  const photos = await listGuidePhotos(sql);
  const fieldLabel = (k: string | null) => GUIDE_FIELDS.find((f) => f.key === k)?.label;
  const [{ recent }] = await sql<{ recent: number }[]>`SELECT count(*)::int AS recent FROM guide_chat WHERE created_at > now() - interval '7 days'`;
  const link = `https://${h.get("x-forwarded-host") ?? h.get("host")}/guide/${token}`;
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

      <h2>손님에게 보낼 링크</h2>
      <div className="panel">
        <p className="muted small" style={{ marginTop: 0 }}>
          체크인 안내 메시지에 붙여 넣으세요. 손님은 로그인 없이 열고, 영어·일본어·중국어로 바꿔 볼 수 있어요.
          {key ? " 페이지 아래 채팅창에서 어떤 언어로든 물어볼 수 있어요." : " 채팅창은 아래 Gemini API 키를 넣으면 나타나요."}
        </p>
        <CopyBox text={guestMessage(link)} rows={4} />
        <div className="row" style={{ marginTop: 8 }}>
          <a className="button-link" href={link} target="_blank" rel="noopener noreferrer">손님 화면 보기 ↗</a>
          <form action={resetGuideTokenAction}>
            <button type="submit" className="secondary">링크 새로 만들기 (예전 링크는 끊김)</button>
          </form>
        </div>
      </div>

      <div className="panel">
        <a className="button-link" href="/chatbot/log">손님 대화 기록 보기</a>{" "}
        <a className="button-link" href="/chatbot/stats">질문 통계</a>
        <span className="muted small" style={{ marginLeft: 8 }}>최근 30일 · 최근 7일 질문 {recent}개</span>
      </div>

      <h2>번역과 채팅 (Gemini API 키)</h2>
      <div className="panel">
        {key ? (
          <>
            <p style={{ marginTop: 0 }}>
              API 키가 연결돼 있어요. 번역: {tr === "ok" ? "최신" : tr === "stale" ? "정보가 바뀌어 다시 만드는 중이거나 일부 실패 (손님 화면은 한국어로 보여요)" : "아직 없음"}
            </p>
            <form action={translateGuideAction}>
              <button type="submit" className="secondary">번역 다시 만들기</button>
            </form>
          </>
        ) : (
          <ol style={{ marginTop: 0 }}>
            <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">구글 AI Studio ↗</a>에 구글 계정으로 로그인해요.</li>
            <li>&quot;API 키 만들기(Create API key)&quot;를 눌러 키를 복사해요. 결제 정보를 넣지 않으면 무료 등급으로만 쓰여 요금이 나가지 않아요.</li>
            <li>아래 칸에 붙여 넣고 저장해요. 저장하면 바로 번역을 만들어요 (1분쯤 걸려요).</li>
          </ol>
        )}
        <form action={saveGeminiKeyAction} className="row" style={{ marginTop: 8 }}>
          <input type="password" name="geminiKey" placeholder={key ? "새 키로 바꿀 때만 입력" : "AI Studio 에서 복사한 키"} autoComplete="off" style={{ flex: 1, minWidth: 0 }} required />
          <button type="submit">키 저장</button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>키는 암호화해서 저장해요. 손님 질문은 IP 당 1시간 30번, 하루 전체 400번까지만 받아 무료 한도를 넘지 않게 해요.</p>
      </div>

      <details className="panel">
        <summary>제미나이 Gem 으로도 만들고 싶다면</summary>
        <p className="muted small">아래 안내문을 복사해 <a href="https://gemini.google.com/gems/create" target="_blank" rel="noopener noreferrer">제미나이 새 Gem ↗</a>의 요청 사항 칸에 붙여 넣으세요. Gem 링크는 손님이 구글에 로그인해야 열려요.</p>
        <CopyBox text={buildGemInstructions(data)} />
      </details>

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

      <h2>사진 ({photos.length}/{MAX_PHOTOS})</h2>
      <div className="panel">
        <p className="muted small" style={{ marginTop: 0 }}>
          입구, 도어락 위치, 쓰레기 분리, 보일러 조절기처럼 말보다 사진이 쉬운 것을 올려 주세요. 안내 페이지의 그 항목 아래 보이고, 챗봇이 관련 질문에 사진을 같이 보여 줘요.
          도어락 번호나 와이파이 비밀번호가 찍힌 사진은 올리지 마세요.
        </p>
        <PhotoUpload fields={GUIDE_FIELDS.filter((f) => f.key !== "name").map((f) => ({ key: f.key, label: f.label }))} />
        {photos.length > 0 && (
          <div className="photo-list" style={{ marginTop: 16 }}>
            {photos.map((p) => (
              <figure key={p.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/guide/${token}/photo/${p.id}`} alt={p.caption} />
                <figcaption className="small">{p.caption}{fieldLabel(p.field) ? <span className="muted"> · {fieldLabel(p.field)}</span> : null}</figcaption>
                <form action={deleteGuidePhotoAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="secondary" style={{ marginTop: 4, padding: "4px 10px" }}>지우기</button>
                </form>
              </figure>
            ))}
          </div>
        )}
      </div>

    </OwnerShell>
  );
}
