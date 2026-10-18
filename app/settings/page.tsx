import { requireOwner } from "@/lib/auth";
import { listCredentialStatus } from "@/lib/credentials";
import { db } from "@/lib/db";
import { isKakaoConnected } from "@/lib/kakao";
import { hasPcToken } from "@/lib/pc-token";
import { getOpenedOn } from "@/lib/insights";
import { getRateBasis, getRoomCount, getTripCleaningFee, getTripCommissionPct } from "@/lib/stats";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/types";
import { deleteCredentialAction, kakaoTestAction, saveCredentialAction, saveOpenedOnAction, importCalendarNotesAction, saveRateBasisAction, saveRoomCountAction, saveTripCommissionAction, toggleCredentialAction } from "../actions";
import { Flash, type SearchParams } from "../flash";
import { OwnerShell } from "../nav";
import { PcTokenForm } from "./pc-token";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const sql = db();
  const [creds, kakao, pcToken, roomCount, tripPct, tripCleaning, opened, rates] = await Promise.all([
    listCredentialStatus(sql), isKakaoConnected(sql), hasPcToken(sql), getRoomCount(sql), getTripCommissionPct(sql),
    getTripCleaningFee(sql), getOpenedOn(sql), getRateBasis(sql),
  ]);

  return (
    <OwnerShell>
      <h1>설정</h1>
      <Flash params={params} />

      <div className="panel">
        <a className="button-link" href="/upload">파일 올리기</a>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          수집 프로그램이 막힌 플랫폼(예: 부킹닷컴)은 예약 파일을 직접 내려받아 여기서 올려 주세요.
        </p>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          <a href="/otp">인증번호 입력</a> · 플랫폼에 처음 로그인할 때 1회만 필요해요. 필요할 때는 홈에 알림이 떠요.
        </p>
      </div>

      <h2>청소매니저 메모 가져오기</h2>
      <div className="panel">
        <p className="muted">
          청소매니저 달력의 날짜별 메모에서 인원(예: 성인 4명, 아이 1명)과 성별(예: 여성 4명, 남2명 여2명)만 읽어, 그날 체크인한 예약에
          채웁니다. 비어 있는 칸만 채우고, 메모 글 자체는 저장하지 않아요. 홈을 열 때와 수집 프로그램이 파일을 보낼 때 자동으로 가져오니 보통은 누르지 않아도 돼요. 바로 반영하고 싶을 때 눌러 주세요.
        </p>
        <form action={importCalendarNotesAction}>
          <button type="submit">메모에서 인원·성별 가져오기</button>
        </form>
      </div>

      <h2>객실 수</h2>
      <div className="panel">
        <p className="muted">동시에 받을 수 있는 객실(유닛) 수입니다. 통계의 가동률을 이 숫자로 나눠 계산합니다.</p>
        <form action={saveRoomCountAction} className="row">
          <input type="number" name="roomCount" min={1} max={50} defaultValue={roomCount} required style={{ width: 100 }} />
          <button type="submit">저장</button>
        </form>
      </div>

      <h2>숙소 오픈일</h2>
      <div className="panel">
        <p className="muted">가동률은 이 날부터 계산합니다. 비워 두면 첫 체크인 날짜{opened.date && !opened.fromSetting ? `(${opened.date})` : ""}를 씁니다.</p>
        <form action={saveOpenedOnAction} className="row">
          <input type="date" name="openedOn" defaultValue={opened.fromSetting ? opened.date ?? "" : ""} />
          <button type="submit">저장</button>
        </form>
      </div>

      <h2>트립닷컴 수수료율·청소비</h2>
      <div className="panel">
        <p className="muted">
          트립닷컴 선결제 예약은 파일에 입금가(정산액)만 있습니다. 수수료는 객실 요금에만 붙고 청소비는 그대로 들어오므로,
          객실 판매가 = (입금가 − 청소비) ÷ (1 − 수수료율)로 역산해 예약 목록과 통계의 결제액·수수료에 씁니다. 비워 두면 기본값
          (15%, 50,000원)을 씁니다.
        </p>
        <form action={saveTripCommissionAction} className="row">
          <input type="number" name="tripCommissionPct" min={0.1} max={99.9} step={0.1} defaultValue={tripPct} placeholder="예: 15" style={{ width: 100 }} />
          <span>%</span>
          <span style={{ marginLeft: 12 }}>예약당 청소비</span>
          <input type="number" name="tripCleaningFee" min={0} step={1000} defaultValue={tripCleaning} placeholder="예: 50000" style={{ width: 120 }} />
          <span>원</span>
          <button type="submit">저장</button>
        </form>
      </div>

      <h2>평일·주말 기준 요금</h2>
      <div className="panel">
        <p className="muted">
          통계의 평일·주말 1박 요금은 예약마다 받은 금액에서 청소비({rates.cleaning.toLocaleString("ko-KR")}원)를 빼고, 이 두 요금의 비율로 평일 밤과
          주말(금·토) 밤에 나눠 계산합니다. 에어비앤비에 정해 둔 요금을 넣어 주세요. 비워 두면 평일 124,000원, 주말 175,000원을 씁니다.
        </p>
        <form action={saveRateBasisAction} className="row">
          <span>평일</span>
          <input type="number" name="weekday" min={1000} step={1000} defaultValue={rates.weekday} style={{ width: 120 }} />
          <span style={{ marginLeft: 12 }}>주말</span>
          <input type="number" name="weekend" min={1000} step={1000} defaultValue={rates.weekend} style={{ width: 120 }} />
          <span>원</span>
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
