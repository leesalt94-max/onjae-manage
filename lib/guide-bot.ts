import type postgres from "postgres";
import { getSetting, setSetting } from "./settings";

// 손님 안내 챗봇(구글 제미나이 Gem)에 넣을 숙소 정보.
// 사장님이 /chatbot 에서 채우고, 화면이 Gem "요청 사항" 칸에 붙여 넣을 안내문을 만들어 준다.
// 링크를 가진 누구나 물어볼 수 있으므로 도어락·공동현관·와이파이 비밀번호는 받지 않는다.

export interface GuideField {
  key: string;
  label: string;
  hint?: string;
  choices?: string[];
  long?: boolean;
}

export interface GuideSection {
  title: string;
  fields: GuideField[];
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    title: "숙소 기본",
    fields: [
      { key: "name", label: "숙소 이름", hint: "손님에게 보이는 이름 그대로 (꼭 적어 주세요)" },
      { key: "location", label: "숙소 위치", hint: "예: 서울 ○○구 ○○로 00, ○○역 도보 8분" },
      { key: "floor", label: "층수와 엘리베이터", choices: ["엘리베이터 있음", "엘리베이터 없음, 2층", "엘리베이터 없음, 3층"] },
      { key: "entrance", label: "입구 찾는 법", hint: "외국인 손님이 가장 많이 헤매는 부분이에요. 예: 1층 편의점 옆 파란 문", long: true },
      { key: "rooms", label: "방과 침대", hint: "예: 침실 1개, 퀸 침대 1개" },
      { key: "maxGuests", label: "최대 인원", choices: ["2명", "3명", "4명", "6명"] },
      { key: "parking", label: "주차", choices: ["주차 불가", "1대 무료", "근처 유료 주차장 이용"] },
      { key: "contact", label: "호스트 연락 방법", choices: ["예약한 사이트(에어비앤비, 부킹닷컴, 트립닷컴)의 메시지"] },
    ],
  },
  {
    title: "체크인과 체크아웃",
    fields: [
      { key: "checkin", label: "체크인 시간", choices: ["15:00", "16:00", "17:00"] },
      { key: "checkout", label: "체크아웃 시간", choices: ["10:00", "11:00", "12:00"] },
      { key: "earlyCheckin", label: "얼리 체크인", choices: ["불가", "전날 예약이 없을 때만 가능, 호스트에게 문의", "추가 요금을 내면 가능, 호스트에게 문의"] },
      { key: "lateCheckout", label: "레이트 체크아웃", choices: ["불가", "다음 예약이 없을 때만 가능, 호스트에게 문의", "추가 요금을 내면 가능, 호스트에게 문의"] },
      { key: "luggage", label: "짐 보관", choices: ["보관 불가, 가까운 역 물품보관함 이용", "체크인 전에만 현관에 보관 가능, 호스트에게 문의", "체크인 전과 체크아웃 후 모두 가능, 호스트에게 문의"] },
    ],
  },
  {
    title: "숙소 규칙",
    fields: [
      { key: "smoking", label: "담배", choices: ["건물 전체 금연 (전자담배 포함)", "실내 금연, 건물 밖에서만"] },
      { key: "quietHours", label: "조용히 해야 하는 시간", choices: ["밤 10시부터 아침 8시", "밤 11시부터 아침 8시"] },
      { key: "visitors", label: "방문객", choices: ["예약 인원 외 출입 불가", "낮에만 가능, 숙박은 불가"] },
      { key: "pets", label: "반려동물", choices: ["불가", "가능, 사전 문의"] },
      { key: "trash", label: "쓰레기 버리는 법", hint: "예: 일반·재활용·음식물로 나눠 주방 아래 봉투에 담고, 퇴실할 때 현관 안에 모아 두기", long: true },
      { key: "towels", label: "수건 추가", choices: ["추가 제공 없음, 세탁기와 건조기 이용", "호스트에게 문의"] },
    ],
  },
  {
    title: "시설",
    fields: [
      { key: "wifi", label: "와이파이 정보가 적힌 곳", hint: "비밀번호 자체는 적지 마세요", choices: ["거실 TV 옆 안내판", "공유기 뒷면 스티커", "체크인 안내 메시지"] },
      { key: "laundry", label: "세탁기와 건조기", choices: ["세탁기와 건조기 모두 있음", "세탁기만 있음, 건조대 사용", "없음"] },
      { key: "kitchen", label: "주방에서 쓸 수 있는 것", hint: "예: 인덕션, 전자레인지, 전기포트, 냉장고, 기본 그릇과 냄비", long: true },
      { key: "bathroom", label: "욕실 비품", hint: "없는 것도 적어 주세요. 예: 샴푸·바디워시·드라이어 있음, 칫솔·치약 없음", long: true },
      { key: "aircon", label: "에어컨과 난방 사용법", hint: "예: 에어컨 리모컨은 침대 옆, 난방은 거실 벽 조절기 전원 버튼만", long: true },
      { key: "trouble", label: "문이 안 열리거나 고장 났을 때", choices: ["직접 고치지 말고 사진과 함께 호스트에게 메시지"] },
    ],
  },
  {
    title: "주변 안내",
    fields: [
      { key: "airport", label: "공항에서 오는 길", hint: "예: 인천공항에서 공항철도로 서울역, 4호선으로 갈아타 ○○역 하차", long: true },
      { key: "nearby", label: "가까운 편의점과 약국", hint: "예: 건물 맞은편 편의점 24시간, 약국은 역 방향 도보 4분", long: true },
      { key: "food", label: "추천 식당", hint: "직접 가 본 곳만. 가게 이름, 메뉴, 걸어서 몇 분", long: true },
      { key: "sights", label: "가까운 볼거리", long: true },
    ],
  },
];

