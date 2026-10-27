/**
 * Trainer day rules (owner 2026-10-25: «не делай упражнения с гэпом меньше 7% в любую сторону, и должен быть указан
 * катализатор (отчёт или новость) … и капитализация компании») — pure helpers, no I/O (SQL: catalystStore.ts).
 *
 *   gap        every trainer ticker-day (free games of any level, «Задача дня», «Найди вход», swing windows) opens
 *              ≥ trainer.minGapPct (default 7) away from the previous close, up or down (isGapDay);
 *   catalyst   and has a known catalyst between the previous close and the day's close: an earnings report (Finviz
 *              earnings calendar: before the open that day, or after the previous close), a ticker news item (news
 *              feed, the desk's «Катализаторы» log, Big 7 catalysts) or an analyst rating change before the open
 *              (an upgrade / downgrade / initiation, or ≥ 3 firms moving their targets);
 *   spoilers   before the reveal the player gets a catalyst's type, timing, publisher and — only when it is safe — the
 *              headline with the ticker, the company's names, dates and years masked (maskHeadline). A headline that
 *              still names the company after masking, an item published after the open (it may describe how the day
 *              went) and any item of a ticker whose company name is unknown show no text: the client prints a generic
 *              line from the type (catalystView). The full headline, time and link come with the reveal;
 *   cap        market cap that day ≈ shares outstanding × the previous close (no future price), else the latest cap
 *              labelled «now»; bucketed (nano … mega). Mega caps show the bucket only before the reveal — a rounded
 *              $3.1T would name the company.
 */

export type CatalystKind = "earnings" | "news";
export type CatalystSource = "earnings" | "news" | "event" | "big7" | "analyst";
/** When it came out relative to the play day: after the previous close, before the open, during the session. */
export type CatalystTiming = "prevAfter" | "pre" | "session";

/** A catalyst as stored (server only: the headline and the time are real). */
export type Catalyst = {
  kind: CatalystKind;
  source: CatalystSource;
  timing: CatalystTiming | null;
  /** ISO time (news, analyst) or the date (earnings, desk log). */
  at: string | null;
  headline: string | null;
  publisher: string | null;
  url: string | null;
  analyst?: { action: string; firm: string | null; from: string | null; to: string | null; firms?: number } | null;
};

/** What the client gets. `headline` before the reveal is masked (or null → generic text from kind / source). */
export type CatalystView = {
  kind: CatalystKind;
  source: CatalystSource;
  timing: CatalystTiming | null;
  headline: string | null;
  publisher: string | null;
  analyst: { action: string; firm: string | null; from: string | null; to: string | null; firms?: number } | null;
  /** After the reveal only: the real headline, time and link. */
  full: { headline: string | null; at: string | null; url: string | null } | null;
};

export const DEFAULT_MIN_GAP_PCT = 7;

/** |gap| ≥ the threshold (up or down); a day without a known gap never qualifies. */
export function isGapDay(gapPct: number | null | undefined, minGapPct: number): boolean {
  return gapPct != null && Number.isFinite(gapPct) && Math.abs(gapPct) >= minGapPct;
}

/* ─────────────────────────── Masking ─────────────────────────── */

const MASK = "***";
const SUFFIXES = /\b(incorporated|inc|corp|corporation|company|co|ltd|limited|plc|holdings?|group|n\.?v|s\.?a|ag|se|lp|llc|class [a-c]|ordinary shares|common stock|adr|the)\b\.?/gi;
const DAY_NUM = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
/** A month (± the day number) or a weekday; «May» / «March» only next to a number (else «shares may rise»). */
const MONTHS = new RegExp(String.raw`(?:\b${DAY_NUM}\s+(?:of\s+)?)?\b(?:jan(?:uary)?|feb(?:ruary)?|apr(?:il)?|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday)\b\.?(?:\s+${DAY_NUM}\b,?)?`, "gi");
const MAY_MARCH = new RegExp(String.raw`(?:\b${DAY_NUM}\s+(?:of\s+)?(?:may|march)\b|\b(?:may|march)\s+${DAY_NUM}\b,?)`, "gi");
// i18n-ignore: Russian month names to mask in the desk's own catalyst log, not UI text.
const RU_MONTHS = /(?<!\p{L})(?:\d{1,2}\s+)?(?:январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[яй]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])(?!\p{L})/giu;
const NUM_DATE = /\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b/g;
const YEAR = /\b(19|20)\d{2}\b/g;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

/** Words a company is called by: the full name, the name without suffixes, its first word (≥ 4 letters). */
export function nameVariants(names: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = (raw ?? "").replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
    if (n.length < 3) continue;
    out.add(n);
    const core = n.replace(SUFFIXES, " ").replace(/\s+/g, " ").trim();
    if (core.length >= 3) out.add(core);
    const first = core.split(" ")[0] ?? "";
    if (first.replace(/[^\p{L}]/gu, "").length >= 4) out.add(first);
  }
  // Longest first, so «Kodiak Sciences» is masked before «Kodiak».
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * The headline with the ticker, the company's names, dates and years replaced by «***»; null when it cannot be made
 * safe (no company name known to check against, or the ticker / a name survives).
 */
