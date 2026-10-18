"use client";

import bcrypt from "bcryptjs";
import { useState } from "react";

function randomBase64(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf));
}

interface Values {
  ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  ADMIN_PASSWORD_HASH: string;
}

function Row({ name, value }: { name: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel" style={{ display: "grid", gap: 6 }}>
      <strong>{name}</strong>
      <code style={{ wordBreak: "break-all" }}>{value}</code>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}

export function SetupForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [values, setValues] = useState<Values | null>(null);
  const [busy, setBusy] = useState(false);
  const error =
    password && password.length < 10 ? "10자 이상으로 정해 주세요." : confirm && confirm !== password ? "두 비밀번호가 다릅니다." : null;

  async function generate() {
    setBusy(true);
    const hash = await bcrypt.hash(password, 12);
    setValues({ ENCRYPTION_KEY: randomBase64(32), SESSION_SECRET: randomBase64(32), ADMIN_PASSWORD_HASH: hash });
    setBusy(false);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <form
        className="stack panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!error && password) void generate();
        }}
      >
        <label>
          이 사이트에 로그인할 비밀번호 (10자 이상)
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          비밀번호 한 번 더
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <span className="bad">{error}</span>}
        <button type="submit" disabled={busy || !!error || !password || confirm !== password}>
          {busy ? "만드는 중…" : "비밀값 만들기"}
        </button>
      </form>
      {values && (
        <>
          <p>
            아래 세 값을 Vercel 환경변수에 이름 그대로 넣으세요. <strong>ENCRYPTION_KEY</strong> 는 GitHub 비밀값에도 똑같이 넣어야 하니
            메모장에 잠시 적어 두세요. 이 키를 잃어버리면 저장한 플랫폼 로그인 정보를 다시 입력해야 합니다.
          </p>
          <Row name="ENCRYPTION_KEY" value={values.ENCRYPTION_KEY} />
          <Row name="SESSION_SECRET" value={values.SESSION_SECRET} />
          <Row name="ADMIN_PASSWORD_HASH" value={values.ADMIN_PASSWORD_HASH} />
        </>
      )}
    </div>
  );
}
