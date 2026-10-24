/**
 * Command palette ranking (pure, no React): how well a query matches a label, which characters to highlight, the order
 * of the result groups, the query's shape (ticker / #trade id) and Tab-between-groups navigation.
 *
 * Char-level tiers (same script): exact > prefix > word start > substring > letters in order (short labels only).
 * When none hits, the cross-script matcher of @workspace/text-search (translit, keyboard-layout slips, phonetic) is
 * tried, so «hfcnth» or «zokir» still find their labels; its ranges are whole words.
 */
import { matchText, type MatchTier } from "@workspace/text-search";

export type Range = [number, number];
export type Scored = { score: number; ranges: Range[] };

export const SCORE = { exact: 1000, prefix: 800, wordStart: 600, substring: 400, words: 300, subsequence: 100 } as const;
const CROSS_SCRIPT: Record<MatchTier, number> = { exact: 260, prefix: 220, substring: 160, fuzzy: 60 };
/** Letters-in-order matching only for labels this short (titles, not notes). */
const SUBSEQ_MAX_LEN = 60;
/** Cross-script substring / fuzzy hits count from this many letters on (shorter ones are mostly noise). */
const CROSS_SCRIPT_LOOSE_MIN = 5;

// Cyrillic yo / ye by code point (the source stays free of Cyrillic literals).
const YO = String.fromCharCode(0x451);
const YE = String.fromCharCode(0x435);

