import { expect, test } from "vitest";
import { buildGemInstructions, findSecret } from "@/lib/guide-bot";
test("gem", () => {
  const t = buildGemInstructions({ answers: { name: "온재", checkin: "16:00", trash: "봉투에\n담기" }, extras: [{ q: "다리미?", a: "없어요" }] });
  expect(t).toContain("- 체크인 시간: 16:00");
  expect(t).not.toContain("[시설]");
  expect(findSecret({ answers: { entrance: "공동현관 비밀번호 1234*" }, extras: [] })).toBeTruthy();
  expect(findSecret({ answers: { entrance: "공동현관은 1층 왼쪽", checkin: "15:00" }, extras: [] })).toBeNull();
});

import { parseChatReply, pickLang } from "@/lib/guide-page";
test("chat reply parse", () => {
  expect(parseChatReply('{"answer":"11시예요","topic":"checkin","known":true,"language":"ko"}')).toEqual({ answer: "11시예요", topic: "checkin", known: true, language: "ko", photos: [] });
  expect(parseChatReply('{"answer":"모르겠어요","topic":"weird","known":false,"language":"xx"}')).toEqual({ answer: "모르겠어요", topic: "other", known: false, language: "other", photos: [] });
  expect(parseChatReply("plain text").answer).toBe("plain text");
});
test("pick lang", () => {
  expect(pickLang(undefined, "zh-TW,zh;q=0.9")).toBe("zh-TW");
  expect(pickLang(undefined, "zh-CN,zh;q=0.9")).toBe("zh-CN");
  expect(pickLang(undefined, "ja-JP")).toBe("ja");
  expect(pickLang(undefined, "fr-FR")).toBe("en");
  expect(pickLang("ko", "ja")).toBe("ko");
});
test("chat reply photos only known ids", () => {
  expect(parseChatReply('{"answer":"a","photos":["3","999","3"]}', ["3", "4"]).photos).toEqual(["3"]);
});
