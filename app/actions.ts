"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout, requireOwner } from "@/lib/auth";
import { deleteCredentials, saveCredentials, setEnabled } from "@/lib/credentials";
import { db } from "@/lib/db";
import { importFiles } from "@/lib/import-files";
import { fetchCalendarNotes, importCalendarNotes } from "@/lib/calendar-notes";
import { sendKakao } from "@/lib/kakao";
import { guestsFromForm, MAX_GUESTS, REGION_LABELS, regionFromForm, saveGuestProfiles } from "@/lib/guests";
import { findSecret, GUIDE_FIELDS, MAX_EXTRA, saveGuideData } from "@/lib/guide-bot";
import { getGeminiKey, setGeminiKey } from "@/lib/gemini";
import { resetGuideToken, translateGuide } from "@/lib/guide-page";
import { answerOtp } from "@/lib/otp";
import { isXls, xlsToCsv } from "@/lib/parsers/xls";
import { xlsxToCsv } from "@/lib/parsers/xlsx";
import { createPcToken } from "@/lib/pc-token";
import { setCancelledByOwner } from "@/lib/reservations";
import { setSetting } from "@/lib/settings";
import { CHANNELS } from "@/lib/types";

const channelSchema = z.enum(CHANNELS);

function back(path: string, msg: string, kind: "ok" | "error" = "ok"): never {
  redirect(`${path}?${new URLSearchParams({ [kind]: msg })}`);
}

