import type postgres from "postgres";
import { REGION_LABELS, type AgeBand, type Gender, type Region } from "./guests";
import { getSetting, setSetting } from "./settings";

// 청소매니저(onjae-calendar)의 날짜별 메모에서 인원·성별·나라·나이대만 읽어 예약에 채운다 (사장님 요청 2026-10-18).
// 청소매니저 입력 양식은 "전체인원: 4명 (여: 2명 + 남: 2명)", "나라: 일본", "나이대: 20대 4명" 줄로 남긴다.
// 메모 글은 저장하지 않는다. 메모 날짜 = 체크인 날짜인 확정 예약 한 건에만, 비어 있는 칸만 채운다.

export const NOTES_URL = process.env.CLEANING_NOTES_URL || "https://onjae-calendar.vercel.app/api/notes";

export interface NoteGuests {
  total: number | null; // "7명" 처럼 전체 인원
  adults: number | null; // 성인·어른
  children: number | null; // 아이·어린이·아동·유아
  childAges: number[];
  male: number;
  female: number;
  region: Region | null; // "나라:" 줄
  ages: AgeBand[]; // "나이대:" 줄을 사람 수만큼 펼친 것
}

const MALE = "(?:남자|남성|남(?=\\s*:?\\s*\\d))";
const FEMALE = "(?:여자|여성|여(?=\\s*:?\\s*\\d))";

// 나라 이름 → 지역 (중국·대만·홍콩은 하나로, 사장님 결정). 모르는 나라는 기타.
const REGION_WORDS: [Region, RegExp][] = [
  ["japan", /일본|japan/i],
  ["china", /중국|대만|홍콩|마카오|china|taiwan|hong\s*kong/i],
  ["usa", /미국|usa|america/i],
  ["europe", /유럽|영국|프랑스|독일|이탈리아|스페인|포르투갈|네덜란드|벨기에|스위스|오스트리아|스웨덴|노르웨이|덴마크|핀란드|폴란드|체코|헝가리|그리스|아일랜드|러시아|우크라이나|europe|uk|france|germany|italy|spain/i],
  ["asia", /아시아|싱가포르|태국|베트남|필리핀|말레이시아|인도네시아|인도|몽골|캄보디아|라오스|미얀마|카자흐스탄|우즈베키스탄|asia|singapore|thailand|vietnam|philippines|malaysia|indonesia/i],
];
export function regionFromCountry(raw: string): Region | null {
  const t = raw.trim();
  if (!t) return null;
  return REGION_WORDS.find(([, re]) => re.test(t))?.[0] ?? "other";
}

/** "20대 4명, 30대 1명, 아이 1명" → 사람 수만큼 나이대. 수가 없으면("20대") 전체 인원만큼. */
export function agesFromText(raw: string, total: number | null): AgeBand[] {
  const out: AgeBand[] = [];
  for (const m of raw.matchAll(/(?:([1-9])0\s*대(?:\s*이상)?|(아이|아동|어린이|유아))\s*(\d+)?\s*명?/g)) {
    const band: AgeBand = m[2] ? "child" : Number(m[1]) >= 6 ? "60plus" : (`${m[1]}0s` as AgeBand);
    const n = m[3] ? Number(m[3]) : total ?? 1;
    for (let i = 0; i < Math.min(n, 16); i++) out.push(band);
  }
  return out.slice(0, 16);
}

