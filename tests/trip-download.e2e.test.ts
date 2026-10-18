import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { trip } from "../collector/platforms/trip";

const RUN = process.env.COLLECTOR_E2E === "1";

const CSV = "Order No.,Check-in,Check-out,Amount\nTRIPTEST01,2026-11-01,2026-11-03,100\n";
const html = (body: string) => `<!doctype html><meta charset="utf-8"><body>${body}</body>`;

describe.skipIf(!RUN)("트립닷컴 수집", () => {
  it("다운로드 목록 새 탭에서 파일이 다 만들어지면 맨 위 줄을 받는다", async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    let listLoads = 0;
    await context.route("https://ebooking.trip.com/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/ebkorderv3/download")) {
        listLoads++;
        // 처음엔 맨 위 줄이 아직 만드는 중, 새로고침하면 생성됨.
        const top = listLoads > 1 ? "생성됨" : "생성 중";
        return route.fulfill({ contentType: "text/html", body: html(`<table><thead><tr><th>번호</th><th>진전</th><th>행동</th></tr></thead><tbody>
          <tr><td>1</td><td>${top}</td><td><a href="#" onclick="event.preventDefault();const a=document.createElement('a');a.href=window.URL.createObjectURL(new Blob([document.getElementById('csv').textContent],{type:'text/csv'}));a.download='new.csv';document.body.appendChild(a);a.click()">다운로드</a></td></tr>
          <tr><td>2</td><td>생성됨</td><td><a href="#" onclick="event.preventDefault();const a=document.createElement('a');a.href=window.URL.createObjectURL(new Blob(['old'],{type:'text/csv'}));a.download='old.csv';document.body.appendChild(a);a.click()">다운로드</a></td></tr>
        </tbody></table><script type="text/plain" id="csv">${CSV}</script>`) });
      }
      if (url.pathname.startsWith("/orders")) {
        return route.fulfill({ contentType: "text/html", body: html(`<h1>예약 관리</h1><button onclick="window.open('/ebkorderv3/download?')">다운로드</button>`) });
      }
      return route.fulfill({ contentType: "text/html", body: html(`<nav><a href="/orders">예약 관리</a></nav><h1>온재</h1>`) });
    });
    const page = await context.newPage();
    try {
      const files = await trip.collect({ page, requestOtp: async () => null, log: () => {} });
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("TRIPTEST01");
      expect(listLoads).toBeGreaterThan(1);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
