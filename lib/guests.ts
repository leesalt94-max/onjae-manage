import type postgres from "postgres";

// 사장님 결정(2026-10-18): 성별과 나이대만, 사장님이 예약마다 직접 입력. 모르면 "모름" 또는 비워둔다.
export const GENDERS = ["male", "female", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<string, string> = { male: "남", female: "여", unknown: "모름" };

export const AGE_BANDS = ["child", "10s", "20s", "30s", "40s", "50s", "60plus", "unknown"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const AGE_LABELS: Record<string, string> = {
  child: "아동",
  "10s": "10대",
  "20s": "20대",
  "30s": "30대",
  "40s": "40대",
  "50s": "50대",
  "60plus": "60대 이상",
  unknown: "모름",
};

export const MAX_GUESTS = 16;

export interface GuestInput {
  gender: Gender;
  ageBand: AgeBand;
}

/** 폼의 줄들을 저장할 투숙객으로. 성별·나이대 둘 다 비운 줄은 버리고, 한쪽만 고르면 나머지는 "모름". */
export function guestsFromForm(genders: string[], ageBands: string[]): GuestInput[] {
  const out: GuestInput[] = [];
  const rows = Math.max(genders.length, ageBands.length);
  for (let i = 0; i < Math.min(rows, MAX_GUESTS); i++) {
    const g = genders[i] ?? "";
    const a = ageBands[i] ?? "";
    if (g === "" && a === "") continue;
    out.push({
      gender: (GENDERS as readonly string[]).includes(g) ? (g as Gender) : "unknown",
      ageBand: (AGE_BANDS as readonly string[]).includes(a) ? (a as AgeBand) : "unknown",
    });
  }
  return out;
}

// 예약의 투숙객 목록을 통째로 바꾼다. 빈 목록이면 입력을 지운다. 예약이 없으면 false.
export async function saveGuestProfiles(sql: postgres.Sql, reservationId: number, guests: GuestInput[]): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [exists] = await tx`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`;
    if (!exists) return false;
    await tx`DELETE FROM guest_profiles WHERE reservation_id = ${reservationId}`;
    for (const g of guests) {
      await tx`INSERT INTO guest_profiles (reservation_id, gender, age_band) VALUES (${reservationId}, ${g.gender}, ${g.ageBand})`;
    }
    return true;
  });
}

export async function getReservationGuests(sql: postgres.Sql, reservationId: number) {
  const [reservation] = await sql<{
    id: number; channel: "airbnb" | "booking" | "trip"; confirmation: string; status: string; listing: string | null;
    check_in: string; check_out: string; nights: number; adults: number | null; children: number | null; infants: number | null;
  }[]>`
    SELECT id, channel, confirmation, status, listing, to_char(check_in, 'YYYY-MM-DD') AS check_in,
           to_char(check_out, 'YYYY-MM-DD') AS check_out, nights, adults, children, infants
    FROM reservations WHERE id = ${reservationId}`;
  if (!reservation) return null;
  const guests = await sql<{ gender: Gender; age_band: AgeBand }[]>`
    SELECT gender, age_band FROM guest_profiles WHERE reservation_id = ${reservationId} ORDER BY id`;
  return { reservation, guests };
}
