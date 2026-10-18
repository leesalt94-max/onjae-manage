import { describe, expect, it } from "vitest";
import { chromium, type BrowserContext } from "playwright";
import { airbnb } from "../collector/platforms/airbnb";
import { parseExport } from "../lib/parsers";

// 가짜 에어비앤비 화면으로 자동 로그인 → 문자 인증 → CSV 내려받기 흐름을 확인한다.
// 실제 사이트 문구가 바뀌면 이 테스트가 아니라 첫 실제 실행에서 드러난다. COLLECTOR_E2E=1 일 때만 실행.
const suite = process.env.COLLECTOR_E2E ? describe : describe.skip;

// 호스팅 수입 > 수령 완료/예정 금액 > CSV 내보내기 로 받는 거래 내역 모양.
const PAID_CSV = `Date,Type,Confirmation code,Booking date,Start date,End date,Nights,Guest,Listing,Currency,Amount,Service fee
10/16/2026,Reservation,HMTEST01,09/01/2026,10/20/2026,10/23/2026,3,Jane,Room,KRW,450000,15000`;
const UPCOMING_CSV = `Date,Type,Confirmation code,Booking date,Start date,End date,Nights,Guest,Listing,Currency,Amount,Service fee
11/07/2026,Reservation,HMTEST02,10/01/2026,11/06/2026,11/07/2026,1,Kim,Room,KRW,166676,5000`;

// 화면 안 글자를 파일로 내려받게 하는 버튼 (Playwright 가짜 응답은 다운로드를 직접 못 만들어서 브라우저 안에서 만든다).
const exportButton = (id: string) => `<button onclick="const a = document.createElement('a');
  a.href = window.URL.createObjectURL(new Blob([document.getElementById('${id}').textContent], { type: 'text/csv' }));
  a.download = '${id}.csv'; document.body.appendChild(a); a.click();">CSV 내보내기</button>`;

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;

const EARNINGS = page(`<nav><a href="#" onclick="event.preventDefault();show('upcoming')">수령 예정 금액</a>
  <a href="#" onclick="event.preventDefault();show('paid')">수령 완료 금액</a></nav>
  <section id="paid" style="display:none"><h1>대금 수령 완료</h1>${exportButton("paidcsv")}</section>
  <section id="upcoming" style="display:none"><h1>예정</h1>${exportButton("upcomingcsv")}</section>
  <script>function show(id) { for (const s of document.querySelectorAll('section')) s.style.display = s.id === id ? 'block' : 'none'; }</script>
  <script type="text/plain" id="paidcsv">${PAID_CSV}</script>
  <script type="text/plain" id="upcomingcsv">${UPCOMING_CSV}</script>`);

// 2026-10 실제 화면처럼 "Phone number or email" 칸 하나에 이메일을 넣고 Continue → 비밀번호 → Log in.
const LOGIN = page(`<h1>Log in or sign up</h1>
  <form onsubmit="event.preventDefault()">
    <input aria-label="Phone number or email" placeholder="Phone number or email" type="text" name="identifier">
    <button type="button" onclick="document.getElementById('p').style.display='block'">Continue</button>
    <div id="p" style="display:none"><input name="user[password]" type="password">
    <button type="button" onclick="location.href='/verify'">Log in</button></div>
  </form>`);

// 가짜 에어비앤비. 인증번호 123456 을 넣어야 로그인된 것으로 본다.
async function fakeAirbnb(context: BrowserContext) {
  const state = { loggedIn: false };
  await context.route("https://www.airbnb.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/hosting/reservations/all") {
      // 실제 사이트는 로그인 주소로 보내지만 Playwright 가짜 응답은 리다이렉트를 따라가지 못해 같은 주소에 로그인 창을 띄운다.
      if (!state.loggedIn) return route.fulfill({ contentType: "text/html", body: LOGIN });
      // 실제 사이트처럼 로그인 뒤에는 내보내기 없는 "투데이" 화면이 나온다.
      return route.fulfill({ contentType: "text/html", body: page("<h1>예정된 예약이 2건 있습니다</h1>") });
    }
    if (url.pathname === "/verify") {
      return route.fulfill({
        contentType: "text/html",
        body: page(`<button onclick="document.getElementById('c').style.display='block'">Text message</button>
          <div id="c" style="display:none"><input autocomplete="one-time-code">
          <button onclick="location.href='/done?code='+document.querySelector('input').value">Submit</button></div>`),
      });
    }
    if (url.pathname === "/done") {
      state.loggedIn = url.searchParams.get("code") === "123456";
      return route.fulfill({ contentType: "text/html", body: page("ok") });
    }
    if (url.pathname === "/users/transaction_history") {
      return route.fulfill({ contentType: "text/html", body: state.loggedIn ? EARNINGS : LOGIN });
    }
    return route.fulfill({ status: 404, body: "" });
  });

  return state;
}

suite("에어비앤비 자동 로그인 흐름", () => {
  it("로그인, 인증번호 요청, 예약 CSV 다운로드까지 진행한다", async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const context = await browser.newContext({ acceptDownloads: true });
    const fake = await fakeAirbnb(context);
    const prompts: string[] = [];
    const files = await airbnb.collect({
      page: await context.newPage(),
      login: { channel: "airbnb", username: "owner@example.com", password: "pw", sessionState: null },
      requestOtp: async (prompt) => {
        prompts.push(prompt);
        return "123456";
      },
      log: () => {},
    });
    await browser.close();

    expect(prompts).toHaveLength(1);
    expect(fake.loggedIn).toBe(true);
    expect(files).toHaveLength(2);
    expect(files[0]).toContain("HMTEST01");
    expect(files[1]).toContain("HMTEST02");
    const parsed = files.flatMap((f) => parseExport("airbnb", f).reservations);
    expect(parsed.map((r) => r.confirmation)).toEqual(["HMTEST01", "HMTEST02"]);
  }, 120_000);

  it("아이디·비밀번호 없이 실행하면 사장님이 창에서 직접 로그인할 때까지 기다렸다가 이어간다", async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const context = await browser.newContext({ acceptDownloads: true });
    const fake = await fakeAirbnb(context);
    const page = await context.newPage();
    const logs: string[] = [];

    // 사장님 역할: 로그인 창이 뜨면 직접 입력하고 문자 인증까지 마친다.
    const owner = (async () => {
      await page.getByRole("textbox", { name: "Phone number or email" }).fill("owner@example.com");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.locator('input[type="password"]').fill("pw");
      await page.getByRole("button", { name: "Log in" }).click();
      await page.getByRole("button", { name: "Text message" }).click();
      await page.locator('input[autocomplete="one-time-code"]').fill("123456");
      await page.getByRole("button", { name: "Submit" }).click();
    })();

    const files = await airbnb.collect({ page, requestOtp: async () => null, log: (m) => logs.push(m) });
    await owner;
    await browser.close();

    expect(fake.loggedIn).toBe(true);
    expect(logs.some((l) => l.includes("직접 로그인"))).toBe(true);
    expect(files[0]).toContain("HMTEST01");
  }, 120_000);
});
