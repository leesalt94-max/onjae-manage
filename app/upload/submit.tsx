"use client";

import { useFormStatus } from "react-dom";

// 엑셀 변환·저장에 몇 초 걸릴 수 있어, 눌렀는지 알 수 있게 버튼을 바꿔 둔다.
export function UploadButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "올리는 중…" : "올리기"}</button>;
}
