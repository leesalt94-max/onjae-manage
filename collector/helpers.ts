import { readFile } from "node:fs/promises";
import type { Locator, Page } from "playwright";
import type { PlatformLogin } from "../lib/credentials";
import type { Channel } from "../lib/types";

export interface CollectorContext {
  page: Page;
  login: PlatformLogin;
  /** 2단계 인증 코드를 사장님께 요청하고 입력을 기다린다. 시간이 지나면 null. */
  requestOtp: (prompt: string) => Promise<string | null>;
  log: (msg: string) => void;
  /** 디버그 실행일 때 지금 화면을 저장한다. 실패 원인을 단계별로 보기 위함. */
  snap?: (step: string) => Promise<void>;
}

export interface PlatformAdapter {
  channel: Channel;
  /** 로그인 상태를 만들고 공식 내보내기 CSV 들을 받아 텍스트로 돌려준다. */
  collect: (ctx: CollectorContext) => Promise<string[]>;
}

/** 사람이 바로 이해할 수 있는 실패. 카톡 알림에 그대로 쓴다. */
export class CollectorError extends Error {
  constructor(message: string, readonly needsOwner = false) {
    super(message);
  }
}

/** 후보 중 먼저 보이는 요소. 플랫폼이 화면을 조금 바꿔도 버티도록 여러 후보를 둔다. */
export async function firstVisible(page: Page, candidates: Locator[], timeoutMs = 8_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const c of candidates) {
      const loc = c.first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

export function byButton(page: Page, names: RegExp): Locator[] {
  return [page.getByRole("button", { name: names }), page.getByRole("link", { name: names }), page.getByRole("menuitem", { name: names })];
}

/** 버튼·링크가 아닌 div 로 만든 메뉴도 있어서, 글자가 정확히 같은 요소까지 후보로 둔다. */
export function byText(page: Page, names: RegExp): Locator[] {
  return [...byButton(page, names), page.getByText(names)];
}

/** 로그인 직후 뜨는 안내 창(새 기능 소개 등)을 닫는다. 없으면 아무것도 하지 않는다. */
export async function dismissPopups(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  const close = await firstVisible(page, [
    page.getByRole("button", { name: /^(close|닫기|关闭|×)$/i }),
    page.locator('[aria-label*="close" i]'),
    page.locator('[class*="modal" i] [class*="close" i], [class*="dialog" i] [class*="close" i], [class*="popup" i] [class*="close" i]'),
  ], 2_000);
  if (close) await close.click().catch(() => {});
}

export const OTP_INPUTS = (page: Page): Locator[] => [
  page.locator('input[autocomplete="one-time-code"]'),
  page.locator('input[name*="code" i]'),
  page.locator('input[inputmode="numeric"]'),
];

/** 캡차는 풀지 않는다(약관·보안상). 보이면 바로 멈추고 사장님께 알린다. */
export async function assertNoCaptcha(page: Page): Promise<void> {
  const captcha = page.locator(
    'iframe[src*="captcha" i], iframe[src*="arkose" i], iframe[src*="recaptcha" i], iframe[title*="challenge" i], #px-captcha',
  );
  if (await captcha.first().isVisible().catch(() => false)) {
    throw new CollectorError("로그인 중 로봇 확인(캡차)이 나와 멈췄습니다. 이번 달은 CSV 업로드로 대신해 주세요.", true);
  }
}

/** 코드 입력란이 보이면 사장님께 코드를 받아 넣는다. 입력란이 없으면 false. */
export async function handleOtpIfAsked(ctx: CollectorContext, submit: RegExp): Promise<boolean> {
  const input = await firstVisible(ctx.page, OTP_INPUTS(ctx.page), 4_000);
  if (!input) return false;
  ctx.log("2단계 인증 코드 요청");
  const code = await ctx.requestOtp("문자나 앱으로 받은 인증번호를 입력해 주세요.");
  if (!code) throw new CollectorError("인증번호 입력 시간이 지나 로그인하지 못했습니다. 다음 수집 때 다시 요청할게요.", true);
  await input.fill(code);
  const button = await firstVisible(ctx.page, byButton(ctx.page, submit), 3_000);
  if (button) await button.click();
  else await input.press("Enter");
  await ctx.page.waitForLoadState("domcontentloaded");
  return true;
}

/** 버튼을 눌러 내려받은 파일의 내용을 텍스트로. */
export async function downloadText(page: Page, trigger: () => Promise<void>, timeoutMs = 60_000): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: timeoutMs }), trigger()]);
  const filePath = await download.path();
  if (!filePath) throw new CollectorError("내보내기 파일을 받지 못했습니다.");
  const buf = await readFile(filePath);
  if (buf[0] === 0xd0 && buf[1] === 0xcf) {
    throw new CollectorError("엑셀(xls) 형식으로 내려받아졌습니다. CSV 형식 선택이 필요합니다.");
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    throw new CollectorError("엑셀(xlsx) 형식으로 내려받아졌습니다. CSV 형식 선택이 필요합니다.");
  }
  return buf.toString("utf8");
}
