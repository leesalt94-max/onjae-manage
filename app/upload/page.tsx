import { requireOwner } from "@/lib/auth";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/types";
import { uploadAction } from "../actions";
import { Flash, type SearchParams } from "../flash";
import { OwnerShell } from "../nav";

export default async function UploadPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOwner();
  const params = await searchParams;
  return (
    <OwnerShell>
      <h1>파일 올리기</h1>
      <Flash params={params} />
      <p className="muted">자동 수집이 막혔을 때 쓰는 예비 경로입니다. 같은 예약이 다시 들어와도 중복되지 않습니다.</p>
      <form action={uploadAction} className="stack panel">
        <label>
          플랫폼
          <select name="channel" required>
            {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
          </select>
        </label>
        <label>
          CSV 파일
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <button type="submit">올리기</button>
      </form>
      <div className="panel">
        <strong>어디서 받나요?</strong>
        <ul>
          <li>에어비앤비: 호스팅 &gt; 예약 &gt; 내보내기(CSV), 그리고 수입 &gt; 거래 내역 &gt; CSV 내보내기</li>
          <li>부킹닷컴: 엑스트라넷 &gt; 예약 &gt; 다운로드</li>
          <li>트립닷컴: 이부킹 &gt; 주문 &gt; 내보내기</li>
        </ul>
      </div>
    </OwnerShell>
  );
}
