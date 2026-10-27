/**
 * Loader of the bundled quote library (src/data/quotes — layout and workflow in scripts/quotes-merge.mjs). Each JSON
 * file is its own lazy chunk: meta.json (ids, categories, tags, sources) + text.<lang>.json for the reader's language;
 * orig.json only when someone asks for the original. No API call: the lock screen works while the lock gate blocks
 * every data route, and the dashboard card works offline. Promises are cached for the session (a failed load is
 * retried on the next call).
 */
import { QUOTE_LANGS, type Quote, type QuoteLang, type QuoteMeta, type QuoteMetaFile, type QuoteTextFile } from "./types";

// import.meta.glob keeps every file a separate chunk and spares tsc from typing 1 MB of JSON literals.
const FILES = import.meta.glob<{ default: unknown }>("../../data/quotes/*.json");

const cache = new Map<string, Promise<unknown>>();

function loadFile<T>(name: string): Promise<T> {
  const hit = cache.get(name);
  if (hit) return hit as Promise<T>;
  const loader = FILES[`../../data/quotes/${name}.json`];
  if (!loader) return Promise.reject(new Error(`quotes: no ${name}.json`));
  const p = loader().then((m) => m.default as T);
  p.catch(() => cache.delete(name));
  cache.set(name, p);
  return p;
}

export const loadQuoteMeta = () => loadFile<QuoteMetaFile>("meta");
export const loadQuoteTexts = (lang: QuoteLang) => loadFile<QuoteTextFile>(`text.${lang}`);
export const loadQuoteOrig = () => loadFile<Record<string, string>>("orig");

export interface QuoteLibrary {
  version: number;
  lang: QuoteLang;
  quotes: readonly QuoteMeta[];
  byId: ReadonlyMap<string, QuoteMeta>;
  texts: QuoteTextFile;
}

const libs = new Map<QuoteLang, Promise<QuoteLibrary>>();

export function asQuoteLang(v: string | null | undefined): QuoteLang {
  return (QUOTE_LANGS as readonly string[]).includes(v ?? "") ? (v as QuoteLang) : "ru";
}

/** Meta + one language, joined once per language. */
export function loadQuoteLibrary(lang: QuoteLang): Promise<QuoteLibrary> {
  const hit = libs.get(lang);
  if (hit) return hit;
  const p = Promise.all([loadQuoteMeta(), loadQuoteTexts(lang)]).then(([meta, texts]) => ({
    version: meta.version,
    lang,
    quotes: meta.quotes,
    byId: new Map(meta.quotes.map((q) => [q.id, q])),
    texts,
  }));
  p.catch(() => libs.delete(lang));
  libs.set(lang, p);
  return p;
}

/** Warm the chunks (before the lock screen needs them; idle time on the dashboard). Never throws. */
export function prefetchQuoteLibrary(lang: QuoteLang): void {
  void loadQuoteLibrary(lang).catch(() => undefined);
}

/** A quote in the library's language (null for an unknown id). */
export function quoteOf(lib: QuoteLibrary, id: string | null | undefined): Quote | null {
  const m = id ? lib.byId.get(id) : undefined;
  if (!m) return null;
  const text = lib.texts.texts[m.id];
  if (!text) return null;
  return { ...m, text, authorName: lib.texts.authors[m.author] ?? m.author, workName: lib.texts.works[m.work] ?? m.work };
}

/** «Гомер, «Илиада», 9.312» — the work and the locator. */
export function citationOf(q: Pick<Quote, "workName" | "loc">): string {
  return q.loc ? `${q.workName}, ${q.loc}` : q.workName;
}

/** Quotation marks of a language: “…” in English, «…» in ru / uk / uz. */
export function quoteMarks(lang: QuoteLang): readonly [string, string] {
  return lang === "en" ? ["“", "”"] : ["«", "»"];
}

/** Plain text for the clipboard: «text» — author · source. */
export function quotePlainText(q: Quote, lang: QuoteLang): string {
  const [o, c] = quoteMarks(lang);
  return `${o}${q.text}${c}\n— ${q.authorName} · ${citationOf(q)}`;
}
