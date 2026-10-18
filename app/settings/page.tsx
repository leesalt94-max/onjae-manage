import { requireOwner } from "@/lib/auth";
import { listCredentialStatus } from "@/lib/credentials";
import { db } from "@/lib/db";
import { isKakaoConnected } from "@/lib/kakao";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/types";
import { deleteCredentialAction, kakaoTestAction, saveCredentialAction, toggleCredentialAction } from "../actions";
import { Flash, type SearchParams } from "../flash";
import { OwnerShell } from "../nav";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const sql = db();
  const [creds, kakao] = await Promise.all([listCredentialStatus(sql), isKakaoConnected(sql)]);

  return (
    <OwnerShell>
      <h1>설정</h1>
      <Flash params={params} />

      <h2>플랫폼 로그인 정보</h2>
      <p className="muted">
        비밀번호는 AES-256 으로 암호화해 저장하고, 화면에 다시 보여주지 않습니다. 자동 로그인은 플랫폼 약관상 계정 제한
        위험이 있다는 점을 알고 사용합니다.
      </p>
      {CHANNELS.map((ch) => {
        const c = creds.find((x) => x.channel === ch);
        return (
          <div className="panel" key={ch}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{CHANNEL_LABELS[ch]}</strong>
              <span className="muted">
                {c ? `${c.maskedUsername} · ${c.enabled ? "자동 수집 켜짐" : "꺼짐"} · ${c.hasSession ? "로그인 유지 중" : "다음 실행 때 로그인"}` : "등록 안 됨"}
              </span>
            </div>
            <form action={saveCredentialAction} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="channel" value={ch} />
              <input name="username" placeholder="아이디(이메일)" autoComplete="off" required />
              <input name="password" type="password" placeholder="비밀번호" autoComplete="new-password" required />
              <button type="submit">{c ? "바꾸기" : "저장"}</button>
            </form>
            {c && (
              <div className="row" style={{ marginTop: 8 }}>
                <form action={toggleCredentialAction}>
                  <input type="hidden" name="channel" value={ch} />
                  <input type="hidden" name="enabled" value={c.enabled ? "false" : "true"} />
                  <button className="secondary" type="submit">{c.enabled ? "자동 수집 끄기" : "자동 수집 켜기"}</button>
                </form>
                <form action={deleteCredentialAction}>
                  <input type="hidden" name="channel" value={ch} />
                  <button className="secondary" type="submit">삭제</button>
                </form>
              </div>
            )}
          </div>
        );
      })}

      <h2>카카오톡 알림</h2>
      <div className="panel row">
        <span>{kakao ? <span className="ok">연결됨</span> : <span className="muted">연결 안 됨</span>}</span>
        <a href="/api/kakao/start">{kakao ? "다시 연결" : "카카오 계정 연결"}</a>
        {kakao && (
          <form action={kakaoTestAction}>
            <button className="secondary" type="submit">테스트 메시지</button>
          </form>
        )}
      </div>

    </OwnerShell>
  );
}