export const GUIDE_FIELDS = GUIDE_SECTIONS.flatMap((s) => s.fields);
export const MAX_EXTRA = 20;

export interface GuideExtra { q: string; a: string }
export interface GuideData { answers: Record<string, string>; extras: GuideExtra[] }

const KEY = "guide_bot";

export async function getGuideData(sql: postgres.Sql): Promise<GuideData> {
  const raw = await getSetting(sql, KEY);
  if (!raw) return { answers: {}, extras: [] };
  try {
    const v = JSON.parse(raw) as Partial<GuideData>;
    return { answers: v.answers ?? {}, extras: v.extras ?? [] };
  } catch {
    return { answers: {}, extras: [] };
  }
}

export async function saveGuideData(sql: postgres.Sql, data: GuideData): Promise<void> {
  await setSetting(sql, KEY, JSON.stringify(data));
}

// 비밀번호처럼 보이는 숫자를 막는다. 링크만 있으면 누구나 챗봇에 물어볼 수 있기 때문.
const SECRET_RE = /(비밀\s*번호|비번|도어\s*락|도어록|현관\s*번호|공동\s*현관|password|passcode|door\s*code|pin)\s*[:은는이가]?\s*[#*]?\d{3,}/i;

export function findSecret(data: GuideData): string | null {
  const texts = [...Object.values(data.answers), ...data.extras.flatMap((e) => [e.q, e.a])];
  return texts.find((t) => SECRET_RE.test(t)) ?? null;
}

export function filledCount(data: GuideData): number {
  return GUIDE_FIELDS.filter((f) => data.answers[f.key]?.trim()).length;
}

// Gem "요청 사항" 칸에 붙여 넣을 안내문. 비어 있는 칸은 아예 넣지 않고, 모르는 건 모른다고 답하게 한다.
export function buildGemInstructions(data: GuideData): string {
  const name = data.answers.name?.trim() || "우리 숙소";
  const lines: string[] = [
    `너는 "${name}"에 묵는 손님을 돕는 숙소 안내 도우미야.`,
    "",
    "답하는 방법",
    "- 손님이 쓴 언어로 답해. 한국어, 영어, 일본어, 중국어(간체·번체) 등 어떤 언어든 그 언어로 짧고 친절하게 답해.",
    "- 아래 '숙소 정보'에 있는 내용만 사실로 말해. 정보에 없는 것은 추측하지 말고 \"그 부분은 확인되지 않아요. 예약한 사이트의 메시지로 호스트에게 물어봐 주세요.\"처럼 답해.",
    "- 도어락 번호, 공동현관 번호, 와이파이 비밀번호는 절대 알려 주지 마. 체크인 안내 메시지를 확인하거나 호스트에게 물어보라고 안내해.",
    "- 가격 흥정, 환불, 예약 변경은 직접 처리하지 말고 예약한 사이트에서 호스트에게 문의하라고 안내해.",
    "- 다치거나 아프거나 불이 나는 등 급한 상황이면 먼저 119(화재·구급) 또는 112(경찰)에 연락하라고 안내하고, 외국어 도움은 1330 관광 안내 전화를 알려 줘.",
    "",
    "숙소 정보",
  ];
  for (const section of GUIDE_SECTIONS) {
    const filled = section.fields.filter((f) => data.answers[f.key]?.trim());
    if (!filled.length) continue;
    lines.push("", `[${section.title}]`);
    for (const f of filled) lines.push(`- ${f.label}: ${data.answers[f.key].trim().replace(/\s*\n\s*/g, " / ")}`);
  }
  const extras = data.extras.filter((e) => e.q.trim() && e.a.trim());
  if (extras.length) {
    lines.push("", "[자주 묻는 질문]");
    for (const e of extras) lines.push(`- 질문: ${e.q.trim()}`, `  답: ${e.a.trim().replace(/\s*\n\s*/g, " / ")}`);
  }
  return lines.join("\n");
}
