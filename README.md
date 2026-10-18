# 온재 숙소 관리 (onjae-manage)

에어비앤비·부킹닷컴·트립닷컴의 예약과 정산을 한 화면에 모으는 개인용 사이트입니다.
기획안: https://claude.ai/code/artifact/75120170-1f23-465a-aacb-92551a37786a

## 구성

| 부분 | 어디서 | 하는 일 |
| --- | --- | --- |
| 대시보드 (Next.js) | Vercel 무료 요금제 | 예약 목록, 투숙객 성별·나이 입력, 통계, 파일 올리기, 인증번호 입력, 설정 |
| 내 컴퓨터 수집 프로그램 (Playwright) | 사장님 윈도우 PC, 원할 때 더블클릭 | 크롬 창에서 사장님이 직접 로그인 → 공식 내보내기 파일 다운로드 → 사이트로 전송 |
| DB | Neon Postgres 무료 | 예약·금액·게스트 성별/나이·암호화된 로그인 정보 |
| 알림 | 카카오톡 "나에게 보내기" | 새 예약, 수집 실패, 인증번호 요청 |

처음에는 GitHub Actions 에서 3시간마다 자동 로그인했지만, 에어비앤비(접속 한도)와 부킹닷컴(그림 고르기 로봇 확인)이 서버 로그인을 막아서 2026-10-18 사장님 결정으로 **사장님 컴퓨터에서 직접 로그인하는 방식**으로 바꿨습니다. 로봇 확인은 풀거나 우회하지 않습니다. GitHub 워크플로(`collect.yml`)는 시험용 수동 실행만 남아 있습니다.

## 내 컴퓨터 수집 프로그램 (윈도우)

1. https://nodejs.org/ko 에서 **LTS** 버전을 설치합니다 (처음 한 번).
2. GitHub 저장소에서 **Code → Download ZIP** 으로 받아 압축을 풉니다.
3. 사이트 **설정 → 내 컴퓨터 수집 프로그램**에서 연결 코드를 만듭니다.
4. 압축 푼 폴더의 **onjae-collector.bat** 을 더블클릭합니다. 처음에는 설치에 몇 분 걸리고, 사이트 주소와 연결 코드를 물어봅니다.
5. 크롬(없으면 엣지) 창이 열리면 트립닷컴 → 에어비앤비 순서로 **직접 로그인**합니다 (부킹닷컴은 계정 로그인이 막혀 있어 당분간 `onjae-collector.bat booking` 으로 따로 실행). 로그인이 끝나면 프로그램이 알아서 내보내기 파일을 받아 사이트로 보냅니다. 한 번 로그인하면 다음부터는 대개 묻지 않습니다.

- 로그인 상태와 설정은 `%USERPROFILE%\.onjae-collector` 에만 남습니다. 아이디·비밀번호는 프로그램이 다루지 않습니다.
- 한 곳만 하려면 명령 창에서 `onjae-collector.bat trip` 처럼 플랫폼 이름을 붙입니다.
- 실패하면 화면을 `%USERPROFILE%\.onjae-collector\screenshots` 에 저장합니다 (예약 화면이 찍힐 수 있으니 확인 후 지워 주세요).
- 코드가 바뀌면 ZIP 을 다시 받아 같은 자리에 덮어씁니다.

## 개인정보

- 게스트 정보는 **성별·인원수·나이만** 모읍니다. 이름·연락처·주소·국적 칸은 파일에서 읽을 때 버립니다 (`lib/parsers/common.ts` 의 `stripPersonal`).
- 성별·나이는 플랫폼이 주지 않아서, 사장님이 예약마다 직접 고릅니다 (성별: 남·여·모름, 나이대: 아동·10대~50대·60대 이상·모름). 홈의 체크인 목록이나 예약 목록에서 "입력"을 누르고, 모르면 비워둬도 됩니다.
- 플랫폼 아이디·비밀번호, 브라우저 세션, 카카오 토큰은 AES-256-GCM 으로 암호화해 저장합니다. 키(`ENCRYPTION_KEY`)는 DB 와 따로 Vercel·GitHub 비밀값에만 둡니다.
- 저장소는 **비공개**로 유지하세요. 수집 로그에는 건수만 남기지만, 디버그 스크린샷에는 화면이 찍힐 수 있습니다(1일 뒤 자동 삭제).

