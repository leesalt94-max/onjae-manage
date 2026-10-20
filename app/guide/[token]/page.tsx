import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getGeminiKey } from "@/lib/gemini";
import { getGuideContent, getGuideToken, GUIDE_LANGS, LANG_NAMES, pickLang, UI } from "@/lib/guide-page";
import { GuideChat } from "./chat";

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
      {content.sections.length === 0 && content.faq.length === 0 && <p>{ui.empty}</p>}

      {content.sections.map((s, i) => (
        <section key={i} className="panel">
          <h2>{s.title}</h2>
          <dl>
            {s.items.map((it, j) => (
              <div key={j}><dt>{it.label}</dt><dd>{it.value}</dd></div>
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

      {key && <GuideChat token={token} lang={lang} labels={ui} />}
    </main>
  );
}