/** Case- and «yo»-insensitive form; keeps the string length so ranges map back onto the original text. */
export function fold(s: string): string {
  const low = s.toLowerCase();
  // A rare char whose lower case changes the length (e.g. U+0130) would shift the ranges: fall back per char.
  const out = low.length === s.length ? low : Array.from(s, (c) => (c.toLowerCase().length === 1 ? c.toLowerCase() : c)).join("");
  return out.replaceAll(YO, YE);
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

function wordStartIndex(t: string, q: string): number {
  let i = t.indexOf(q, 1);
  while (i > 0) {
    if (!isWordChar(t[i - 1])) return i;
    i = t.indexOf(q, i + 1);
  }
  return -1;
}

/** Every query word found in the text (word starts first): the ranges of the words, or null. */
function wordsMatch(t: string, words: string[]): Range[] | null {
  const ranges: Range[] = [];
  for (const w of words) {
    let i = t.startsWith(w) ? 0 : wordStartIndex(t, w);
    if (i < 0) i = t.indexOf(w);
    if (i < 0) return null;
    ranges.push([i, i + w.length]);
  }
  return mergeRanges(ranges);
}

/** Query letters in order inside the text; consecutive letters merge into one range. */
function subsequence(t: string, q: string): Range[] | null {
  const ranges: Range[] = [];
  let at = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
    at = i + 1;
  }
  return ranges;
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * How well `query` matches `text` (higher is better) and the character ranges to highlight; null = no match.
 * `fuzzy: false` (long texts such as notes): only exact / prefix / word / substring hits.
 */
export function scoreText(query: string, text: string | null | undefined, opts: { fuzzy?: boolean } = {}): Scored | null {
  if (!text) return null;
  const q = fold(query.trim()).replace(/\s+/g, " ");
  if (!q) return null;
  const t = fold(text);
  if (t === q) return { score: SCORE.exact, ranges: [[0, text.length]] };
  if (t.startsWith(q)) return { score: SCORE.prefix - Math.min(t.length - q.length, 100), ranges: [[0, q.length]] };
  const ws = wordStartIndex(t, q);
  if (ws > 0) return { score: SCORE.wordStart - Math.min(ws, 100), ranges: [[ws, ws + q.length]] };
  const sub = t.indexOf(q);
  if (sub >= 0) return { score: SCORE.substring - Math.min(sub, 100), ranges: [[sub, sub + q.length]] };
  const words = q.split(" ").filter(Boolean);
  if (words.length > 1) {
    const r = wordsMatch(t, words);
    if (r) return { score: SCORE.words - Math.min(r[0][0], 100), ranges: r };
  }
  if (opts.fuzzy === false) return null;
  if (q.length >= 2 && text.length <= SUBSEQ_MAX_LEN) {
    const r = subsequence(t, q);
    // Too scattered (each letter far from the next) is noise, not a match.
    if (r && r.length <= Math.ceil(q.replace(/ /g, "").length / 2)) {
      const span = r[r.length - 1][1] - r[0][0];
      return { score: SCORE.subsequence + Math.round((q.length / span) * 50) - Math.min(r[0][0], 40), ranges: r };
    }
  }
  if (text.length <= SUBSEQ_MAX_LEN * 2) {
    const m = matchText(query, text);
    // Short queries only as whole / leading words: «MRK» must not hit a label through a phonetic skeleton.
    const strong = m && (m.tier === "exact" || m.tier === "prefix");
    if (m && (strong || q.replace(/ /g, "").length >= CROSS_SCRIPT_LOOSE_MIN)) return { score: CROSS_SCRIPT[m.tier], ranges: m.ranges };
  }
  return null;
}

/** A searchable text of an item; `weight` scales its score (secondary fields < 1), `fuzzy: false` for long texts. */
export type Field = string | null | undefined | { text: string | null | undefined; weight?: number; fuzzy?: boolean };
/** `field` = index of the best matching field (0 = the title, whose ranges can be highlighted). */
export type Hit<T> = { item: T; score: number; field: number; ranges: Range[] };

/** Items that match, best first (ties keep the input order); an empty query matches nothing. */
export function rankItems<T>(items: readonly T[], query: string, fields: (item: T) => Field[], limit?: number): Hit<T>[] {
  if (!query.trim()) return [];
  const hits: (Hit<T> & { order: number })[] = [];
  items.forEach((item, order) => {
    let best: Hit<T> | null = null;
    fields(item).forEach((f, i) => {
      const text = typeof f === "object" && f !== null ? f.text : f;
      const weight = typeof f === "object" && f !== null ? (f.weight ?? 1) : 1;
      const fuzzy = typeof f === "object" && f !== null ? f.fuzzy : undefined;
      const r = scoreText(query, text, { fuzzy });
      if (!r) return;
      const score = r.score * weight;
      if (!best || score > best.score) best = { item, score, field: i, ranges: r.ranges };
    });
    if (best) hits.push({ ...(best as Hit<T>), order });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  const out = hits.map(({ order: _o, ...h }) => h);
  return limit ? out.slice(0, limit) : out;
}

/** Ranges for the title only (a hit through a keyword or a second field highlights nothing). */
export const titleRanges = (h: Pick<Hit<unknown>, "field" | "ranges">): Range[] | undefined => (h.field === 0 ? h.ranges : undefined);

// ── Query shape ──

export type ParsedQuery = {
  /** Trimmed input. */
  raw: string;
  /** Lower case, without a leading `$` or `#`. */
  q: string;
  /** A ticker-shaped query (1–6 letters, dots allowed), upper-cased; null otherwise. */
  ticker: string | null;
  /** Typed as a ticker: `$nvda` or upper case `NVDA` (ranks the ticker group first). */
  tickerStrong: boolean;
  /** `#123` / `#  123`: a trade id. */
  tradeId: number | null;
};

const TICKER_RE = /^\$?[a-zA-Z][a-zA-Z.]{0,5}$/;

export function parseQuery(input: string): ParsedQuery {
  const raw = input.trim();
  const id = /^#\s*(\d{1,9})$/.exec(raw);
  const ticker = !id && TICKER_RE.test(raw) ? raw.replace(/^\$/, "").toUpperCase() : null;
  const bare = raw.replace(/^[$#]\s*/, "");
  return {
    raw,
    q: bare.toLowerCase(),
    ticker,
    tickerStrong: !!ticker && (raw.startsWith("$") || (/[A-Z]/.test(raw) && raw === raw.toUpperCase())),
    tradeId: id ? Number(id[1]) : null,
  };
}

// ── Groups ──

/** A result group: `best` = score of its top hit, `priority` = default order (lower first) for ties. */
export type GroupRank = { id: string; best: number; priority: number };

/** Groups by their best hit; within ~one tier the default order wins, so the list does not jump on every letter. */
export function orderGroups<G extends GroupRank>(groups: readonly G[], band = 150): G[] {
  const bucket = (g: G) => Math.floor(g.best / band);
  return [...groups].sort((a, b) => bucket(b) - bucket(a) || a.priority - b.priority);
}

/** Tab / Shift+Tab: the first item of the next / previous non-empty group (wraps); null when nothing to select. */
export function nextGroupValue(groups: readonly (readonly string[])[], current: string | null | undefined, dir: 1 | -1): string | null {
  const live = groups.filter((g) => g.length > 0);
  if (!live.length) return null;
  const at = current == null ? -1 : live.findIndex((g) => g.includes(current));
  if (at < 0) return (dir === 1 ? live[0] : live[live.length - 1])[0];
  return live[(at + dir + live.length) % live.length][0];
}