export function maskHeadline(text: string | null | undefined, ticker: string, names: readonly (string | null | undefined)[]): string | null {
  if (!text) return null;
  const variants = nameVariants(names);
  if (!variants.length) return null;
  let s = decode(text);
  for (const v of variants) s = s.replace(new RegExp(`(?<![\\p{L}\\d])${esc(v)}(?:['’]s)?(?![\\p{L}\\d])`, "giu"), MASK);
  const tk = esc(ticker.toUpperCase());
  // Tickers are written in capitals; a lower-case «now» / «all» is a word, not NOW / ALL.
  s = s.replace(new RegExp(`\\$?\\b${tk}\\b`, "g"), MASK);
  s = s.replace(NUM_DATE, MASK).replace(MONTHS, MASK).replace(MAY_MARCH, MASK).replace(RU_MONTHS, MASK).replace(YEAR, MASK);
  s = s.replace(/\(\s*(?:[A-Z]+\s*:\s*)?\*\*\*\s*\)/g, "").replace(/(\*\*\*[\s,]*){2,}/g, `${MASK} `).replace(/\s+/g, " ").trim();
  if (leaks(s, ticker, variants)) return null;
  // Nothing left to read once the names are gone.
  if (s.replace(/\*\*\*/g, "").replace(/[^\p{L}]/gu, "").length < 8) return null;
  return s;
}

/** True when the ticker or a company name is still readable. */
export function leaks(s: string, ticker: string, variants: readonly string[]): boolean {
  const low = s.toLowerCase();
  if (new RegExp(`(?<![\\p{L}\\d])${esc(ticker.toUpperCase())}(?![\\p{L}\\d])`, "u").test(s)) return true;
  return variants.some((v) => v.length >= 4 && low.includes(v.toLowerCase()));
}

/* ─────────────────────────── Views ─────────────────────────── */

/**
 * Client view of one catalyst. Before the reveal: no time, no link, and a headline only when it came out before the
 * open and masks safely; earnings and analyst rows never carry text (the client builds it from kind / analyst).
 */
export function catalystView(c: Catalyst, revealed: boolean, ticker: string, names: readonly (string | null | undefined)[]): CatalystView {
  const base = { kind: c.kind, source: c.source, timing: c.timing, publisher: c.publisher, analyst: c.analyst ?? null };
  if (revealed) return { ...base, headline: c.headline ? decode(c.headline) : null, full: { headline: c.headline ? decode(c.headline) : null, at: c.at, url: c.url } };
  const textual = c.source === "news" || c.source === "event" || c.source === "big7";
  const headline = textual && c.timing !== "session" ? maskHeadline(c.headline, ticker, names) : null;
  return { ...base, headline, full: null };
}

/** Order: earnings first, then news, then analyst actions; earlier first. */
export function sortCatalysts(xs: readonly Catalyst[]): Catalyst[] {
  const rank = (c: Catalyst) => (c.kind === "earnings" ? 0 : c.source === "analyst" ? 2 : 1);
  return [...xs].sort((a, b) => rank(a) - rank(b) || String(a.at ?? "").localeCompare(String(b.at ?? "")));
}

/** Timing of an item published at `iso` for play day `day` (NY dates): before 9:30 NY that day = pre, later = session. */
export function timingOf(nyDay: string, nyMinutes: number, day: string): CatalystTiming {
  if (nyDay < day) return "prevAfter";
  return nyMinutes < 9 * 60 + 30 ? "pre" : "session";
}

/* ─────────────────────────── Market cap ─────────────────────────── */

export type CapBucket = "nano" | "micro" | "small" | "mid" | "large" | "mega";
export type CapView = {
  /** Rounded to 2 significant digits; null before the reveal for a mega cap (it would name the company). */
  usd: number | null;
  bucket: CapBucket;
  /** day = shares outstanding × the previous close; now = the latest known cap. */
  basis: "day" | "now";
};

export function capBucket(usd: number): CapBucket {
  if (usd < 50e6) return "nano";
  if (usd < 300e6) return "micro";
  if (usd < 2e9) return "small";
  if (usd < 10e9) return "mid";
  if (usd < 200e9) return "large";
  return "mega";
}

/** Two significant digits (1 234 567 890 → 1 200 000 000). */
export function round2(v: number): number {
  if (!(v > 0)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

export function capView(input: { shares: number | null; price: number | null; capNow: number | null }, revealed: boolean): CapView | null {
  const day = input.shares != null && input.shares > 0 && input.price != null && input.price > 0 ? input.shares * input.price : null;
  const usd = day ?? (input.capNow != null && input.capNow > 0 ? input.capNow : null);
  if (usd == null) return null;
  const bucket = capBucket(usd);
  return { usd: !revealed && bucket === "mega" ? null : round2(usd), bucket, basis: day != null ? "day" : "now" };
}

/** «14.59B» / «474.96M» / «5.01T» / «1 234» → a number (ticker_data_cache stores text). */
export function parseLarge(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) && s > 0 ? s : null;
  const m = /^\s*([\d.,]+)\s*([KMBT])?\s*$/i.exec(s.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const k = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B" | "T"] ?? 1;
  return n * k;
}