function count(text: string, re: RegExp): number | null {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

/** 메모 한 줄에서 인원·성별을 읽는다. 사람 수가 없으면 null. */
export function parseNoteGuests(raw: string): NoteGuests | null {
  // 양식 줄: 나라·나이대는 따로 읽고 인원 계산에서는 뺀다 ("20대 4명"을 인원으로 세지 않게)
  const lineOf = (key: string) => raw.match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`, "m"))?.[1] ?? "";
  const country = lineOf("나라");
  const ageText = lineOf("나이대");
  const body = raw.replace(/^\s*(?:나라|나이대)\s*:.*$/gm, "");
  // 괄호 안 나이 목록: "아이(1.5.8.11.14)5 명"
  const childAges = [...body.matchAll(/\(([\d.,\s]+)\)/g)].flatMap((m) => m[1].split(/[.,\s]+/).filter(Boolean).map(Number));
  const text = body.replace(/\([\d.,\s]+\)/g, "");
  // 성별: "남2명", "남자 군인5명", "여성4명" 처럼 낱말이 앞에 오는 것을 먼저 보고, 없으면 "7명여성", "4명 한국여성" 처럼 뒤에 오는 것.
  let male = count(text, new RegExp(`${MALE}\\D{0,4}?(\\d+)\\s*명`)) ?? 0;
  let female = count(text, new RegExp(`${FEMALE}\\D{0,4}?(\\d+)\\s*명`)) ?? 0;
  if (!male && !female) {
    male = count(text, new RegExp(`(\\d+)\\s*명\\D{0,4}?${MALE}`)) ?? 0;
    female = count(text, new RegExp(`(\\d+)\\s*명\\D{0,4}?${FEMALE}`)) ?? 0;
  }
  const adults = count(text, /(?:성인|어른)\s*(\d+)/);
  const children = count(text, /(?:아이|어린이|아동|유아)\s*(\d+)/);
  const total = count(text, /(?:전체\s*인원\s*:?\s*)?(\d+)\s*명/);
  const region = regionFromCountry(country);
  const ages = agesFromText(ageText, total ?? (male + female || null));
  if (total === null && adults === null && !male && !female && !region && !ages.length) return null;
  return { total, adults, children, childAges, male, female, region, ages };
}

const childBand = (age: number | undefined): AgeBand => (age !== undefined && age >= 13 ? "10s" : "child");

/** 투숙객 줄: 남·여 수만큼, 아이 수만큼(나이를 알면 나이대). 아무것도 모르면 빈 목록. */
export function guestsFromNote(n: NoteGuests): { gender: Gender; ageBand: AgeBand }[] {
  // "나이대:" 줄이 있으면 성별 목록과 나이대 목록을 순서대로 짝짓는다 (여 먼저, 그다음 남).
  if (n.ages.length) {
    const genders: Gender[] = [...Array(n.female).fill("female"), ...Array(n.male).fill("male")];
    const len = Math.min(16, Math.max(genders.length, n.ages.length));
    return Array.from({ length: len }, (_, i) => ({ gender: genders[i] ?? "unknown", ageBand: n.ages[i] ?? "unknown" }));
  }
  const out: { gender: Gender; ageBand: AgeBand }[] = [];
  for (let i = 0; i < n.male; i++) out.push({ gender: "male", ageBand: "unknown" });
  for (let i = 0; i < n.female; i++) out.push({ gender: "female", ageBand: "unknown" });
  for (let i = 0; i < (n.children ?? 0); i++) out.push({ gender: "unknown", ageBand: childBand(n.childAges[i]) });
  return out.slice(0, 16);
}

export interface NotesImportResult {
  applied: string[]; // "9/24 여7" 처럼 화면에 보일 요약
  skipped: string[];
}

export async function importCalendarNotes(sql: postgres.Sql, notes: Record<string, string>): Promise<NotesImportResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  for (const [date, text] of Object.entries(notes).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof text !== "string") continue;
    const n = parseNoteGuests(text);
    if (!n) continue;
    const rows = await sql<{ id: number; adults: number | null; children: number | null; guest_region: string | null; profiles: number }[]>`
      SELECT r.id, r.adults, r.children, r.guest_region, (SELECT count(*)::int FROM guest_profiles g WHERE g.reservation_id = r.id) AS profiles
      FROM reservations r WHERE r.check_in = ${date} AND r.status IN ('confirmed', 'completed')`;
    if (rows.length !== 1) {
      skipped.push(`${md(date)} (${rows.length ? "같은 날 예약이 여러 건" : "그날 체크인 예약 없음"})`);
      continue;
    }
    const r = rows[0];
    const kids = n.children ?? 0;
    const adults = n.adults ?? (n.male + n.female > 0 ? n.male + n.female : n.total !== null ? n.total - kids : null);
    const changes: string[] = [];
    await sql.begin(async (tx) => {
      if (r.adults === null && r.children === null && adults !== null) {
        await tx`UPDATE reservations SET adults = ${adults}, children = ${kids} WHERE id = ${r.id}`;
        changes.push(`${adults + kids}명`);
      }
      const guests = guestsFromNote(n);
      if (r.profiles === 0 && guests.length) {
        for (const g of guests) await tx`INSERT INTO guest_profiles (reservation_id, gender, age_band) VALUES (${r.id}, ${g.gender}, ${g.ageBand})`;
        changes.push([n.male ? `남${n.male}` : "", n.female ? `여${n.female}` : "", kids ? `아이${kids}` : "", n.ages.length ? "나이대" : ""].filter(Boolean).join(" "));
      }
      if (r.guest_region === null && n.region) {
        await tx`UPDATE reservations SET guest_region = ${n.region} WHERE id = ${r.id}`;
        changes.push(REGION_LABELS[n.region]);
      }
    });
    if (changes.length) applied.push(`${md(date)} ${changes.join(" · ")}`);
    else skipped.push(`${md(date)} (이미 입력됨)`);
  }
  return { applied, skipped };
}

export async function fetchCalendarNotes(timeoutMs = 15_000): Promise<Record<string, string>> {
  const res = await fetch(NOTES_URL, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`청소매니저 메모를 가져오지 못했습니다 (HTTP ${res.status}).`);
  const json = (await res.json()) as { notes?: Record<string, string> };
  return json.notes ?? {};
}

const AUTO_EVERY_MS = 10 * 60_000;

/**
 * 홈을 열거나 수집 프로그램이 파일을 보낼 때 자동으로 가져온다 (사장님이 버튼을 누르지 않아도 되게, 2026-10-18).
 * 10분에 한 번만, 실패해도 화면은 그대로 보여 준다.
 */
export async function autoImportCalendarNotes(sql: postgres.Sql): Promise<void> {
  try {
    const last = Number(await getSetting(sql, "notes_imported_at"));
    if (Number.isFinite(last) && Date.now() - last < AUTO_EVERY_MS) return;
    await setSetting(sql, "notes_imported_at", String(Date.now()));
    await importCalendarNotes(sql, await fetchCalendarNotes(5_000));
  } catch (e) {
    console.warn("청소매니저 메모 자동 가져오기 실패", e);
  }
}
