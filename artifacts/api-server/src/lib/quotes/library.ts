/**
 * The curated quote library (src/data/quotes — layout and workflow in scripts/quotes-merge.mjs), read
 * from disk once per process and served by routes/quotes.ts. The web app no longer bundles it: the dashboard card,
 * the lock screen and the profile ask for one quote at a time.
 *
 *   meta.json         ids, categories, tags, sources (~300 KB) — loaded with the first language
 *   text.<lang>.json  texts, author and work names of one language — loaded on first use of that language
 *   orig.json         original-language texts — loaded only when someone opens an original
 *
 * Files are found next to the bundle (build.mjs copies them to dist/quotes) or in src/data/quotes (tests, tsx).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashString } from "./rotation";
import { type Quote, type QuoteLang, type QuoteMeta, type QuoteMetaFile, type QuoteTextFile } from "./types";

export function resolveQuotesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "quotes"),
    path.join(here, "..", "..", "data", "quotes"),
    path.join(here, "..", "src", "data", "quotes"),
  ];
  for (const c of candidates) if (existsSync(path.join(c, "meta.json"))) return c;
  return candidates[0]!;
}

let dir: string | null = null;
const files = new Map<string, unknown>();

function readFile<T>(name: string): T {
  const hit = files.get(name);
  if (hit !== undefined) return hit as T;
  dir ??= resolveQuotesDir();
  const value = JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8")) as T;
  files.set(name, value);
  return value;
}

export interface QuoteLibrary {
  version: number;
  lang: QuoteLang;
  quotes: readonly QuoteMeta[];
  byId: ReadonlyMap<string, QuoteMeta>;
  texts: QuoteTextFile;
}

let metaIndex: { version: number; quotes: readonly QuoteMeta[]; byId: ReadonlyMap<string, QuoteMeta> } | null = null;
const libs = new Map<QuoteLang, QuoteLibrary>();

function meta() {
  if (!metaIndex) {
    const m = readFile<QuoteMetaFile>("meta");
    metaIndex = { version: m.version, quotes: m.quotes, byId: new Map(m.quotes.map((q) => [q.id, q])) };
  }
  return metaIndex;
}

/** Every quote's meta (ids, categories, tags), without texts. */
export const quotePool = (): readonly QuoteMeta[] => meta().quotes;

/** Meta + one language, joined once per language. */
export function quoteLibrary(lang: QuoteLang): QuoteLibrary {
  const hit = libs.get(lang);
  if (hit) return hit;
  const m = meta();
  const lib: QuoteLibrary = { version: m.version, lang, quotes: m.quotes, byId: m.byId, texts: readFile<QuoteTextFile>(`text.${lang}`) };
  libs.set(lang, lib);
  return lib;
}

/** The original-language text of a quote ("" when there is none). */
export function quoteOrig(id: string): string {
  return readFile<Record<string, string>>("orig")[id] ?? "";
}

/** A quote in the library's language (null for an unknown id). */
export function quoteOf(lib: QuoteLibrary, id: string | null | undefined): Quote | null {
  const m = id ? lib.byId.get(id) : undefined;
  if (!m) return null;
  const text = lib.texts.texts[m.id];
  if (!text) return null;
  return { ...m, text, authorName: lib.texts.authors[m.author] ?? m.author, workName: lib.texts.works[m.work] ?? m.work };
}

/**
 * Quotes on a theme (a library tag), in a stable per-`seed` order (the profile's theme quote and its «another» button);
 * every quote when none carries the tag.
 */
export function themeQuoteIds(quotes: readonly { id: string; tags: readonly string[] }[], theme: string, seed: string): string[] {
  const tagged = quotes.filter((q) => q.tags.includes(theme));
  const pool = tagged.length ? tagged : quotes;
  return pool.map((q) => ({ id: q.id, k: hashString(`${seed}\u0001${q.id}`) })).sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : 1)).map((x) => x.id);
}
