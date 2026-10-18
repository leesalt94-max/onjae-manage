import {
  assertNoCaptcha, byButton, byText, CollectorError, dismissPopups, downloadText, firstVisible, handleOtpIfAsked, requireLogin,
  waitForOwnerLogin,
  type CollectorContext, type PlatformAdapter,
} from "../helpers";
import type { Locator, Page } from "playwright";

// 트립닷컴 이부킹은 화면 정보가 가장 적다. 실제 계정으로 첫 실행 때 반드시 점검이 필요하다.
const EBOOKING_URL = "https://ebooking.trip.com/";

async function ensureLoggedIn(ctx: CollectorContext): Promise<void> {
  const { page } = ctx;
  await page.goto(EBOOKING_URL, { waitUntil: "domcontentloaded" });
  const password = await firstVisible(page, [page.locator('input[type="password"]')], 5_000);
  if (!password) return; // 세션이 살아 있음
  if (!ctx.login) {
    // 로그인 화면을 벗어나 비밀번호 칸이 사라지면 끝난 것으로 본다 (메뉴 이름은 언어마다 달라서 보지 않는다).
    await waitForOwnerLogin(ctx, "트립닷컴", async () =>
      !/login|signin|passport/i.test(page.url()) && !(await page.locator('input[type="password"]').first().isVisible()));
    return;
  }
  const login = requireLogin(ctx);

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
    // 2026-10 기준: 로그인 직후 'eBooking Genie' 안내 창이 뜨고, 왼쪽 메뉴 이름은 Reservations (한국어 화면은 "예약 관리").
    await dismissPopups(page);
    await ctx.snap?.("home");
    const orders = await firstVisible(page, byText(page, /^(reservations|orders|order management|订单|订单管理|예약|예약 관리|주문)$/i), 15_000);
    if (!orders) throw new CollectorError("트립닷컴 주문 메뉴를 찾지 못했습니다.");
    await orders.click();
    await page.waitForLoadState("domcontentloaded");
    await dismissPopups(page);
    await ctx.snap?.("reservations");
    // 2026-10 기준: 목록 오른쪽 위 "Download". 누르면 형식·기간을 고르는 창이 뜰 수 있어 확인 버튼도 눌러 본다.
    const exportButton = await firstVisible(page, byText(page, /^(download|export|导出|下载|내보내기|다운로드)$/i), 15_000);
    if (!exportButton) throw new CollectorError("트립닷컴 주문 내보내기 버튼을 찾지 못했습니다.");
    await exportButton.click();
    await page.waitForTimeout(2_000);
    await ctx.snap?.("after-download-click");
    const confirm = await firstVisible(page, [
      page.locator('[role="dialog"], [class*="modal" i], [class*="drawer" i]').getByRole("button", { name: /^(download|export|confirm|ok|确定|导出|下载|확인|다운로드)$/i }),
    ], 3_000);
    if (confirm) await confirm.click();
    // 2026-10 기준: 파일이 바로 받아지지 않고 새 탭에 "다운로드 목록"(/ebkorderv3/download)이 열린다.
    // 맨 위(가장 최근) 줄이 "생성됨"이 되면 그 줄의 "다운로드"를 누른다.
    const list = await waitForDownloadList(page);
    if (!list) {
      throw new CollectorError("트립닷컴 다운로드 목록 화면이 열리지 않았습니다.");
    }
    await list.bringToFront();
    const row = await waitForReadyRow(list);
    await ctx.snap?.("download-list");
    const link = row.getByText(/^(download|다운로드|下载)$/i).first();
    return [await downloadText(list, () => link.click())];
  },
};

const DOWNLOAD_LIST = /\/ebkorderv3\/download/i;

async function waitForDownloadList(page: Page): Promise<Page | null> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = page.context().pages().find((p) => DOWNLOAD_LIST.test(p.url()));
    if (found) {
      await found.waitForLoadState("domcontentloaded");
      return found;
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

async function waitForReadyRow(list: Page): Promise<Locator> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    // "다운로드" 링크가 있는 첫 줄 = 가장 최근 요청.
    const row = list.locator("tr, [role='row']")
      .filter({ has: list.getByText(/^(download|다운로드|下载)$/i) }).first();
    const text = (await row.innerText({ timeout: 10_000 }).catch(() => "")).trim();
    if (/생성됨|generated|completed|success|已生成|完成/i.test(text)) return row;
    // 아직 만드는 중이면 잠시 뒤 새로고침한다.
    await list.waitForTimeout(5_000);
    await list.reload({ waitUntil: "domcontentloaded" });
  }
  throw new CollectorError("트립닷컴 파일이 5분 안에 만들어지지 않았습니다.");
}
