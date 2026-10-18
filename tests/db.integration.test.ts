import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TEST_DATABASE_URL 이 있을 때만 실제 Postgres 로 SQL 을 검증한다 (CI 에서는 서비스 컨테이너 사용).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("DB 통합", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.APP_URL = "https://example.test";
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const schema = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
    await sql.unsafe(schema);
    await sql.unsafe(schema); // 두 번 실행해도 안전해야 한다
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("예약 목록과 거래 내역이 같은 예약으로 합쳐지고 상태는 유지된다", async () => {
    const { parseExport } = await import("../lib/parsers");
    const { upsertReservations } = await import("../lib/ingest");
    const reservations = parseExport("airbnb", `Confirmation code,Status,Guest name,# of adults,# of children,# of infants,Start date,End date,# of nights,Booked,Listing,Earnings
HMABC123,Canceled by guest,Jane,2,0,0,10/20/2026,10/23/2026,3,09/01/2026,Room,"₩450,000"`);
    const first = await upsertReservations(sql, reservations.reservations, "csv_upload");
    expect(first).toEqual({ inserted: 1, updated: 0 });

    const tx = parseExport("airbnb", `Date,Type,Confirmation Code,Start date,End date,Nights,Guest,Currency,Amount,Service fee,Gross earnings
10/24/2026,Reservation,HMABC123,10/20/2026,10/23/2026,3,Jane,KRW,436500,13500,450000`);
    const second = await upsertReservations(sql, tx.reservations, "auto_login");
    expect(second).toEqual({ inserted: 0, updated: 1 });

    const [row] = await sql`SELECT status, adults, commission::float, payout_amount::float, raw FROM reservations WHERE confirmation = 'HMABC123'`;
    expect(row).toMatchObject({ status: "cancelled", adults: 2, commission: 13500, payout_amount: 436500 });
    expect(JSON.stringify(row.raw)).not.toContain("Jane");
  });

  it("통계 쿼리가 월을 걸친 숙박을 나눠 센다", async () => {
    const { upsertReservations } = await import("../lib/ingest");
    const { occupancy, monthlyByChannel, summary, genderBreakdown, ageBands, guestCoverage, upcoming, lastSyncs } = await import("../lib/stats");
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, "0");
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const checkIn = `${y}-${pad(m)}-${pad(lastDay - 1)}`;
    const next = new Date(Date.UTC(y, m, 2)).toISOString().slice(0, 10);
    await upsertReservations(sql, [{
      channel: "booking", confirmation: "B1", status: "confirmed", listing: null, adults: 2, children: 1, infants: null,
      bookedAt: null, checkIn, checkOut: next, nights: 3, currency: "KRW", grossAmount: 300000, discountAmount: null,
      guestPaid: 300000, commission: 45000, taxes: null, payoutAmount: 255000, cancelledAt: null, raw: {},
    }], "csv_upload");
    const [id] = await sql<{ id: number }[]>`SELECT id FROM reservations WHERE confirmation = 'B1'`;
    await sql`INSERT INTO guest_profiles (reservation_id, gender, age_band) VALUES (${id.id}, 'female', '30s'), (${id.id}, 'male', 'child')`;

    const occ = await occupancy(sql, 1, 2);
    const thisMonth = occ.find((o) => o.month === `${y}-${pad(m)}`)!;
    expect(thisMonth.occupiedNights).toBe(2);
    expect(thisMonth.availableNights).toBe(lastDay);

    const monthly = await monthlyByChannel(sql, 1);
    expect(monthly.find((r) => r.channel === "booking")).toMatchObject({ bookings: 1, payout: 255000, commission: 45000 });

    const s = await summary(sql, "2000-01-01", "2100-01-01");
    expect(s.cancelled).toBe(1);
    expect(s.avgPartySize).toBe(2.5);
    expect(await genderBreakdown(sql, "2000-01-01", "2100-01-01")).toHaveLength(2);
    expect((await ageBands(sql, "2000-01-01", "2100-01-01")).map((a) => a.band)).toEqual(["child", "30s"]);
    expect(await guestCoverage(sql, "2000-01-01", "2100-01-01")).toEqual({ entered: 1, regionEntered: 0, total: 1 });
    await upcoming(sql, 7);
    await lastSyncs(sql);
  });

  it("트립닷컴 입금가만 있는 예약은 설정한 수수료율로 판매가·수수료를 역산한다", async () => {
    const { parseExport } = await import("../lib/parsers");
    const { upsertReservations } = await import("../lib/ingest");
    const { monthlyByChannel } = await import("../lib/stats");
    const { setSetting } = await import("../lib/settings");
    const d = new Date();
    const day = (n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), n)).toISOString().slice(0, 10);
    const parsed = parseExport("trip", `예약 번호,예약 상태,체크인 날짜,체크 아웃 날짜,투숙 박수,통화 종류,객실 입금가,객실 판매가
TRIPRATE1,확인함,${day(1)},${day(3)},2,KRW,85000.00,`);
    await upsertReservations(sql, parsed.reservations, "csv_upload");
    const tripRow = async () => (await monthlyByChannel(sql, 1)).find((r) => r.channel === "trip")!;

    // 설정이 없으면 기본값(수수료 15%, 청소비 50,000): 35,000 ÷ 0.85 + 50,000
    expect((await tripRow()).guestPaid).toBeCloseTo(91176.47, 1);
    await setSetting(sql, "trip_cleaning_fee", "0");
    expect(await tripRow()).toMatchObject({ payout: 85000, guestPaid: 100000, commission: 15000 });
    // 청소비 30,000 은 수수료 없이 그대로: 객실 입금 55,000 ÷ 0.85 ≈ 64,706 + 30,000
    await setSetting(sql, "trip_cleaning_fee", "30000");
    const row = await tripRow();
    expect(row.guestPaid).toBeCloseTo(94705.88, 1);
    expect(row.commission).toBeCloseTo(9705.88, 1);
    await setSetting(sql, "trip_commission_pct", "");
    await setSetting(sql, "trip_cleaning_fee", "");
  });

  it("사장님이 입력한 투숙객 정보는 예약마다 통째로 바뀌고, 비우면 미입력이 된다", async () => {
    const { saveGuestProfiles, getReservationGuests } = await import("../lib/guests");
    const [{ id }] = await sql<{ id: number }[]>`SELECT id FROM reservations WHERE confirmation = 'B1'`;
    expect(await saveGuestProfiles(sql, id, [{ gender: "male", ageBand: "40s" }, { gender: "unknown", ageBand: "child" }], "japan")).toBe(true);
    expect((await getReservationGuests(sql, id))?.reservation.guest_region).toBe("japan");
    const { regionBreakdown } = await import("../lib/stats");
    expect(await regionBreakdown(sql, "2000-01-01", "2100-01-01")).toEqual([expect.objectContaining({ region: "japan", count: 1 })]);
    expect((await getReservationGuests(sql, id))?.guests).toEqual([
      { gender: "male", age_band: "40s" },
      { gender: "unknown", age_band: "child" },
    ]);
    expect(await saveGuestProfiles(sql, id, [])).toBe(true);
    expect((await getReservationGuests(sql, id))?.guests).toEqual([]);
    expect((await getReservationGuests(sql, id))?.reservation.guest_region).toBeNull();
    expect(await saveGuestProfiles(sql, 999999, [])).toBe(false);
  });

  it("사장님이 취소로 표시한 예약은 파일을 다시 올려도 확정으로 돌아가지 않는다", async () => {
    const { upsertReservations } = await import("../lib/ingest");
    const { setCancelledByOwner } = await import("../lib/reservations");
    const base = { channel: "airbnb" as const, confirmation: "HOSTCXL", listing: null, adults: null, children: null, infants: null,
      bookedAt: null, checkIn: "2026-10-09", checkOut: "2026-10-10", nights: 1, currency: "KRW", grossAmount: null, discountAmount: null,
      guestPaid: null, commission: 3000, taxes: null, payoutAmount: 100000, cancelledAt: null, raw: {} };
    await upsertReservations(sql, [{ ...base, status: "confirmed" }], "owner_pc");
    const [{ id }] = await sql<{ id: number }[]>`SELECT id FROM reservations WHERE confirmation = 'HOSTCXL'`;
    expect(await setCancelledByOwner(sql, id, true)).toBe(true);
    await upsertReservations(sql, [{ ...base, status: "confirmed" }], "owner_pc");
    expect((await sql`SELECT status FROM reservations WHERE id = ${id}`)[0].status).toBe("cancelled");
    expect(await setCancelledByOwner(sql, id, false)).toBe(true);
    expect((await sql`SELECT status FROM reservations WHERE id = ${id}`)[0].status).toBe("confirmed");
  });

  it("청소매니저 메모로 그날 체크인한 예약의 빈 인원·성별만 채운다", async () => {
    const { upsertReservations } = await import("../lib/ingest");
    const { importCalendarNotes } = await import("../lib/calendar-notes");
    const base = { listing: null, adults: null, children: null, infants: null, bookedAt: null, nights: 2, currency: "KRW",
      grossAmount: null, discountAmount: null, guestPaid: null, commission: null, taxes: null, payoutAmount: 100000, cancelledAt: null, raw: {} };
    await upsertReservations(sql, [
      { ...base, channel: "trip", confirmation: "NOTE1", status: "confirmed", checkIn: "2030-03-03", checkOut: "2030-03-05" },
      { ...base, channel: "airbnb", confirmation: "NOTE2", status: "confirmed", checkIn: "2030-03-10", checkOut: "2030-03-12", adults: 3 },
    ], "owner_pc");
    const r = await importCalendarNotes(sql, { "2030-03-03": "여성4명 2박", "2030-03-10": "남2명 여1명", "2030-03-20": "5명", "2030-03-04": "청소만" });
    expect(r.applied).toEqual(["3/3 4명 · 여4", "3/10 남2 여1"]);
    expect(r.skipped).toEqual(["3/20 (그날 체크인 예약 없음)"]);
    const [n1] = await sql`SELECT adults, children, (SELECT count(*)::int FROM guest_profiles WHERE reservation_id = r.id) AS p FROM reservations r WHERE confirmation = 'NOTE1'`;
    expect(n1).toMatchObject({ adults: 4, children: 0, p: 4 });
    const [n2] = await sql`SELECT adults FROM reservations WHERE confirmation = 'NOTE2'`;
    expect(n2.adults).toBe(3); // 플랫폼 인원은 그대로
    const again = await importCalendarNotes(sql, { "2030-03-03": "여성4명 2박" });
    expect(again).toEqual({ applied: [], skipped: ["3/3 (이미 입력됨)"] });
  });

  it("로그인 정보는 암호화되어 저장되고 화면에는 가려진 아이디만 나온다", async () => {
    const { saveCredentials, loadEnabledLogins, listCredentialStatus, saveSessionState } = await import("../lib/credentials");
    await saveCredentials(sql, "airbnb", "owner@example.com", "s3cret!");
    const [raw] = await sql`SELECT username_enc, password_enc FROM platform_credentials WHERE channel = 'airbnb'`;
    expect(raw.password_enc).not.toContain("s3cret");
    await saveSessionState(sql, "airbnb", '{"cookies":[]}');
    const { logins: [login] } = await loadEnabledLogins(sql);
    expect(login).toMatchObject({ username: "owner@example.com", password: "s3cret!", sessionState: '{"cookies":[]}' });
    const [status] = await listCredentialStatus(sql);
    expect(status).toMatchObject({ maskedUsername: "own***", hasSession: true });
  });

  it("2단계 인증 코드를 사장님이 입력하면 수집기가 받아간다", async () => {
    const { requestOtp, answerOtp, pendingOtps } = await import("../lib/otp");
    let answered = false;
    const code = await requestOtp(sql, "booking", "코드 입력", 1, async () => {
      if (!answered) {
        const [pending] = await pendingOtps(sql);
        answered = await answerOtp(sql, pending.id, "123456");
      }
    });
    expect(code).toBe("123456");
    const [row] = await sql`SELECT status, code_enc FROM otp_requests ORDER BY id DESC LIMIT 1`;
    expect(row).toMatchObject({ status: "used", code_enc: null });
  });

  it("PC 연결 코드로만 예약 파일을 받고, 새 코드를 만들면 예전 코드는 끊긴다", async () => {
    const { createPcToken, verifyPcToken } = await import("../lib/pc-token");
    const { importFiles } = await import("../lib/import-files");
    const first = await createPcToken(sql);
    expect(await verifyPcToken(sql, first)).toBe(true);
    expect(await verifyPcToken(sql, "onjae_wrong")).toBe(false);
    expect(await verifyPcToken(sql, null)).toBe(false);
    const second = await createPcToken(sql);
    expect(await verifyPcToken(sql, first)).toBe(false);
    expect(await verifyPcToken(sql, second)).toBe(true);

    const csv = "Reservation,Amount,Check-in,Check-out,Booking date,Status,Guest(s)\n"
      + "PC-TRIP-1,KRW 100000.00,\"Dec 1, 2026\",\"Dec 3, 2026\",\"Oct 1, 2026\",Confirmed,KIM/TEST";
    const result = await importFiles(sql, "trip", [csv], "owner_pc");
    expect(result).toMatchObject({ ok: true, inserted: 1 });
    const [row] = await sql`SELECT source, nights, raw FROM reservations WHERE confirmation = 'PC-TRIP-1'`;
    expect(row.source).toBe("owner_pc");
    expect(row.nights).toBe(2);
    expect(JSON.stringify(row.raw)).not.toContain("KIM");
    const [run] = await sql`SELECT source, ok FROM sync_runs ORDER BY id DESC LIMIT 1`;
    expect(run).toMatchObject({ source: "owner_pc", ok: true });
  });
});

