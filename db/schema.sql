-- 숙소 통합관리 DB 스키마. scripts/migrate.ts 가 여러 번 실행해도 안전하도록 IF NOT EXISTS 로 작성.

CREATE TABLE IF NOT EXISTS reservations (
  id              BIGSERIAL PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('airbnb', 'booking', 'trip')),
  confirmation    TEXT NOT NULL,                 -- 플랫폼 예약번호
  status          TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed', 'cancelled', 'no_show', 'completed')),
  listing         TEXT,
  adults          INTEGER,
  children        INTEGER,
  infants         INTEGER,
  booked_at       DATE,
  check_in        DATE NOT NULL,
  check_out       DATE NOT NULL,
  nights          INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'KRW',
  gross_amount    NUMERIC(14, 2),                -- 할인 전 정가
  discount_amount NUMERIC(14, 2),
  guest_paid      NUMERIC(14, 2),                -- 게스트 실결제액
  commission      NUMERIC(14, 2),                -- 플랫폼 수수료
  taxes           NUMERIC(14, 2),
  payout_amount   NUMERIC(14, 2),                -- 호스트 정산액
  cancelled_at    DATE,
  source          TEXT NOT NULL,                 -- auto_login | csv_upload
  raw             JSONB NOT NULL,                -- 원본 행 (이름·연락처 등 개인정보 칸은 빼고 저장)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, confirmation)
);
CREATE INDEX IF NOT EXISTS reservations_check_in_idx ON reservations (check_in);
-- 사장님이 예약마다 고르는 손님 출신 지역 (나라 이름 수준의 큰 구분만, 2026-10-18 사장님 요청).
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_region TEXT; -- china = 중국·대만
-- 한국 추가 (사장님 요청 2026-10-19). 처음 만든 CHECK 를 바꿔 끼운다.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_guest_region_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_guest_region_check
  CHECK (guest_region IN ('korea', 'japan', 'china', 'asia', 'europe', 'usa', 'other'));
-- 사장님이 직접 취소로 표시한 예약. 다음 파일을 올려도 상태를 덮어쓰지 않는다.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS status_by_owner BOOLEAN NOT NULL DEFAULT false;

-- 사장님이 예약마다 입력하는 투숙객별 성별·나이. 이름 등 식별정보는 두지 않는다.
CREATE TABLE IF NOT EXISTS guest_profiles (
  id             BIGSERIAL PRIMARY KEY,
  reservation_id BIGINT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  gender         TEXT NOT NULL DEFAULT 'unknown' CHECK (gender IN ('male', 'female', 'unknown')),
  age_band       TEXT NOT NULL DEFAULT 'unknown'
                 CHECK (age_band IN ('child', '10s', '20s', '30s', '40s', '50s', '60plus', 'unknown')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_profiles_reservation_idx ON guest_profiles (reservation_id);

-- 플랫폼 로그인 정보와 브라우저 세션. 모든 값은 AES-256-GCM 으로 암호화해 저장.
CREATE TABLE IF NOT EXISTS platform_credentials (
  channel             TEXT PRIMARY KEY CHECK (channel IN ('airbnb', 'booking', 'trip')),
  username_enc        TEXT NOT NULL,
  password_enc        TEXT NOT NULL,
  session_state_enc   TEXT,                      -- Playwright storageState
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2단계 인증 코드 요청. 수집기가 pending 행을 만들고, 사장님이 사이트에서 코드를 입력.
CREATE TABLE IF NOT EXISTS otp_requests (
  id          BIGSERIAL PRIMARY KEY,
  channel     TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  code_enc    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'used', 'expired')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          BIGSERIAL PRIMARY KEY,
  channel     TEXT NOT NULL,
  source      TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN,
  inserted    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS sync_runs_channel_idx ON sync_runs (channel, started_at DESC);

-- 카카오 토큰 등 앱 설정. secret 값은 암호화해서 value 에 저장.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  ip         TEXT NOT NULL,
  ok         BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts (ip, created_at DESC);

-- 손님 안내 챗봇 질문. 주제·언어·답을 알았는지는 통계용으로 계속 남기고,
-- 질문·답 글과 ip 는 30일이 지나면 지운다 (ip 는 시간당 질문 수 제한에만 쓰고 화면에 보여 주지 않는다).
CREATE TABLE IF NOT EXISTS guide_chat (
  id         BIGSERIAL PRIMARY KEY,
  conv_id    TEXT NOT NULL,
  ip         TEXT,
  lang       TEXT NOT NULL,
  q_lang     TEXT,
  topic      TEXT,
  known      BOOLEAN,
  question   TEXT,
  answer     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guide_chat_ip_idx ON guide_chat (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS guide_chat_created_idx ON guide_chat (created_at DESC);
