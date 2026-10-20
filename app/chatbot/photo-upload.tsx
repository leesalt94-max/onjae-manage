"use client";

import { useRef, useState } from "react";
import { addGuidePhotoAction } from "../actions";

// 휴대폰 사진은 수 MB 라서 올리기 전에 브라우저에서 긴 변 1600px JPEG 로 줄인다.
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("사진을 줄이지 못했어요.");
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}

export function PhotoUpload({ fields }: { fields: { key: string; label: string }[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="guide-fields"
      action={async (fd) => {
        setError(null);
        const file = fileRef.current?.files?.[0];
        if (!file) return setError("사진을 골라 주세요.");
        setBusy(true);
        try {
          fd.set("photo", await shrink(file));
          await addGuidePhotoAction(fd);
        } catch (e) {
          // redirect 는 예외로 전달되므로 다시 던진다
          if (e && typeof e === "object" && "digest" in e) throw e;
          setError(e instanceof Error ? e.message : "올리지 못했어요.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        <span>사진</span>
        <input ref={fileRef} type="file" accept="image/*" required />
      </label>
      <label>
        <span>설명</span>
        <input name="caption" maxLength={200} required placeholder="예: 건물 입구. 편의점 옆 파란 문" />
      </label>
      <label>
        <span>붙일 항목 (선택)</span>
        <select name="field" defaultValue="">
          <option value="">항목 없이 사진 안내에 모으기</option>
          {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      {error && <p className="bad" style={{ margin: 0 }}>{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? "올리는 중…" : "사진 올리기"}</button>
      </div>
    </form>
  );
}