export async function loginAction(formData: FormData) {
  const result = await login(String(formData.get("password") ?? ""), String(formData.get("totp") ?? ""), formData.get("remember") === "on");
  if (!result.ok) back("/login", result.error, "error");
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function saveCredentialAction(formData: FormData) {
  await requireOwner();
  const parsed = z
    .object({ channel: channelSchema, username: z.string().trim().min(1), password: z.string().min(1) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/settings", "아이디와 비밀번호를 모두 입력해 주세요.", "error");
  await saveCredentials(db(), parsed.data.channel, parsed.data.username, parsed.data.password);
  back("/settings", "암호화해서 저장했습니다. 다음 자동 수집부터 사용됩니다.");
}

export async function toggleCredentialAction(formData: FormData) {
  await requireOwner();
  const channel = channelSchema.parse(formData.get("channel"));
  await setEnabled(db(), channel, formData.get("enabled") === "true");
  back("/settings", "변경했습니다.");
}

export async function deleteCredentialAction(formData: FormData) {
  await requireOwner();
  await deleteCredentials(db(), channelSchema.parse(formData.get("channel")));
  back("/settings", "로그인 정보를 삭제했습니다.");
}

export async function answerOtpAction(formData: FormData) {
  await requireOwner();
  const id = Number(formData.get("id"));
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^[0-9A-Za-z]{4,10}$/.test(code)) back("/otp", "인증번호 형식이 올바르지 않습니다.", "error");
  const ok = await answerOtp(db(), id, code);
  if (!ok) back("/otp", "요청이 만료되었습니다. 다음 수집 때 다시 요청됩니다.", "error");
  back("/otp", "전달했습니다. 수집기가 곧 로그인을 이어갑니다.");
}

export async function uploadAction(formData: FormData) {
  await requireOwner();
  const channel = channelSchema.safeParse(formData.get("channel"));
  const file = formData.get("file");
  if (!channel.success || !(file instanceof File) || file.size === 0) {
    back("/upload", "플랫폼과 파일을 선택해 주세요.", "error");
  }
  if (file.size > 10 * 1024 * 1024) back("/upload", "파일이 너무 큽니다 (10MB 이하).", "error");

  // 트립닷컴처럼 엑셀(xls·xlsx)로만 주는 곳도 있어 CSV 로 바꿔 읽는다.
  const buf = Buffer.from(await file.arrayBuffer());
  const text = isXls(buf) ? xlsToCsv(buf) : buf[0] === 0x50 && buf[1] === 0x4b ? await xlsxToCsv(buf) : buf.toString("utf8");
  const result = await importFiles(db(), channel.data, [text], "csv_upload");
  if (!result.ok) back("/upload", result.error ?? "읽을 수 있는 예약이 없습니다.", "error");
  back("/upload", `새 예약 ${result.inserted}건, 갱신 ${result.updated}건, 건너뛴 행 ${result.skipped}개`);
}

export async function saveRoomCountAction(formData: FormData) {
  await requireOwner();
  const n = Number(formData.get("roomCount"));
  if (!Number.isInteger(n) || n < 1 || n > 50) back("/settings", "객실 수는 1~50 사이 숫자로 넣어 주세요.", "error");
  await setSetting(db(), "room_count", String(n));
  back("/settings", `객실 수를 ${n}개로 저장했습니다. 통계 가동률에 바로 반영됩니다.`);
}

export async function saveOpenedOnAction(formData: FormData) {
  await requireOwner();
  const v = String(formData.get("openedOn") ?? "").trim();
  if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) back("/settings", "날짜 형식이 올바르지 않습니다.", "error");
  await setSetting(db(), "opened_on", v);
  back("/settings", v ? `오픈일을 ${v}로 저장했습니다. 가동률을 이날부터 계산합니다.` : "오픈일을 비웠습니다 (첫 체크인 날짜를 씁니다).");
}

export async function saveTripCommissionAction(formData: FormData) {
  await requireOwner();
  const pctRaw = String(formData.get("tripCommissionPct") ?? "").trim();
  const feeRaw = String(formData.get("tripCleaningFee") ?? "").trim();
  const pct = Number(pctRaw);
  const fee = Number(feeRaw);
  if (pctRaw !== "" && !(Number.isFinite(pct) && pct > 0 && pct < 100)) back("/settings", "수수료율은 0보다 크고 100보다 작은 숫자로 넣어 주세요.", "error");
  if (feeRaw !== "" && !(Number.isFinite(fee) && fee >= 0)) back("/settings", "청소비는 0 이상의 숫자로 넣어 주세요.", "error");
  const sql = db();
  await setSetting(sql, "trip_commission_pct", pctRaw);
  await setSetting(sql, "trip_cleaning_fee", feeRaw);
  back("/settings", `트립닷컴 수수료율 ${pctRaw || "15(기본)"}%, 청소비 ${feeRaw || "50,000(기본)"}원으로 계산합니다.`);
}

export async function saveRateBasisAction(formData: FormData) {
  await requireOwner();
  const wd = String(formData.get("weekday") ?? "").trim();
  const we = String(formData.get("weekend") ?? "").trim();
  for (const v of [wd, we]) if (v !== "" && !(Number(v) > 0)) back("/settings", "요금은 0보다 큰 숫자로 넣어 주세요.", "error");
  const sql = db();
  await setSetting(sql, "base_weekday_rate", wd);
  await setSetting(sql, "base_weekend_rate", we);
  back("/settings", `평일 ${wd || "124,000(기본)"}원, 주말 ${we || "175,000(기본)"}원 비율로 분석합니다.`);
}

// 청소매니저 메모의 인원·성별을 예약에 채운다. 이미 입력한 칸은 건드리지 않아 여러 번 눌러도 된다.
export async function importCalendarNotesAction() {
  await requireOwner();
  let msg: string;
  try {
    const result = await importCalendarNotes(db(), await fetchCalendarNotes());
    // 한 줄에 하나씩. 이미 입력된 예약은 개수만 (사장님 요청 2026-10-18).
    const already = result.skipped.filter((s) => s.endsWith("(이미 입력됨)")).length;
    const other = result.skipped.filter((s) => !s.endsWith("(이미 입력됨)"));
    const lines = [result.applied.length ? `새로 반영한 메모 ${result.applied.length}건` : "새로 반영할 메모가 없어요.", ...result.applied.map((a) => `· ${a}`)];
    if (already) lines.push("", `이미 입력돼 있어 그대로 둔 예약 ${already}건`);
    if (other.length) lines.push("", `반영하지 못한 메모 ${other.length}건`, ...other.map((s) => `· ${s}`));
    msg = lines.join("\n");
  } catch (e) {
    back("/settings", e instanceof Error ? e.message : "청소매니저 메모를 가져오지 못했습니다.", "error");
  }
  back("/settings", msg);
}

export async function kakaoTestAction() {
  await requireOwner();
  const ok = await sendKakao(db(), "온재 숙소 관리 알림 테스트입니다.");
  back("/settings", ok ? "카카오톡으로 테스트 메시지를 보냈습니다." : "전송하지 못했습니다. 카카오 연결을 확인해 주세요.", ok ? "ok" : "error");
}

// 플랫폼 파일에 취소가 안 잡힌 예약을 사장님이 직접 취소로 표시하거나 되돌린다.
export async function setCancelledAction(formData: FormData) {
  await requireOwner();
  const id = Number(formData.get("reservationId"));
  const cancel = formData.get("cancel") === "1";
  if (!Number.isInteger(id) || id <= 0) back("/reservations", "예약을 찾지 못했습니다.", "error");
  const ok = await setCancelledByOwner(db(), id, cancel);
  back(`/reservations/${id}`, ok ? (cancel ? "취소된 예약으로 표시했어요. 수익·가동률에서 빠집니다." : "취소 표시를 되돌렸어요.") : "바꾸지 못했습니다.", ok ? "ok" : "error");
}

// 사장님이 예약마다 투숙객 성별·나이대를 입력한다. 둘 다 비운 줄은 저장하지 않는다.
export async function saveGuestsAction(formData: FormData) {
  await requireOwner();
  const reservationId = Number(formData.get("reservationId"));
  if (!Number.isInteger(reservationId) || reservationId <= 0) back("/reservations", "예약을 찾지 못했습니다.", "error");
  const guests = guestsFromForm(
    formData.getAll("gender").map(String).slice(0, MAX_GUESTS),
    formData.getAll("ageBand").map(String).slice(0, MAX_GUESTS),
  );
  const region = regionFromForm(String(formData.get("region") ?? ""));
  const saved = await saveGuestProfiles(db(), reservationId, guests, region);
  if (!saved) back("/reservations", "예약을 찾지 못했습니다.", "error");
  // 저장하면 홈으로 돌아간다 (사장님 요청 2026-10-18).
  back("/", guests.length || region ? `저장했습니다 (${guests.length}명${region ? `, ${REGION_LABELS[region]}` : ""}).` : "입력을 비웠습니다.");
}

// 사장님 컴퓨터 수집 프로그램용 연결 코드. 화면에 한 번만 보여 준다.
export async function createPcTokenAction(): Promise<{ token: string }> {
  await requireOwner();
  return { token: await createPcToken(db()) };
}

export async function saveGuideBotAction(formData: FormData) {
  await requireOwner();
  const answers: Record<string, string> = {};
  for (const f of GUIDE_FIELDS) {
    const v = String(formData.get(f.key) ?? "").trim().slice(0, 1000);
    if (v) answers[f.key] = v;
  }
  const qs = formData.getAll("extraQ").map(String);
  const as = formData.getAll("extraA").map(String);
  const extras = qs
    .map((q, i) => ({ q: q.trim().slice(0, 300), a: String(as[i] ?? "").trim().slice(0, 1000) }))
    .filter((e) => e.q || e.a)
    .slice(0, MAX_EXTRA);
  const data = { answers, extras };
  if (findSecret(data)) back("/chatbot", "비밀번호나 도어락 번호처럼 보이는 숫자가 있어요. 링크만 있으면 누구나 물어볼 수 있으니 지우고 저장해 주세요.", "error");
  const sql = db();
  await saveGuideData(sql, data);
  // 번역은 시간이 걸려서 화면을 먼저 돌려준다. 끝나기 전까지 손님 페이지는 한국어로 보인다.
  if (await getGeminiKey(sql)) after(() => translateGuide(sql).then(() => undefined));
  back("/chatbot", "저장했습니다. 영어·일본어·중국어 번역은 1분쯤 뒤 손님 페이지에 반영돼요.");
}

export async function saveGeminiKeyAction(formData: FormData) {
  await requireOwner();
  const key = String(formData.get("geminiKey") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(key)) back("/chatbot", "API 키 모양이 아니에요. AI Studio 에서 복사한 키를 그대로 붙여 넣어 주세요.", "error");
  const sql = db();
  await setGeminiKey(sql, key);
  const result = await translateGuide(sql).catch(() => null);
  if (!result || result.ok.length === 0) back("/chatbot", "키는 저장했지만 Gemini 연결에 실패했어요. 키를 다시 확인해 주세요.", "error");
  back("/chatbot", "API 키를 저장하고 번역을 만들었어요. 이제 손님 페이지에 채팅창이 보여요.");
}

export async function translateGuideAction() {
  await requireOwner();
  const result = await translateGuide(db()).catch(() => null);
  if (!result || result.ok.length === 0) back("/chatbot", "번역에 실패했어요. 잠시 뒤 다시 눌러 주세요.", "error");
  back("/chatbot", result.failed.length ? `번역을 만들었어요. 일부 언어는 실패해서 다시 눌러야 해요.` : "번역을 새로 만들었어요.");
}

export async function resetGuideTokenAction() {
  await requireOwner();
  await resetGuideToken(db());
  back("/chatbot", "새 링크를 만들었어요. 예전 링크는 더 이상 열리지 않아요.");
}
