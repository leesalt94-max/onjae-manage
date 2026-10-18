import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { airbnb } from "../collector/platforms/airbnb";

// 가짜 에어비앤비 화면으로 자동 로그인 → 문자 인증 → CSV 내려받기 흐름을 확인한다.
// 실제 사이트 문구가 바뀌면 이 테스트가 아니라 첫 실제 실행에서 드러난다. COLLECTOR_E2E=1 일 때만 실행.
const suite = process.env.COLLECTOR_E2E ? describe : describe.skip;

const CSV = `Confirmation code,Status,Guest name,# of adults,# of children,# of infants,Start date,End date,# of nights,Booked,Listing,Earnings
HMTEST01,Confirmed,Jane,2,0,0,10/20/2026,10/23/2026,3,09/01/2026,Room,"₩450,000"`;

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

const LOGIN = page(`<button id="e" onclick="document.getElementById('f').style.display='block'">Continue with email</button>
  <form id="f" style="display:none" onsubmit="event.preventDefault()">
    <input name="user[email]" type="email">
    <button type="button" onclick="document.getElementById('p').style.display='block'">Continue</button>
    <div id="p" style="display:none"><input name="user[password]" type="password">
    <button type="button" onclick="location.href='/verify'">Log in</button></div>
  </form>`);

suite("에어비앤비 자동 로그인 흐름", () => {
  it("로그인, 인증번호 요청, 예약 CSV 다운로드까지 진행한다", async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const context = await browser.newContext({ acceptDownloads: true });
    let loggedIn = false;
    await context.route("https://www.airbnb.com/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/hosting/reservations/all") {
        // 실제 사이트는 로그인 주소로 보내지만 Playwright 가짜 응답은 리다이렉트를 따라가지 못해 같은 주소에 로그인 창을 띄운다.
        if (!loggedIn) return route.fulfill({ contentType: "text/html", body: LOGIN });
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
        loggedIn = url.searchParams.get("code") === "123456";
        return route.fulfill({ contentType: "text/html", body: page("ok") });
      }
      if (url.pathname === "/users/transaction_history") {
        return route.fulfill({ contentType: "text/html", body: page("no export here") });
      }
      return route.fulfill({ status: 404, body: "" });
    });

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
    expect(loggedIn).toBe(true);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("HMTEST01");
  }, 120_000);
});
