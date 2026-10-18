import {
  assertNoCaptcha, byButton, CollectorError, downloadText, firstVisible, handleOtpIfAsked,
  type CollectorContext, type PlatformAdapter,
} from "../helpers";

// 화면 문구·주소는 실제 계정으로 첫 실행 때 확인이 필요하다 (README "첫 실행 점검" 참고).
const EXTRANET_URL = "https://admin.booking.com/";

async function ensureLoggedIn(ctx: CollectorContext): Promise<void> {
  const { page, login } = ctx;
  await page.goto(EXTRANET_URL, { waitUntil: "domcontentloaded" });
  if (!/sign-in|login/.test(page.url())) return;

  ctx.log("로그인 시작");
  await assertNoCaptcha(page);
  const user = await firstVisible(page, [
    page.locator('input[name="loginname"]'),
    page.locator('input[name="username"]'),
    page.getByRole("textbox", { name: /username|login name|아이디/i }),
    page.locator('input[autocomplete="username"], input[type="email"]'),
  ]);
  if (!user) throw new CollectorError("부킹닷컴 로그인 화면이 바뀌어 아이디 입력란을 찾지 못했습니다.");
  await user.fill(login.username);
  await ctx.snap?.("username");
  await (await firstVisible(page, byButton(page, /^next$|^다음$/i)))?.click();

  const password = await firstVisible(page, [page.locator('input[name="password"]'), page.locator('input[type="password"]')]);
  if (!password) {
    await assertNoCaptcha(page);
    throw new CollectorError("부킹닷컴 비밀번호 입력란을 찾지 못했습니다.");
  }
  await password.fill(login.password);
  await ctx.snap?.("password");
  await (await firstVisible(page, byButton(page, /^sign in$|^로그인$/i)))?.click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3_000);
  await ctx.snap?.("after-sign-in");
  await assertNoCaptcha(page);

  // 엑스트라넷은 새 기기마다 인증을 요구한다. 문자 방식을 고르고 코드를 받는다.
  const sms = await firstVisible(page, byButton(page, /text message|sms|문자/i), 4_000);
  if (sms) {
    await sms.click();
    await (await firstVisible(page, byButton(page, /send verification code|send code|인증 코드 보내기|보내기/i), 3_000))?.click();
  }
  await ctx.snap?.("verification");
  await handleOtpIfAsked(ctx, /verify|확인/i);
  await page.waitForURL(/admin\.booking\.com\/hotel/, { timeout: 30_000 }).catch(() => {
    throw new CollectorError("부킹닷컴 로그인에 실패했습니다. 비밀번호를 확인해 주세요.", true);
  });
}

export const booking: PlatformAdapter = {
  channel: "booking",
  async collect(ctx) {
    const { page } = ctx;
    await ensureLoggedIn(ctx);
    const reservations = await firstVisible(page, byButton(page, /^reservations$|^예약$/i), 15_000);
    if (!reservations) throw new CollectorError("부킹닷컴 예약 메뉴를 찾지 못했습니다.");
    await reservations.click();
    await page.waitForLoadState("domcontentloaded");
    const download = await firstVisible(page, byButton(page, /download|다운로드/i), 15_000);
    if (!download) throw new CollectorError("부킹닷컴 예약 다운로드 버튼을 찾지 못했습니다.");
    const csv = await downloadText(page, async () => {
      await download.click();
      const csvOption = await firstVisible(page, byButton(page, /csv/i), 3_000);
      if (csvOption) await csvOption.click();
    });
    return [csv];
  },
};
