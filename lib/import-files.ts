import type postgres from "postgres";
import { finishSyncRun, startSyncRun, upsertReservations, type ImportSource } from "./ingest";
import { sendKakao } from "./kakao";
import { parseExport } from "./parsers";
import { CHANNEL_LABELS, type Channel, type NormalizedReservation } from "./types";

export interface ImportResult {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
}

/** 내보내기 파일(CSV 텍스트) 여러 개를 읽어 저장하고, 수집 기록과 새 예약 카톡 알림까지 남긴다. */
export async function importFiles(
  sql: postgres.Sql, channel: Channel, files: string[], source: ImportSource,
): Promise<ImportResult> {
  const runId = await startSyncRun(sql, channel, source);
  const rows: NormalizedReservation[] = [];
  let skipped = 0;
  for (const text of files) {
    const parsed = parseExport(channel, text);
    rows.push(...parsed.reservations);
    skipped += parsed.skipped.length;
  }
  if (rows.length === 0) {
    const error = "읽을 수 있는 예약이 없습니다. 플랫폼 선택과 파일 형식을 확인해 주세요.";
    await finishSyncRun(sql, runId, { ok: false, error });
    return { ok: false, inserted: 0, updated: 0, skipped, error };
  }
  const result = await upsertReservations(sql, rows, source);
  await finishSyncRun(sql, runId, { ok: true, ...result });
  if (result.inserted > 0 && source !== "csv_upload") {
    await sendKakao(sql, `[${CHANNEL_LABELS[channel]}] 새 예약 ${result.inserted}건이 들어왔어요.`, "/reservations");
  }
  return { ok: true, ...result, skipped };
}
