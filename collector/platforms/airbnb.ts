import {
  assertNoCaptcha, byButton, CollectorError, downloadText, firstVisible, handleOtpIfAsked,
  type CollectorContext, type PlatformAdapter,
} from "../helpers";

// 화면 문구·주소는 실제 계정으로 첫 실행 때 확인이 필요하다 (README "첫 실행 점검" 참고).
// 2026-10 기준 로그인 창은 "Phone number or email" 칸 하나에 이메일을 넣고 Continue 를 누른다.
const EMAIL_INPUTS = (page: CollectorContext["page"]) => [
  page.getByRole("textbox", { name: /phone number or email|email|이메일/i }),
  page.locator('input[name="user[email]"]'),
  page.locator('input[type="email"]'),
  page.locator('input[name*="email" i], input[autocomplete="username"], input[autocomplete="email"]'),
];

const RESERVATIONS_URL = "https://www.airbnb.com/hosting/reservations/all";
const TRANSACTIONS_URL = "https://www.airbnb.com/users/transaction_history";

async function ensureLoggedIn(ctx: CollectorContext): Promise<void> {
  const { page, login } = ctx;
  await page.goto(RESERVATIONS_URL, { waitUntil: "domcontentloaded" });
  // 로그인 페이지로 이동하거나, 같은 주소에 로그인 창이 뜨는 경우 모두 처리한다.
  const loginUi = /\/login|\/signup_login/.test(page.url())
    || (await firstVisible(page, [...EMAIL_INPUTS(page), ...byButton(page, /continue with email|이메일로 계속/i)], 3_000));
  if (!loginUi) return;

  ctx.log("로그인 시작");
  await assertNoCaptcha(page);
  const emailOption = await firstVisible(page, byButton(page, /continue with email|이메일로 계속/i), 5_000);
  if (emailOption) await emailOption.click();

  const email = await firstVisible(page, EMAIL_INPUTS(page));
  if (!email) throw new CollectorError("에어비앤비 로그인 화면이 바뀌어 이메일 입력란을 찾지 못했습니다.");
  await email.fill(login.username);
  await ctx.snap?.("email");
  await (await firstVisible(page, byButton(page, /^continue$|^계속$/i)))?.click();

  await page.waitForTimeout(1_500);
  await assertNoCaptcha(page);
  const password = await firstVisible(page, [page.locator('input[name="user[password]"]'), page.locator('input[type="password"]')]);
  if (!password) {
    await assertNoCaptcha(page);
    throw new CollectorError("에어비앤비 비밀번호 입력란을 찾지 못했습니다.");
  }
  await password.fill(login.password);
  // "Log in" 을 먼저 찾고, 없을 때만 "Continue" (이메일 단계의 Continue 가 아직 보일 수 있다).
  await (await firstVisible(page, [...byButton(page, /^log in$|^로그인$/i), ...byButton(page, /^continue$|^계속$/i)]))?.click();
  await page.waitForLoadState("domcontentloaded");
  await ctx.snap?.("after-password");
  await assertNoCaptcha(page);

  // 새 기기 확인: 문자 받기 방식을 고르는 화면이 먼저 나올 수 있다.
  const sms = await firstVisible(page, byButton(page, /text message|sms|문자/i), 4_000);
  if (sms) {
    await sms.click();
    await (await firstVisible(page, byButton(page, /^continue$|send|^계속$|보내기/i), 3_000))?.click();
  }
  await handleOtpIfAsked(ctx, /submit|continue|verify|확인|계속/i);

  await page.goto(RESERVATIONS_URL, { waitUntil: "domcontentloaded" });
  if (/\/login/.test(page.url())) throw new CollectorError("에어비앤비 로그인에 실패했습니다. 비밀번호를 확인해 주세요.", true);
}

async function exportCsv(ctx: CollectorContext, url: string, menu: RegExp, item: RegExp): Promise<string> {
  const { page } = ctx;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await ctx.snap?.(url.includes("transaction") ? "transactions" : "reservations");
  const exportButton = await firstVisible(page, byButton(page, menu), 15_000);
  if (!exportButton) throw new CollectorError(`내보내기 버튼을 찾지 못했습니다 (${url}).`);
  return downloadText(page, async () => {
    await exportButton.click();
    const download = await firstVisible(page, byButton(page, item), 5_000);
    if (download) await download.click();
  });
}

export const airbnb: PlatformAdapter = {
  channel: "airbnb",
  async collect(ctx) {
    await ensureLoggedIn(ctx);
    const files = [await exportCsv(ctx, RESERVATIONS_URL, /^export$|내보내기/i, /download csv|csv/i)];
    try {
      // 수수료·정산액은 거래 내역에 있다. 실패해도 예약 목록은 살린다.
      files.push(await exportCsv(ctx, TRANSACTIONS_URL, /export csv|csv|내보내기/i, /download|csv|다운로드/i));
    } catch (err) {
      ctx.log(`거래 내역 내보내기 실패: ${(err as Error).message}`);
    }
    return files;
  },
};
