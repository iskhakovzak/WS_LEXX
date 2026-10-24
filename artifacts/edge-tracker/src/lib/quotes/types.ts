/**
 * Curated quote library (src/data/quotes, ~1,800 entries in ru / en / uz / uk). Types shared by the loader, the
 * rotation, the dashboard card and the lock screen. The vocabularies mirror scripts/quotes-batch-check.mjs.
 */

export const QUOTE_CATS = ["olympus", "philosophy", "discipline", "trading", "psychology"] as const;
export type QuoteCat = (typeof QUOTE_CATS)[number];

/** Quote languages (the card's own picker; uk has quotes but no UI dictionary). */
export const QUOTE_LANGS = ["ru", "uz", "uk", "en"] as const;
export type QuoteLang = (typeof QUOTE_LANGS)[number];

export const QUOTE_TAGS = [
  "patience", "risk", "discipline", "loss", "ego", "process", "courage", "preparation", "humility", "resilience",
  "focus", "fear", "greed", "wisdom", "time", "change", "character", "learning", "action", "fate", "moderation",
  "self-knowledge", "opportunity", "responsibility", "strategy", "control", "endurance", "truth", "habit",
  "simplicity", "adaptability", "excellence",
] as const;
export type QuoteTag = (typeof QUOTE_TAGS)[number];

/** verified = the line is in the cited source, said by that speaker; attributed = traditionally ascribed. */
export type QuoteRel = "verified" | "attributed";

export interface QuoteMeta {
  id: string;
  cat: QuoteCat;
  tags: QuoteTag[];
  /** Key into the language file's `authors` — the speaker as written in the source. */
  author: string;
  /** Key into the language file's `works`. */
  work: string;
  /** Locator inside the work: «9.312-313», «DK 22 B 119», «Ep. 1.1», «ch. 5», a year… ("" = none). */
  loc: string;
  /** Original language (grc, la, en, zh…). */
  lang?: string;
  rel: QuoteRel;
  /** 1 = orig.json holds the original-language text. */
  o?: 1;
}

export interface QuoteMetaFile {
  version: number;
  quotes: QuoteMeta[];
}

/** One language file: names of speakers and works plus the texts by id. */
export interface QuoteTextFile {
  authors: Record<string, string>;
  works: Record<string, string>;
  texts: Record<string, string>;
}

/** A quote ready to show in one language. */
export interface Quote extends QuoteMeta {
  text: string;
  authorName: string;
  workName: string;
}
