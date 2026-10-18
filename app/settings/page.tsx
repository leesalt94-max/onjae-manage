import { requireOwner } from "@/lib/auth";
import { listCredentialStatus } from "@/lib/credentials";
import { db } from "@/lib/db";
import { isKakaoConnected } from "@/lib/kakao";
import { hasPcToken } from "@/lib/pc-token";
import { getRoomCount } from "@/lib/stats";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/types";
import { deleteCredentialAction, kakaoTestAction, saveCredentialAction, saveRoomCountAction, toggleCredentialAction } from "../actions";
import { Flash, type SearchParams } from "../flash";
import { OwnerShell } from "../nav";
import { PcTokenForm } from "./pc-token";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const sql = db();
  const [creds, kakao, pcToken, roomCount] = await Promise.all([
    listCredentialStatus(sql), isKakaoConnected(sql), hasPcToken(sql), getRoomCount(sql),
  ]);

  return (
    <OwnerShell>
      <h1>설정</h1>
      <Flash params={params} />

      <h2>객실 수</h2>
      <div className="panel">
        <p className="muted">동시에 받을 수 있는 객실(유닛) 수입니다. 통계의 가동률을 이 숫자로 나눠 계산합니다.</p>
        <form action={saveRoomCountAction} className="row">
          <input type="number" name="roomCount" min={1} max={50} defaultValue={roomCount} required style={{ width: 100 }} />
          <button type="submit">저장</button>
        </form>
      </div>

      <h2>내 컴퓨터 수집 프로그램</h2>
      <div className="panel">
        <p className="muted">
          사장님 컴퓨터에서 크롬 창을 열어 직접 로그인하면 세 플랫폼의 예약을 가져와 이 사이트로 보냅니다. 프로그램이 이
          사이트에 파일을 보낼 때 아래 연결 코드를 씁니다.
        </p>
        <PcTokenForm hasToken={pcToken} />
      </div>

      <h2>서버 자동 로그인 (사용 안 함)</h2>
      <p className="muted">
        GitHub 서버에서 로그인하면 플랫폼이 로봇으로 보고 막아서, 지금은 내 컴퓨터 수집 프로그램을 씁니다. 여기 저장한
        아이디·비밀번호는 쓰이지 않으니 삭제해도 됩니다.
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
