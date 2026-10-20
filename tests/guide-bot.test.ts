import { expect, test } from "vitest";
import { buildGemInstructions, findSecret } from "@/lib/guide-bot";
test("gem", () => {
  const t = buildGemInstructions({ answers: { name: "온재", checkin: "16:00", trash: "봉투에\n담기" }, extras: [{ q: "다리미?", a: "없어요" }] });
  expect(t).toContain("- 체크인 시간: 16:00");
  expect(t).not.toContain("[시설]");
  expect(findSecret({ answers: { entrance: "공동현관 비밀번호 1234*" }, extras: [] })).toBeTruthy();
  expect(findSecret({ answers: { entrance: "공동현관은 1층 왼쪽", checkin: "15:00" }, extras: [] })).toBeNull();
});
