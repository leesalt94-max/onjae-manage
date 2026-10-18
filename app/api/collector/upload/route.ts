import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { importFiles } from "@/lib/import-files";
import { verifyPcToken } from "@/lib/pc-token";
import { CHANNELS } from "@/lib/types";

// 사장님 컴퓨터의 수집 프로그램(collector/local.ts)이 내보내기 파일을 보내는 곳.
// 로그인 쿠키 대신 설정 화면에서 만든 연결 코드로 확인한다.
const bodySchema = z.object({
  channel: z.enum(CHANNELS),
  files: z.array(z.string().max(5_000_000)).min(1).max(5),
});

export async function POST(req: NextRequest) {
  const sql = db();
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!(await verifyPcToken(sql, token))) {
    return NextResponse.json({ error: "연결 코드가 맞지 않습니다. 사이트 설정에서 새 코드를 만들어 주세요." }, { status: 401 });
  }
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "보낸 내용 형식이 올바르지 않습니다." }, { status: 400 });
  const result = await importFiles(sql, body.data.channel, body.data.files, "owner_pc");
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}

// 프로그램이 처음 연결 코드를 받을 때 맞는지 확인하는 용도.
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const ok = await verifyPcToken(db(), token);
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}
