"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout, requireOwner } from "@/lib/auth";
import { deleteCredentials, saveCredentials, setEnabled } from "@/lib/credentials";
import { db } from "@/lib/db";
import { importFiles } from "@/lib/import-files";
import { sendKakao } from "@/lib/kakao";
import { guestsFromForm, MAX_GUESTS, saveGuestProfiles } from "@/lib/guests";
import { answerOtp } from "@/lib/otp";
import { isXls, xlsToCsv } from "@/lib/parsers/xls";
import { xlsxToCsv } from "@/lib/parsers/xlsx";
import { createPcToken } from "@/lib/pc-token";
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
  back("/settings", pctRaw ? `트립닷컴 수수료율 ${pct}%, 청소비 ${feeRaw || 0}원으로 저장했습니다. 통계에 바로 반영됩니다.` : "트립닷컴 역산을 껐습니다.");
}

export async function kakaoTestAction() {
  await requireOwner();
  const ok = await sendKakao(db(), "온재 숙소 관리 알림 테스트입니다.");
  back("/settings", ok ? "카카오톡으로 테스트 메시지를 보냈습니다." : "전송하지 못했습니다. 카카오 연결을 확인해 주세요.", ok ? "ok" : "error");
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
  const saved = await saveGuestProfiles(db(), reservationId, guests);
  if (!saved) back("/reservations", "예약을 찾지 못했습니다.", "error");
  back(`/reservations/${reservationId}`, guests.length ? `저장했습니다 (${guests.length}명).` : "입력을 비웠습니다.");
}

// 사장님 컴퓨터 수집 프로그램용 연결 코드. 화면에 한 번만 보여 준다.
export async function createPcTokenAction(): Promise<{ token: string }> {
  await requireOwner();
  return { token: await createPcToken(db()) };
}
