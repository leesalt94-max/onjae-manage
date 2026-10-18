"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout, requireOwner } from "@/lib/auth";
import { deleteCredentials, saveCredentials, setEnabled } from "@/lib/credentials";
import { db } from "@/lib/db";
import { finishSyncRun, startSyncRun, upsertReservations } from "@/lib/ingest";
import { sendKakao } from "@/lib/kakao";
import { answerOtp } from "@/lib/otp";
import { parseExport } from "@/lib/parsers";
import { CHANNELS } from "@/lib/types";

const channelSchema = z.enum(CHANNELS);

function back(path: string, msg: string, kind: "ok" | "error" = "ok"): never {
  redirect(`${path}?${new URLSearchParams({ [kind]: msg })}`);
}

export async function loginAction(formData: FormData) {
  const result = await login(String(formData.get("password") ?? ""), String(formData.get("totp") ?? ""));
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
    back("/upload", "플랫폼과 CSV 파일을 선택해 주세요.", "error");
  }
  if (file.size > 10 * 1024 * 1024) back("/upload", "파일이 너무 큽니다 (10MB 이하).", "error");

  const sql = db();
  const runId = await startSyncRun(sql, channel.data, "csv_upload");
  const parsed = parseExport(channel.data, await file.text());
  if (parsed.reservations.length === 0) {
    await finishSyncRun(sql, runId, { ok: false, error: "읽을 수 있는 예약 없음" });
    back("/upload", "읽을 수 있는 예약이 없습니다. 플랫폼 선택과 파일 형식(CSV)을 확인해 주세요.", "error");
  }
  const result = await upsertReservations(sql, parsed.reservations, "csv_upload");
  await finishSyncRun(sql, runId, { ok: true, ...result });
  back("/upload", `새 예약 ${result.inserted}건, 갱신 ${result.updated}건, 건너뛴 행 ${parsed.skipped.length}개`);
}

export async function kakaoTestAction() {
  await requireOwner();
  const ok = await sendKakao(db(), "온재 숙소 관리 알림 테스트입니다.");
  back("/settings", ok ? "카카오톡으로 테스트 메시지를 보냈습니다." : "전송하지 못했습니다. 카카오 연결을 확인해 주세요.", ok ? "ok" : "error");
}

const checkinSchema = z.object({
  confirmation: z.string().trim().min(4).max(40),
  checkIn: z.iso.date(),
  lang: z.enum(["ko", "en", "zh"]).default("en"),
  consent: z.literal("yes"),
  genders: z.array(z.enum(["male", "female", "other", "undisclosed"])).min(1).max(16),
  ages: z.array(z.string()).min(1).max(16),
});

// 게스트용 공개 폼. 예약번호와 체크인 날짜가 맞아야만 저장된다.
export async function checkinAction(formData: FormData) {
  const parsed = checkinSchema.safeParse({
    confirmation: formData.get("confirmation"),
    checkIn: formData.get("checkIn"),
    lang: formData.get("lang") ?? undefined,
    consent: formData.get("consent"),
    genders: formData.getAll("gender"),
    ages: formData.getAll("age"),
  });
  const lang = String(formData.get("lang") ?? "en");
  if (!parsed.success || parsed.data.genders.length !== parsed.data.ages.length) {
    redirect(`/checkin?lang=${lang}&status=invalid`);
  }
  const { confirmation, checkIn, genders, ages } = parsed.data;
  const sql = db();
  const [reservation] = await sql<{ id: number }[]>`
    SELECT id FROM reservations
    WHERE upper(confirmation) = upper(${confirmation}) AND check_in = ${checkIn} AND status <> 'cancelled'`;
  if (!reservation) redirect(`/checkin?lang=${lang}&status=notfound`);

  await sql.begin(async (tx) => {
    await tx`DELETE FROM guest_profiles WHERE reservation_id = ${reservation.id}`;
    for (let i = 0; i < genders.length; i++) {
      const age = Number.parseInt(ages[i] ?? "", 10);
      await tx`
        INSERT INTO guest_profiles (reservation_id, gender, age, consented_at)
        VALUES (${reservation.id}, ${genders[i]}, ${Number.isFinite(age) && age >= 0 && age <= 120 ? age : null}, now())`;
    }
  });
  redirect(`/checkin?lang=${lang}&status=done`);
}
