/**
 * Validation of the shipped quote library (src/data/quotes): unique ids, no duplicate texts, all four languages,
 * a source for every entry, length limits, known vocabularies. Authoring batches are checked earlier by
 * scripts/quotes-batch-check.mjs; this test guards what actually ships.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUOTE_CATS, QUOTE_LANGS, QUOTE_TAGS, type QuoteMetaFile, type QuoteTextFile } from "../types";
import { citationOf, loadQuoteLibrary, quoteOf, quotePlainText } from "../library";

const DIR = path.resolve(import.meta.dirname, "../../../data/quotes");
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as T;
const meta = read<QuoteMetaFile>("meta.json");
const texts = Object.fromEntries(QUOTE_LANGS.map((l) => [l, read<QuoteTextFile>(`text.${l}.json`)])) as Record<(typeof QUOTE_LANGS)[number], QuoteTextFile>;
const orig = read<Record<string, string>>("orig.json");

const CYR = /[Ѐ-ӿ]/;
const norm = (s: string) => s.toLowerCase().replace(/[«»"“”„'’ʻʼ`.,!?;:()\-—–…\s]+/g, " ").trim();
const words = (s: string) => s.trim().split(/\s+/).length;

describe("quote library dataset", () => {
  it("is large: 1,200+ entries, every category well stocked", () => {
    expect(meta.quotes.length).toBeGreaterThanOrEqual(1200);
    const by = (c: string) => meta.quotes.filter((q) => q.cat === c).length;
    expect(by("olympus")).toBeGreaterThanOrEqual(300);
    expect(by("philosophy")).toBeGreaterThanOrEqual(300);
    expect(by("trading")).toBeGreaterThanOrEqual(100);
    expect(by("psychology")).toBeGreaterThanOrEqual(100);
    expect(by("discipline")).toBeGreaterThanOrEqual(100);
  });

  it("ids are unique and well-formed", () => {
    const ids = meta.quotes.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]{2,4}-\d{3,4}$/);
  });

  it("every entry has a known category, 1-4 known tags, a reliability flag and a source", () => {
    const bad: string[] = [];
    for (const q of meta.quotes) {
      if (!(QUOTE_CATS as readonly string[]).includes(q.cat)) bad.push(`${q.id} cat`);
      if (q.tags.length < 1 || q.tags.length > 4 || q.tags.some((t) => !(QUOTE_TAGS as readonly string[]).includes(t))) bad.push(`${q.id} tags`);
      if (q.rel !== "verified" && q.rel !== "attributed") bad.push(`${q.id} rel`);
      if (typeof q.loc !== "string") bad.push(`${q.id} loc`);
      for (const l of QUOTE_LANGS) {
        if (!texts[l].works[q.work]?.trim()) bad.push(`${q.id} work ${l}`);
        if (!texts[l].authors[q.author]?.trim()) bad.push(`${q.id} author ${l}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("all four languages are present, in the right script, within the length limits", () => {
    const bad: string[] = [];
    for (const q of meta.quotes) {
      for (const l of QUOTE_LANGS) {
        const s = texts[l].texts[q.id];
        if (typeof s !== "string" || s.trim().length < 8) { bad.push(`${q.id} ${l} missing`); continue; }
        if (s.length > 320) bad.push(`${q.id} ${l} > 320 chars`);
        if ((l === "ru" || l === "uk") && !CYR.test(s)) bad.push(`${q.id} ${l} not Cyrillic`);
        if ((l === "en" || l === "uz") && CYR.test(s)) bad.push(`${q.id} ${l} has Cyrillic`);
      }
      const en = texts.en.texts[q.id] ?? "";
      if (words(en) > (q.cat === "trading" ? 25 : 60)) bad.push(`${q.id} en too long (${words(en)} words)`);
    }
    expect(bad).toEqual([]);
  });

  it("no duplicate texts in any language, no orphan texts", () => {
    for (const l of QUOTE_LANGS) {
      const seen = new Map<string, string>();
      const dups: string[] = [];
      for (const q of meta.quotes) {
        const n = norm(texts[l].texts[q.id] ?? "");
        if (seen.has(n)) dups.push(`${q.id} = ${seen.get(n)}`);
        seen.set(n, q.id);
      }
      expect(dups, l).toEqual([]);
      expect(Object.keys(texts[l].texts).length, `${l} orphans`).toBe(meta.quotes.length);
    }
    const ids = new Set(meta.quotes.map((q) => q.id));
    expect(Object.keys(orig).filter((id) => !ids.has(id))).toEqual([]);
    // The «has an original» flag matches orig.json exactly.
    expect(meta.quotes.filter((q) => (q.o === 1) !== !!orig[q.id]).map((q) => q.id)).toEqual([]);
  });

  it("Uzbek uses the modifier letters (oʻ gʻ ʼ), not ASCII apostrophes", () => {
    const ascii = meta.quotes.filter((q) => /[oOgG]['‘’`]/.test(texts.uz.texts[q.id] ?? "")).map((q) => q.id);
    expect(ascii).toEqual([]);
  });
});

describe("library loader", () => {
  it("loads meta + one language as lazy chunks and builds displayable quotes", async () => {
    const lib = await loadQuoteLibrary("ru");
    expect(lib.quotes.length).toBe(meta.quotes.length);
    const q = quoteOf(lib, meta.quotes[0]!.id)!;
    expect(q.text).toBe(texts.ru.texts[q.id]);
    expect(q.authorName).toBe(texts.ru.authors[q.author]);
    expect(citationOf(q)).toContain(q.workName);
    expect(quotePlainText(q, "ru")).toMatch(/^«.+»\n— /s);
    expect(quoteOf(lib, "nope-000")).toBeNull();
    const en = await loadQuoteLibrary("en");
    expect(quotePlainText(quoteOf(en, q.id)!, "en").startsWith("“")).toBe(true);
  });
});
