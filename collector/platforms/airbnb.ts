import {
  assertNoCaptcha, byButton, byText, CollectorError, downloadText, firstVisible, handleOtpIfAsked, OTP_INPUTS, requireLogin,
  waitForOwnerLogin, type CollectorContext, type PlatformAdapter,
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
  const { page } = ctx;
  await page.goto(RESERVATIONS_URL, { waitUntil: "domcontentloaded" });
  // 로그인 페이지로 이동하거나, 같은 주소에 로그인 창이 뜨는 경우 모두 처리한다.
  const loginUi = async () => /\/login|\/signup_login/.test(page.url())
    || !!(await firstVisible(page, [...EMAIL_INPUTS(page), ...byButton(page, /continue with email|이메일로 계속/i)], 3_000));
  if (!(await loginUi())) return;
  if (!ctx.login) {
    // 로그인·인증 단계의 입력란이 하나도 안 보이면 끝난 것으로 본다.
    const stillLoggingIn = [...EMAIL_INPUTS(page), page.locator('input[type="password"]'), ...OTP_INPUTS(page)];
    await waitForOwnerLogin(ctx, "에어비앤비", async () =>
      !/\/login|\/signup|authenticat|verif/.test(page.url()) && !(await firstVisible(page, stillLoggingIn, 500)));
    return;
  }
  const login = requireLogin(ctx);

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

// 2026-10 기준: 예약 목록 화면(/hosting/reservations)은 "투데이"로 바뀌어 내보내기가 없다.
// 대신 호스팅 수입의 "수령 완료 금액"·"수령 예정 금액" 화면 아래에 "CSV 내보내기" 버튼이 있다.
// locale=en 으로 열어 CSV 머리글을 파서가 아는 영어로 받는다.
const EARNINGS_TABS: { name: string; tab: RegExp }[] = [
  { name: "수령 완료 금액", tab: /^(paid|paid out|completed( payouts)?|수령 완료 금액)$/i },
  { name: "수령 예정 금액", tab: /^(upcoming( payouts)?|수령 예정 금액)$/i },
];

async function exportEarnings(ctx: CollectorContext, tab: RegExp, name: string): Promise<string> {
  const { page } = ctx;
  const link = await firstVisible(page, byText(page, tab), 15_000);
  if (!link) throw new CollectorError(`에어비앤비 호스팅 수입의 '${name}' 메뉴를 찾지 못했습니다.`);
  await link.click();
  await page.waitForLoadState("domcontentloaded");
  await ctx.snap?.(`earnings-${name}`);
  const exportButton = await firstVisible(page, byButton(page, /^(export|download) (to )?csv|^csv (내보내기|다운로드)/i), 15_000);
  if (!exportButton) throw new CollectorError(`에어비앤비 '${name}' 화면에서 CSV 내보내기 버튼을 찾지 못했습니다.`);
  return downloadText(page, async () => {
    await exportButton.click();
    // 2026-10 기준 "Export transactions" 창: "Download CSV"(이메일 보내기 말고)를 고르고 아래 "Export CSV" 를 누른다.
    const dialog = page.locator('[role="dialog"]:visible').last();
    const option = await firstVisible(page, [
      dialog.getByText(/^(download csv|csv 다운로드)$/i),
      dialog.getByRole("radio", { name: /download|다운로드/i }),
    ], 5_000);
    if (option) await option.click();
    const confirm = await firstVisible(page, [
      dialog.getByRole("button", { name: /^(export csv|csv 내보내기|내보내기|export)$/i }),
    ], 3_000);
    if (confirm) await confirm.click();
  });
}

export const airbnb: PlatformAdapter = {
  channel: "airbnb",
  async collect(ctx) {
    await ensureLoggedIn(ctx);
    await ctx.page.goto(`${TRANSACTIONS_URL}?locale=en`, { waitUntil: "domcontentloaded" });
    const files: string[] = [];
    const errors: string[] = [];
    for (const { name, tab } of EARNINGS_TABS) {
      try {
        files.push(await exportEarnings(ctx, tab, name));
      } catch (err) {
        ctx.log(`${name} 내보내기 실패: ${(err as Error).message}`);
        errors.push((err as Error).message);
      }
    }
    if (files.length === 0) throw new CollectorError(errors[0] ?? "에어비앤비 CSV 를 받지 못했습니다.");
    return files;
  },
};
