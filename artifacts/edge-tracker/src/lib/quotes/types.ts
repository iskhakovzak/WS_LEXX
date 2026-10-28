/**
 * Curated quote library (~1,800 entries in ru / en / uz / uk), served by the API (api-server routes/quotes.ts; data
 * and the no-repeat rotation in api-server src/data/quotes + src/lib/quotes). Types shared by the dashboard card, the
 * lock screen and the profile. The vocabularies mirror api-server src/lib/quotes/types.ts.
 */

export const QUOTE_CATS = ["olympus", "philosophy", "discipline", "trading", "psychology"] as const;
export type QuoteCat = (typeof QUOTE_CATS)[number];

/** Quote languages (the card's own picker; uk has quotes but no UI dictionary). */
export const QUOTE_LANGS = ["ru", "uz", "uk", "en"] as const;
export type QuoteLang = (typeof QUOTE_LANGS)[number];

export type QuoteTag =
  | "patience" | "risk" | "discipline" | "loss" | "ego" | "process" | "courage" | "preparation" | "humility" | "resilience"
  | "focus" | "fear" | "greed" | "wisdom" | "time" | "change" | "character" | "learning" | "action" | "fate" | "moderation"
  | "self-knowledge" | "opportunity" | "responsibility" | "strategy" | "control" | "endurance" | "truth" | "habit"
  | "simplicity" | "adaptability" | "excellence";

/** verified = the line is in the cited source, said by that speaker; attributed = traditionally ascribed. */
export type QuoteRel = "verified" | "attributed";

/** A quote ready to show in one language (the API's answer). */
export interface Quote {
  id: string;
  cat: QuoteCat;
  tags: QuoteTag[];
  /** Key of the speaker in the library (authorName is the display name). */
  author: string;
  work: string;
  /** Locator inside the work: «9.312-313», «DK 22 B 119», «Ep. 1.1», «ch. 5», a year… ("" = none). */
  loc: string;
  /** Original language (grc, la, en, zh…). */
  lang?: string;
  rel: QuoteRel;
  /** 1 = an original-language text exists (GET /api/quotes/orig/:id). */
  o?: 1;
  text: string;
  authorName: string;
  workName: string;
}
