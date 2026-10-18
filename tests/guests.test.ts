import { describe, expect, it } from "vitest";
import { guestsFromForm } from "../lib/guests";

describe("투숙객 입력 정리", () => {
  it("둘 다 빈 줄은 버리고, 한쪽만 고른 줄은 나머지를 모름으로 채운다", () => {
    expect(guestsFromForm(["female", "", "", "male"], ["30s", "child", "", ""])).toEqual([
      { gender: "female", ageBand: "30s" },
      { gender: "unknown", ageBand: "child" },
      { gender: "male", ageBand: "unknown" },
    ]);
  });

  it("알 수 없는 값은 모름으로 바꾼다", () => {
    expect(guestsFromForm(["x"], ["99s"])).toEqual([{ gender: "unknown", ageBand: "unknown" }]);
  });

  it("전부 비우면 빈 목록", () => {
    expect(guestsFromForm(["", ""], ["", ""])).toEqual([]);
  });
});
