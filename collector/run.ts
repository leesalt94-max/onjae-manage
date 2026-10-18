import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContextOptions, type Page } from "playwright";
import { loadEnabledLogins, saveSessionState, type PlatformLogin } from "../lib/credentials";
import { db } from "../lib/db";
import { intEnv } from "../lib/env";
import { finishSyncRun, startSyncRun, upsertReservations } from "../lib/ingest";
import { sendKakao } from "../lib/kakao";
import { requestOtp } from "../lib/otp";
import { parseExport } from "../lib/parsers";
import { CHANNEL_LABELS, type NormalizedReservation } from "../lib/types";
import { CollectorError, type PlatformAdapter } from "./helpers";
import { airbnb } from "./platforms/airbnb";
import { booking } from "./platforms/booking";
import { trip } from "./platforms/trip";

// GitHub Actions 에서 3시간마다 실행. 플랫폼마다 따로 돌아서 하나가 실패해도 나머지는 계속한다.
const ADAPTERS: Record<string, PlatformAdapter> = { airbnb, booking, trip };

const DEBUG = process.env.DEBUG_SCREENSHOTS === "1";

async function screenshot(page: Page, name: string) {
  await mkdir("debug-screenshots", { recursive: true });
  await page.screenshot({ path: `debug-screenshots/${name}-${Date.now()}.png`, fullPage: true }).catch(() => {});
}

/** 성공하면 true. 실패는 기록·알림까지 마치고 false 를 돌려준다. */
async function collectOne(login: PlatformLogin): Promise<boolean> {
  const sql = db();
  const adapter = ADAPTERS[login.channel];
  const label = CHANNEL_LABELS[login.channel];
  const log = (msg: string) => console.log(`[${login.channel}] ${msg}`);
  const runId = await startSyncRun(sql, login.channel, "auto_login");

  const browser = await chromium.launch({ headless: true });
  const options: BrowserContextOptions = {
    locale: "en-US",
    timezoneId: "Asia/Seoul",
    acceptDownloads: true,
    viewport: { width: 1366, height: 900 },
    ...(login.sessionState ? { storageState: JSON.parse(login.sessionState) } : {}),
  };
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    const files = await adapter.collect({
      page,
      login,
      log,
      snap: DEBUG ? (step) => screenshot(page, `${login.channel}-${step}`) : undefined,
      requestOtp: (prompt) => requestOtp(sql, login.channel, prompt, intEnv("OTP_WAIT_MINUTES", 8)),
    });
    // 로그인 상태를 저장해 두면 다음 실행 때 인증 없이 들어간다.
    await saveSessionState(sql, login.channel, JSON.stringify(await context.storageState()));

    const rows: NormalizedReservation[] = [];
    for (const csv of files) {
      const parsed = parseExport(login.channel, csv);
      if (parsed.skipped.length) log(`건너뛴 행 ${parsed.skipped.length}개`);
      rows.push(...parsed.reservations);
    }
    if (files.length && rows.length === 0) {
      throw new CollectorError(`${label} 파일은 받았지만 읽을 수 있는 예약이 없습니다. 파일 형식이 바뀌었을 수 있어요.`);
    }
    const result = await upsertReservations(sql, rows, "auto_login");
    await finishSyncRun(sql, runId, { ok: true, ...result });
    log(`완료: 새 예약 ${result.inserted}건, 갱신 ${result.updated}건`);
    if (result.inserted > 0) await sendKakao(sql, `[${label}] 새 예약 ${result.inserted}건이 들어왔어요.`, "/reservations");
    return true;
  } catch (err) {
    const message = err instanceof CollectorError ? err.message : `${label} 수집 중 오류: ${(err as Error).message}`;
    log(`실패: ${message}`);
    if (DEBUG) await screenshot(page, `${login.channel}-failed`);
    await finishSyncRun(sql, runId, { ok: false, error: message.slice(0, 500) });
    await notifyFailure(login, message);
    return false;
  } finally {
    await browser.close();
  }
}

// 같은 이유로 계속 실패하면 3시간마다 알림이 쌓이므로, 직전 실행이 성공했거나 사유가 바뀌었을 때만 보낸다.
async function notifyFailure(login: PlatformLogin, message: string) {
  const sql = db();
  const [prev] = await sql<{ ok: boolean | null; error: string | null }[]>`
    SELECT ok, error FROM sync_runs WHERE channel = ${login.channel} AND finished_at IS NOT NULL
    ORDER BY started_at DESC OFFSET 1 LIMIT 1`;
  if (prev && prev.ok === false && prev.error === message.slice(0, 500)) return;
  await sendKakao(sql, `[${CHANNEL_LABELS[login.channel]}] 자동 수집 실패\n${message}`, "/settings");
}

async function main() {
  const sql = db();
  const only = process.argv[2];
  const { logins: all, unreadable } = await loadEnabledLogins(sql);
  for (const channel of unreadable) {
    await sendKakao(sql, `[${CHANNEL_LABELS[channel]}] 저장된 로그인 정보를 읽을 수 없어요. 암호화 키가 바뀌었다면 설정에서 다시 저장해 주세요.`, "/settings");
  }
  const logins = all.filter((l) => !only || l.channel === only);
  if (logins.length === 0) console.log("자동 수집할 플랫폼 로그인 정보가 없습니다. 사이트 설정에서 먼저 등록하세요.");
  let failed = 0;
  for (const login of logins) if (!(await collectOne(login))) failed++;
  await sql.end();
  // 전부 실패하면 GitHub 화면에 빨간 ✗ 로 보이게 한다. 일부만 실패하면 카톡 알림으로 충분하다.
  if (logins.length > 0 && failed === logins.length) {
    console.error(`모든 플랫폼(${failed}곳) 수집에 실패했습니다.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
