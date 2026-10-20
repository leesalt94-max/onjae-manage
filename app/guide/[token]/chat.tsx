"use client";

import { useRef, useState } from "react";

function newConvId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Turn { role: "user" | "model"; text: string; photos?: string[] }
interface Labels { ask: string; placeholder: string; send: string; thinking: string; error: string; limit: string; note: string; monitored: string }

export function GuideChat({ token, lang, labels }: { token: string; lang: string; labels: Labels }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 한 번 페이지를 연 동안의 대화를 사장님 화면에서 묶어 보여 주는 용도
  const [convId] = useState(newConvId);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/guide/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, convId, lang, messages: next.slice(-12).map((t) => ({ role: t.role, text: t.text })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error(labels.limit);
      if (!res.ok || !body.answer) throw new Error(labels.error);
      setTurns([...next, { role: "model", text: body.answer, photos: Array.isArray(body.photos) ? body.photos : [] }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.error);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    }
  }

  return (
    <section className="guide-chat">
      <h2>{labels.ask}</h2>
      <div className="guide-msgs">
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "me" : "bot"}>
            <p>{t.text}</p>
            {t.photos?.map((src) => (
              <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="guide-photo" loading="lazy" />
              </a>
            ))}
          </div>
        ))}
        {busy && <div className="bot muted"><p>{labels.thinking}</p></div>}
        {error && <div className="bot bad"><p>{error}</p></div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="guide-input">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={labels.placeholder} maxLength={600} aria-label={labels.ask} />
        <button type="submit" disabled={busy || !input.trim()}>{labels.send}</button>
      </form>
      <p className="muted small">{labels.note} {labels.monitored}</p>
    </section>
  );
}
