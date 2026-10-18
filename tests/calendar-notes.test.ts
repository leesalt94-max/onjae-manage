import { describe, expect, it } from "vitest";
import { guestsFromNote, parseNoteGuests } from "../lib/calendar-notes";

describe("청소매니저 메모에서 인원·성별 읽기", () => {
  const cases: [string, Partial<ReturnType<typeof parseNoteGuests>> | null][] = [
    ["7명", { total: 7, male: 0, female: 0 }],
    ["저녁 8시 퇴실 - late check out", null],
    ["어른2. 아이(1.5.8.11.14)5 명이 옵니다", { adults: 2, children: 5, childAges: [1, 5, 8, 11, 14] }],
    ["7명여성", { total: 7, female: 7, male: 0 }],
    ["3명 여성", { female: 3 }],
    ["여성4명 2박", { female: 4, total: 4 }],
    ["새벽에 이른 체크인. 남2명 여2명 3박", { male: 2, female: 2 }],
    ["남자 군인5명", { male: 5, female: 0 }],
    ["성인 2명 예약 (부부같아요)", { adults: 2, male: 0, female: 0 }],
    ["체크 아웃 청소 오늘 체크인은 허수이므로 오늘 청소하면 15일은 안해도 됨", null],
    ["4명 한국여성 1박", { female: 4 }],
    ["13박 3명 11/6일 체크아웃. 화장지.쓰레기봉투", { total: 3 }],
    ["이른 짐보관 서비스 원하심. 트립닷컴 성인4명 어린이1명", { adults: 4, children: 1 }],
    ["성인 4명 여성.5박 여행. 25일 체크아웃", { adults: 4, female: 4 }],
    ["4명 4박 콘서트관람.여행  16일 체크아웃", { total: 4, female: 0 }],
    // 청소매니저 입력 양식
    ["전체인원: 4명 (여: 3명 + 남: 1명)\n나라: 일본\n나이대: 20대 4명\n여벌 이불", { total: 4, female: 3, male: 1, region: "japan", ages: ["20s", "20s", "20s", "20s"] }],
    ["전체인원: 2명\n나라: 대만", { total: 2, male: 0, female: 0, region: "china", ages: [] }],
    ["나라: 프랑스\n나이대: 30대 1명, 60대 1명", { total: null, region: "europe", ages: ["30s", "60plus"] }],
    ["전체인원: 3명\n나라: 브라질\n나이대: 40대", { total: 3, region: "other", ages: ["40s", "40s", "40s"] }],
  ];
  it.each(cases)("%s", (text, want) => {
    const got = parseNoteGuests(text);
    if (want === null) expect(got).toBeNull();
    else expect(got).toMatchObject(want);
  });

  it("양식의 성별과 나이대를 짝지어 투숙객으로", () => {
    const g = guestsFromNote(parseNoteGuests("전체인원: 3명 (여: 1명 + 남: 2명)\n나이대: 20대 2명, 아이 1명")!);
    expect(g).toEqual([
      { gender: "female", ageBand: "20s" }, { gender: "male", ageBand: "20s" }, { gender: "male", ageBand: "child" },
    ]);
  });

  it("아이 나이를 알면 13살 이상은 10대로", () => {
    const g = guestsFromNote(parseNoteGuests("어른2. 아이(1.5.8.11.14)5 명")!);
    expect(g.map((x) => x.ageBand)).toEqual(["child", "child", "child", "child", "10s"]);
  });
});
