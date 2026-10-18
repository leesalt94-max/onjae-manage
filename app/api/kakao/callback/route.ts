import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { exchangeKakaoCode } from "@/lib/kakao";

export async function GET(req: Request) {
  await requireOwner();
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("kakao_state")?.value;
  jar.delete("kakao_state");
  const code = url.searchParams.get("code");
  const back = new URL("/settings", url);
  if (!code || !expected || url.searchParams.get("state") !== expected) {
    back.searchParams.set("error", "카카오 연결이 취소되었거나 만료되었습니다.");
    return NextResponse.redirect(back);
  }
  await exchangeKakaoCode(db(), code);
  back.searchParams.set("ok", "카카오톡이 연결되었습니다.");
  return NextResponse.redirect(back);
}
