"use client";

import { useState } from "react";

// 안내문을 한 번에 복사한다. 클립보드가 막힌 브라우저에서는 글을 선택해 두어 길게 눌러 복사할 수 있게 한다.
export function CopyBox({ text, rows = 12 }: { text: string; rows?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack-wide">
      <textarea readOnly value={text} rows={rows} onFocus={(e) => e.currentTarget.select()} />
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "복사했어요" : "복사하기"}
        </button>
      </div>
    </div>
  );
}
