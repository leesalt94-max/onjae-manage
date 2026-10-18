import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium, type BrowserContext } from "playwright";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "../lib/types";
import { CollectorError, type PlatformAdapter } from "./helpers";
import { airbnb } from "./platforms/airbnb";
import { booking } from "./platforms/booking";
import { trip } from "./platforms/trip";

// 사장님 컴퓨터에서 실행하는 수집 프로그램 (윈도우는 onjae-collector.bat 더블클릭).
// 브라우저 창을 띄우고 사장님이 직접 로그인하면, 공식 내보내기 파일을 받아 사이트로 보낸다.
// GitHub 서버에서 로그인하면 플랫폼이 로봇으로 보고 막아서(2026-10-18) 이 방식으로 바꿨다.
// 아이디·비밀번호는 다루지 않고, 로그인 상태는 이 컴퓨터의 브라우저 프로필에만 남는다.

const ADAPTERS: Record<Channel, PlatformAdapter> = { trip, airbnb, booking };
const ORDER: Channel[] = ["trip", "airbnb", "booking"];
const HOME = path.join(homedir(), ".onjae-collector");
const CONFIG_PATH = path.join(HOME, "config.json");
const DEFAULT_APP_URL = "https://onjae-manage.vercel.app";

interface Config {
  appUrl: string;
  token: string;
}

const log = (msg: string) => console.log(msg);

async function checkToken(config: Config): Promise<boolean> {
  const res = await fetch(`${config.appUrl}/api/collector/upload`, { headers: { authorization: `Bearer ${config.token}` } });
  return res.ok;
}

async function loadConfig(): Promise<Config> {
  try {
    const saved = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as Config;
    if (await checkToken(saved)) return saved;
    log("저장된 연결 코드가 더 이상 맞지 않아요. 새 코드를 넣어 주세요.");
  } catch {
    // 처음 실행
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    log("\n처음 한 번만 설정해요.");
    const appUrl = (await rl.question(`사이트 주소 (그냥 Enter: ${DEFAULT_APP_URL}) > `)).trim().replace(/\/+$/, "") || DEFAULT_APP_URL;
    for (;;) {
      log("사이트 → 설정 → '내 컴퓨터 수집 프로그램'에서 연결 코드를 만들어 복사해 오세요.");
      const token = (await rl.question("연결 코드 붙여넣기 > ")).trim();
      const config = { appUrl, token };
      if (await checkToken(config)) {
        await mkdir(HOME, { recursive: true });
        await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
        log("연결됐어요.\n");
        return config;
      }
      log("코드가 맞지 않아요. 다시 복사해 주세요.");
    }
  } finally {
    rl.close();
  }
}

// 이 컴퓨터에 깔린 크롬을 먼저 쓰고, 없으면 윈도우 기본 엣지를 쓴다. 로그인 상태는 전용 프로필에 남는다.
async function openBrowser(): Promise<BrowserContext> {
  const profile = path.join(HOME, "browser-profile");
  const options = { headless: false, acceptDownloads: true, viewport: null, locale: "ko-KR", timezoneId: "Asia/Seoul" };
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launchPersistentContext(profile, { ...options, channel });
    } catch {
      // 다음 브라우저로
    }
  }
  throw new CollectorError("크롬이나 엣지를 찾지 못했어요. 크롬을 설치한 뒤 다시 실행해 주세요.");
}

async function send(config: Config, channel: Channel, files: string[]) {
  const res = await fetch(`${config.appUrl}/api/collector/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify({ channel, files }),
  });
  const body = (await res.json().catch(() => ({}))) as { inserted?: number; updated?: number; error?: string };
  if (res.status === 401) await rm(CONFIG_PATH, { force: true });
  if (!res.ok) throw new CollectorError(body.error ?? `사이트에 보내지 못했어요 (${res.status}).`);
  return body;
}

async function main() {
  const only = process.argv[2] as Channel | undefined;
  if (only && !CHANNELS.includes(only)) throw new CollectorError(`플랫폼 이름은 ${CHANNELS.join(", ")} 중 하나예요.`);
  const config = await loadConfig();
  const context = await openBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  const results: string[] = [];
  try {
    for (const channel of only ? [only] : ORDER) {
      const label = CHANNEL_LABELS[channel];
      log(`\n[${label}] 시작`);
      try {
        const files = await ADAPTERS[channel].collect({
          page,
          log: (msg) => log(`[${label}] ${msg}`),
          requestOtp: async () => null, // 인증번호는 사장님이 창에서 직접 넣는다
        });
        const r = await send(config, channel, files);
        results.push(`${label}: 새 예약 ${r.inserted ?? 0}건, 갱신 ${r.updated ?? 0}건`);
      } catch (err) {
        const message = err instanceof CollectorError ? err.message : (err as Error).message.split("\n")[0];
        results.push(`${label}: 실패 - ${message}`);
        await mkdir(path.join(HOME, "screenshots"), { recursive: true });
        await page.screenshot({ path: path.join(HOME, "screenshots", `${channel}-${Date.now()}.png`) }).catch(() => {});
      }
    }
  } finally {
    await context.close();
  }
  log("\n===== 결과 =====");
  for (const line of results) log(line);
  if (results.some((l) => l.includes("실패"))) log(`\n실패 화면은 ${path.join(HOME, "screenshots")} 에 저장했어요.`);
}

main().catch((err) => {
  console.error(err instanceof CollectorError ? err.message : err);
  process.exitCode = 1;
});
