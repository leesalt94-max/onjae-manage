import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { kakaoAuthorizeUrl } from "@/lib/kakao";

export async function GET() {
  await requireOwner();
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("kakao_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(kakaoAuthorizeUrl(state));
}
