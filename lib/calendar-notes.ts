import type postgres from "postgres";
import type { AgeBand, Gender } from "./guests";

// 청소매니저(onjae-calendar)의 날짜별 메모에서 인원·성별만 읽어 예약에 채운다 (사장님 요청 2026-10-18).
// 메모 글은 저장하지 않는다. 메모 날짜 = 체크인 날짜인 확정 예약 한 건에만, 비어 있는 칸만 채운다.

export const NOTES_URL = process.env.CLEANING_NOTES_URL || "https://onjae-calendar.vercel.app/api/notes";

export interface NoteGuests {
  total: number | null; // "7명" 처럼 전체 인원
  adults: number | null; // 성인·어른
  children: number | null; // 아이·어린이·아동·유아
  childAges: number[];
  male: number;
  female: number;
}

const MALE = "(?:남자|남성|남(?=\\s*\\d))";
const FEMALE = "(?:여자|여성|여(?=\\s*\\d))";

function count(text: string, re: RegExp): number | null {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

/** 메모 한 줄에서 인원·성별을 읽는다. 사람 수가 없으면 null. */
export function parseNoteGuests(raw: string): NoteGuests | null {
  // 괄호 안 나이 목록: "아이(1.5.8.11.14)5 명"
  const childAges = [...raw.matchAll(/\(([\d.,\s]+)\)/g)].flatMap((m) => m[1].split(/[.,\s]+/).filter(Boolean).map(Number));
  const text = raw.replace(/\([^)]*\)/g, "");
  // 성별: "남2명", "남자 군인5명", "여성4명" 처럼 낱말이 앞에 오는 것을 먼저 보고, 없으면 "7명여성", "4명 한국여성" 처럼 뒤에 오는 것.
  let male = count(text, new RegExp(`${MALE}\\D{0,4}?(\\d+)\\s*명`)) ?? 0;
  let female = count(text, new RegExp(`${FEMALE}\\D{0,4}?(\\d+)\\s*명`)) ?? 0;
  if (!male && !female) {
    male = count(text, new RegExp(`(\\d+)\\s*명\\D{0,4}?${MALE}`)) ?? 0;
    female = count(text, new RegExp(`(\\d+)\\s*명\\D{0,4}?${FEMALE}`)) ?? 0;
  }
  const adults = count(text, /(?:성인|어른)\s*(\d+)/);
  const children = count(text, /(?:아이|어린이|아동|유아)\s*(\d+)/);
  const total = count(text, /(\d+)\s*명/);
  if (total === null && adults === null && !male && !female) return null;
  return { total, adults, children, childAges, male, female };
}

const childBand = (age: number | undefined): AgeBand => (age !== undefined && age >= 13 ? "10s" : "child");

/** 투숙객 줄: 남·여 수만큼, 아이 수만큼(나이를 알면 나이대). 아무것도 모르면 빈 목록. */
export function guestsFromNote(n: NoteGuests): { gender: Gender; ageBand: AgeBand }[] {
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
    const rows = await sql<{ id: number; adults: number | null; children: number | null; profiles: number }[]>`
      SELECT r.id, r.adults, r.children, (SELECT count(*)::int FROM guest_profiles g WHERE g.reservation_id = r.id) AS profiles
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
        changes.push([n.male ? `남${n.male}` : "", n.female ? `여${n.female}` : "", kids ? `아이${kids}` : ""].filter(Boolean).join(" "));
      }
    });
    if (changes.length) applied.push(`${md(date)} ${changes.join(" · ")}`);
    else skipped.push(`${md(date)} (이미 입력됨)`);
  }
  return { applied, skipped };
}

export async function fetchCalendarNotes(): Promise<Record<string, string>> {
  const res = await fetch(NOTES_URL, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`청소매니저 메모를 가져오지 못했습니다 (HTTP ${res.status}).`);
  const json = (await res.json()) as { notes?: Record<string, string> };
  return json.notes ?? {};
}
