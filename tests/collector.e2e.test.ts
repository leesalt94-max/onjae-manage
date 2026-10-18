import { describe, expect, it } from "vitest";
import { chromium, type BrowserContext } from "playwright";
import { airbnb } from "../collector/platforms/airbnb";

// 가짜 에어비앤비 화면으로 자동 로그인 → 문자 인증 → CSV 내려받기 흐름을 확인한다.
// 실제 사이트 문구가 바뀌면 이 테스트가 아니라 첫 실제 실행에서 드러난다. COLLECTOR_E2E=1 일 때만 실행.
const suite = process.env.COLLECTOR_E2E ? describe : describe.skip;

const CSV = `Confirmation code,Status,Guest name,# of adults,# of children,# of infants,Start date,End date,# of nights,Booked,Listing,Earnings
HMTEST01,Confirmed,Jane,2,0,0,10/20/2026,10/23/2026,3,09/01/2026,Room,"₩450,000"`;

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

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
      return route.fulfill({
        contentType: "text/html",
        body: page(`<button onclick="document.getElementById('m').style.display='block'">Export</button>
          <div id="m" style="display:none"><a role="menuitem" href="#" onclick="event.preventDefault();
            const a = document.createElement('a');
            a.href = window.URL.createObjectURL(new Blob([document.getElementById('csv').textContent], { type: 'text/csv' }));
            a.download = 'r.csv'; document.body.appendChild(a); a.click();">Download CSV file</a></div>
          <script type="text/plain" id="csv">${CSV}</script>`),
      });
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
      return route.fulfill({ contentType: "text/html", body: page("no export here") });
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
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("HMTEST01");
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
