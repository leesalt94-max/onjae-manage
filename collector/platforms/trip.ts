import {
  assertNoCaptcha, byButton, byText, CollectorError, dismissPopups, downloadText, firstVisible, handleOtpIfAsked,
  type CollectorContext, type PlatformAdapter,
} from "../helpers";

// 트립닷컴 이부킹은 화면 정보가 가장 적다. 실제 계정으로 첫 실행 때 반드시 점검이 필요하다.
const EBOOKING_URL = "https://ebooking.trip.com/";

async function ensureLoggedIn(ctx: CollectorContext): Promise<void> {
  const { page, login } = ctx;
  await page.goto(EBOOKING_URL, { waitUntil: "domcontentloaded" });
  const password = await firstVisible(page, [page.locator('input[type="password"]')], 5_000);
  if (!password) return; // 세션이 살아 있음

  ctx.log("로그인 시작");
  await assertNoCaptcha(page);
  const user = await firstVisible(page, [
    page.locator('input[name*="user" i]'),
    page.locator('input[name*="account" i]'),
    page.locator('input[type="text"]'),
  ]);
  if (!user) throw new CollectorError("트립닷컴 로그인 화면에서 아이디 입력란을 찾지 못했습니다.");
  await user.fill(login.username);
  await password.fill(login.password);
  await (await firstVisible(page, byButton(page, /log ?in|sign in|登录|로그인/i)))?.click();
  await page.waitForLoadState("domcontentloaded");
  await assertNoCaptcha(page);
  await handleOtpIfAsked(ctx, /verify|confirm|submit|确认|확인/i);
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    throw new CollectorError("트립닷컴 로그인에 실패했습니다. 비밀번호를 확인해 주세요.", true);
  }
}

export const trip: PlatformAdapter = {
  channel: "trip",
  async collect(ctx) {
    const { page } = ctx;
    await ensureLoggedIn(ctx);
    // 2026-10 기준: 로그인 직후 'eBooking Genie' 안내 창이 뜨고, 왼쪽 메뉴 이름은 Reservations.
    await dismissPopups(page);
    await ctx.snap?.("home");
    const orders = await firstVisible(page, byText(page, /^(reservations|orders|order management|订单|예약|주문)$/i), 15_000);
    if (!orders) throw new CollectorError("트립닷컴 주문 메뉴를 찾지 못했습니다.");
    await orders.click();
    await page.waitForLoadState("domcontentloaded");
    await dismissPopups(page);
    await ctx.snap?.("reservations");
    const exportButton = await firstVisible(page, byButton(page, /export|download|导出|내보내기|다운로드/i), 15_000);
    if (!exportButton) throw new CollectorError("트립닷컴 주문 내보내기 버튼을 찾지 못했습니다.");
    return [await downloadText(page, () => exportButton.click())];
  },
};