## 자동 로그인에 대해 알아둘 것

- 에어비앤비 약관은 봇·스크래퍼 사용을 금지합니다. 계정이 제한될 수 있다는 점을 알고 쓰는 기능입니다.
- 화면을 긁지 않고, 로그인 후 사람이 누르는 "내보내기" 버튼으로 공식 CSV 를 받습니다.
- 새 기기에서 로그인할 때 플랫폼이 인증번호를 보내면, 카톡으로 알림이 오고 사이트의 **인증번호** 화면에 입력하면 수집기가 이어서 로그인합니다 (기본 8분 대기). 이후에는 세션을 저장해 다시 묻지 않는 것이 목표지만, 플랫폼이 다시 물을 수 있습니다.
- 로봇 확인(캡차)이 나오면 풀지 않고 멈춘 뒤 알립니다. 그때는 **파일 올리기**로 대신합니다.

## 처음 설정하기

1. **Neon** 에서 무료 Postgres 를 만들고 접속 주소를 복사합니다 (Vercel 대시보드의 Storage 메뉴에서도 연결 가능).
2. 비밀값 만들기: Vercel 에 올린 뒤 `https://<사이트>/setup` 을 열면 브라우저 안에서 `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH` 를 만들어 줍니다 (관리자 비밀번호가 등록되면 이 화면은 닫힘). 터미널을 쓴다면 로컬에서 `npm ci` 후:
   ```bash
   npm run gen-key                      # ENCRYPTION_KEY
   npm run gen-key                      # SESSION_SECRET
   npm run hash-password -- '비밀번호'   # ADMIN_PASSWORD_HASH
   npm run gen-key -- totp              # (선택) ADMIN_TOTP_SECRET → 구글 OTP 앱에 등록
   ```
3. **카카오 디벨로퍼스**(developers.kakao.com)에서 앱을 만들고
   - 플랫폼 > Web 사이트 도메인에 Vercel 주소 추가
   - 카카오 로그인 활성화, Redirect URI 에 `https://<사이트>/api/kakao/callback` 추가
   - 동의항목에서 "카카오톡 메시지 전송(talk_message)" 사용 설정
   - REST API 키를 `KAKAO_REST_API_KEY` 로 사용
4. **Vercel** 에 이 저장소를 가져오고 환경변수 등록: `DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, (`ADMIN_TOTP_SECRET`), `APP_URL`, `KAKAO_REST_API_KEY`, (`KAKAO_CLIENT_SECRET`), `ROOM_COUNT`.
5. **GitHub** 저장소 Settings > Secrets and variables > Actions 에 `DATABASE_URL`, `ENCRYPTION_KEY`, `APP_URL`, `KAKAO_REST_API_KEY`, (`KAKAO_CLIENT_SECRET`) 등록.
6. Actions 탭에서 **자동 수집** 워크플로를 한 번 수동 실행하면 DB 표가 만들어집니다 (`npm run db:migrate`).
7. 사이트에 로그인 → 설정에서 플랫폼 로그인 정보 저장, 카카오 연결, 테스트 메시지 확인.

## 첫 실행 점검

각 플랫폼의 로그인·내보내기 화면 문구는 실제 계정 없이 확인할 수 없어서, 흔한 문구 여러 개를 후보로 두었습니다 (`collector/platforms/*.ts`). 첫 수집이 실패하면:

1. Actions > 자동 수집 > Run workflow 에서 플랫폼을 고르고 "실패 화면 저장"을 켜서 실행
2. 실행 결과의 debug-screenshots 를 보고 해당 파일의 버튼 문구·주소를 맞춤
3. 트립닷컴 내보내기 파일의 헤더도 `lib/parsers/trip.ts` 별칭에 맞는지 확인

## 개발

```bash
npm ci
cp .env.example .env.local   # 값 채우기 ($ 는 \$ 로)
npm run db:migrate
npm run dev
npm test                     # TEST_DATABASE_URL 이 있으면 DB 테스트, COLLECTOR_E2E=1 이면 가짜 사이트 로그인 테스트까지
npm run collect -- airbnb    # 수집기 로컬 실행
```
