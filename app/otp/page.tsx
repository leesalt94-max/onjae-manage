import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { pendingOtps } from "@/lib/otp";
import { CHANNEL_LABELS } from "@/lib/types";
import { answerOtpAction } from "../actions";
import { Flash, type SearchParams } from "../flash";
import { OwnerShell } from "../nav";

export const dynamic = "force-dynamic";

export default async function OtpPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  const requests = await pendingOtps(db());
  return (
    <OwnerShell>
      <h1>인증번호 입력</h1>
      <Flash params={params} />
      {requests.length === 0 && <p className="muted">기다리는 인증 요청이 없습니다.</p>}
      {requests.map((r) => (
        <form key={r.id} action={answerOtpAction} className="stack panel">
          <strong>{CHANNEL_LABELS[r.channel]}</strong>
          <span className="muted">{r.prompt} ({r.expires_at.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })}까지)</span>
          <input type="hidden" name="id" value={r.id} />
          <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="인증번호" required autoFocus />
          <button type="submit">보내기</button>
        </form>
      ))}
    </OwnerShell>
  );
}
