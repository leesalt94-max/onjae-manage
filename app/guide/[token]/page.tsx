import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getGeminiKey } from "@/lib/gemini";
import { getGuideContent, getGuideToken, GUIDE_LANGS, LANG_NAMES, pickLang, UI } from "@/lib/guide-page";
import type { GuidePhotoRef } from "@/lib/guide-page";
import { GuideChat } from "./chat";

function Photo({ token, photo }: { token: string; photo: GuidePhotoRef }) {
  const src = `/guide/${token}/photo/${photo.id}`;
  return (
    <figure className="guide-fig">
      <a href={src} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={photo.caption} className="guide-photo" loading="lazy" />
      </a>
      <figcaption>{photo.caption}</figcaption>
    </figure>
  );
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function GuidePage({ params, searchParams }: Props) {
  const [{ token }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const sql = db();
  const [expected, key] = await Promise.all([getGuideToken(sql), getGeminiKey(sql)]);
  if (!expected || token !== expected) notFound();

  const lang = pickLang(typeof sp.lang === "string" ? sp.lang : undefined, h.get("accept-language"));
  const ui = UI[lang];
  const { content, translated } = await getGuideContent(sql, lang);
  // 항목에 붙지 않았거나 그 항목이 비어 있는 사진은 아래 "사진" 묶음에 모은다
  const shownKeys = new Set(content.sections.flatMap((s) => s.items.map((i) => i.key)));
  const loose = content.photos.filter((p) => !p.field || !shownKeys.has(p.field));

  return (
    <main className="guide" lang={lang}>
      <nav className="guide-langs">
        {GUIDE_LANGS.map((l) => (
          <a key={l} href={`?lang=${l}`} className={l === lang ? "on" : undefined} aria-current={l === lang ? "true" : undefined}>{LANG_NAMES[l]}</a>
        ))}
      </nav>
      <h1>{content.name || ui.title}</h1>
      {content.name && <p className="muted" style={{ marginTop: -8 }}>{ui.title}</p>}
      {!translated && <p className="notice">{ui.pending}</p>}
      {content.sections.length === 0 && content.faq.length === 0 && content.photos.length === 0 && <p>{ui.empty}</p>}

      {key && <GuideChat token={token} lang={lang} labels={ui} />}

      <details className="guide-more" open={!key}>
        <summary>{ui.more}</summary>
        {content.sections.map((s, i) => (
          <section key={i} className="panel">
            <h2>{s.title}</h2>
            <dl>
              {s.items.map((it, j) => (
                <div key={j}>
                  <dt>{it.label}</dt>
                  <dd>{it.value}</dd>
                  {content.photos.filter((p) => p.field === it.key).map((p) => <Photo key={p.id} token={token} photo={p} />)}
                </div>
              ))}
            </dl>
          </section>
        ))}
        {content.faq.length > 0 && (
          <section className="panel">
            <h2>{ui.faq}</h2>
            <dl>
              {content.faq.map((f, i) => (
                <div key={i}><dt>{f.q}</dt><dd>{f.a}</dd></div>
              ))}
            </dl>
          </section>
        )}

        {loose.length > 0 && (
          <section className="panel">
            <h2>{ui.photos}</h2>
            {loose.map((p) => <Photo key={p.id} token={token} photo={p} />)}
          </section>
        )}
      </details>
    </main>
  );
}
