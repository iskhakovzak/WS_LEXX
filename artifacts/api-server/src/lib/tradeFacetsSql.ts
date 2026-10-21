/**
 * «Улучшенный поиск» (PropReports-style filter panel) — the facet model shared by /trades (list, days, facets) and
 * /stats/aggregate. Pure SQL builders (no DB / express imports): every value is a `$n` placeholder.
 *
 * Columns (dimensions) and the bucket key of a trade:
 *   years       LEFT(date, 4)                         months   1…12 of `date`        days   ISO weekday 1 (Mon)…7
 *   times       entry-time bucket of trades.entry_sec (NY): before 8:30 … after 16:00, «unknown» without a time
 *   strategies  trades.strategy (lib/tradeStrategy)     types    long / short (side)
 *   gtags       desk tags («Глобальные»: IMX + the mistakes vocabulary, `deskTags`)   ptags   every other tag
 * Filters panel v2 (derived columns of migration 0241, lib/tradeFacetDerive; buckets in lib/tradeFacetBuckets):
 *   seq         trades.day_seq: 1 | 2 | 3 | 4-5 | 6+      prev   trades.prev_kind: first | after-win | after-loss | after-be
 *   entry       trades.entry_kind: single | scaled | reentry          exit   trades.exit_kind: whole | partials | stopped
 *   hold        trades.hold_sec / overnight: lt1m … gt4h | overnight  tickers  UPPER(ticker)
 *   price       entry price: lt5 … gt200                              size   trades.notional: lt2k … gt100k
 *   accounts    broker_account, «manual» without one                  result win | loss | be by the net (pnl − |fees|)
 * Breakdown v3 (migration 0242): entry also «aggressive», exit also «flip», and
 *   adds        trades.adds_kind: none | pyramid | average | mixed    stop   trades.has_stop: with | none
 *   sizeRel     trades.size_rel (× the trader's usual size): lt05 | normal | x2 | x3
 * Missing values fall in «unknown»; a trade without tags of a kind is in «__none__» — so «all checked» shows every trade.
 *
 * Selection = what is UNCHECKED: `off[dim]` lists the excluded keys (absent / empty = everything checked; a new year or
 * tag is checked by default). A trade passes a scalar column when its key is not excluded, a tag column when one of its
 * tags (or «__none__» without tags) is not excluded. `excludeImx` drops strategy MOC (lib/imx) from everything.
 * Counts of one column are computed with that column's own exclusion removed (`skip`), like the PropReports panel.
 */

import { holdSql, priceSql, resultSql, seqSql, sizeRelSql, sizeSql, stopSql } from "./tradeFacetBuckets";

/** Every column, in the panel's group order (when · how · what · result and tags). */
export const FACET_DIMS = [
  "years", "months", "days", "times", "seq", "prev",
  "strategies", "types", "entry", "adds", "exit", "stop", "hold",
  "tickers", "price", "size", "sizeRel", "accounts",
  "result", "gtags", "ptags",
] as const;
export type FacetDim = (typeof FACET_DIMS)[number];

/** Query parameter of each column's exclusion list (comma-separated keys). */
export const FACET_PARAMS: Record<FacetDim, string> = {
  years: "xYears", months: "xMonths", days: "xDays", times: "xTimes",
  strategies: "xStrategies", types: "xTypes", gtags: "xGtags", ptags: "xPtags",
  seq: "xSeq", prev: "xPrev", entry: "xEntry", exit: "xExit", hold: "xHold",
  tickers: "xTickers", price: "xPrice", size: "xSize", accounts: "xAccounts", result: "xResult",
  adds: "xAdds", stop: "xStop", sizeRel: "xSizeRel",
};
export const EXCLUDE_IMX_PARAM = "excludeImx";

export const NONE_KEY = "__none__";
export const UNKNOWN_KEY = "unknown";
/** The account key of a trade without a broker account (typed in by hand). */
export const MANUAL_ACCOUNT_KEY = "manual";
/** Caps of one exclusion list (keys, characters per key); «none» on a long ticker column lists every ticker. */
export const FACET_MAX_KEYS = 1000;
export const FACET_MAX_KEY_LEN = 120;

export interface FacetFilters {
  off: Partial<Record<FacetDim, string[]>>;
  excludeImx: boolean;
  /** Desk-wide tags (exact spellings, any case) — splits «Глобальные» from «Личные». */
  deskTags: readonly string[];
}

const hm = (h: number, m: number) => h * 3600 + m * 60;
/** Entry-time buckets (same ids as the web lib/analytics-pro TIME_BUCKETS): key + upper bound (exclusive). */
export const TIME_BUCKETS: readonly { key: string; before: number }[] = [
  { key: "before-8:30", before: hm(8, 30) },
  { key: "8:30-9:30", before: hm(9, 30) },
  { key: "9:30-9:50", before: hm(9, 50) },
  { key: "9:50-10:10", before: hm(10, 10) },
  { key: "10:10-11:15", before: hm(11, 15) },
  { key: "11:15-13:30", before: hm(13, 30) },
  { key: "13:30-15:30", before: hm(15, 30) },
  { key: "15:30-16:00", before: hm(16, 0) },
  { key: "after-16:00", before: Number.POSITIVE_INFINITY },
];

/** Bucket key of an entry time (seconds since NY midnight); `unknown` for null. Mirrors the SQL below. */
export function timeBucketOf(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return UNKNOWN_KEY;
  return TIME_BUCKETS.find((b) => sec < b.before)!.key;
}

type Adder = { add(v: unknown): string };

const DATE_OK = (a: string) => `${a}.date ~ '^\\d{4}-\\d{2}-\\d{2}'`;

/** Scalar key of a trade in a non-tag column (alias `a`). */
export function facetKeySql(dim: Exclude<FacetDim, "gtags" | "ptags">, a = "t"): string {
  switch (dim) {
    case "years": return `(CASE WHEN ${DATE_OK(a)} THEN LEFT(${a}.date, 4) ELSE '${UNKNOWN_KEY}' END)`;
    case "months": return `(CASE WHEN ${DATE_OK(a)} THEN SUBSTRING(${a}.date FROM 6 FOR 2)::int::text ELSE '${UNKNOWN_KEY}' END)`;
    case "days": return `(CASE WHEN ${DATE_OK(a)} THEN EXTRACT(ISODOW FROM LEFT(${a}.date, 10)::date)::int::text ELSE '${UNKNOWN_KEY}' END)`;
    case "times": {
      const arms = TIME_BUCKETS.filter((b) => Number.isFinite(b.before)).map((b) => `WHEN ${a}.entry_sec < ${b.before} THEN '${b.key}'`).join(" ");
      return `(CASE WHEN ${a}.entry_sec IS NULL THEN '${UNKNOWN_KEY}' ${arms} ELSE 'after-16:00' END)`;
    }
    case "strategies": return `COALESCE(NULLIF(${a}.strategy, ''), '${UNKNOWN_KEY}')`;
    case "types": return `(CASE LOWER(TRIM(COALESCE(${a}.side, ''))) WHEN 'long' THEN 'long' WHEN 'short' THEN 'short' ELSE '${UNKNOWN_KEY}' END)`;
    case "seq": return seqSql(a);
    case "prev": return `COALESCE(${a}.prev_kind, '${UNKNOWN_KEY}')`;
    case "entry": return `COALESCE(${a}.entry_kind, '${UNKNOWN_KEY}')`;
    case "adds": return `COALESCE(${a}.adds_kind, '${UNKNOWN_KEY}')`;
    case "exit": return `COALESCE(${a}.exit_kind, '${UNKNOWN_KEY}')`;
    case "stop": return stopSql(a);
    case "hold": return holdSql(a);
    case "tickers": return `COALESCE(NULLIF(UPPER(TRIM(${a}.ticker)), ''), '${UNKNOWN_KEY}')`;
    case "price": return priceSql(a);
    case "size": return sizeSql(a);
    case "sizeRel": return sizeRelSql(a);
    case "accounts": return `COALESCE(NULLIF(TRIM(${a}.broker_account), ''), '${MANUAL_ACCOUNT_KEY}')`;
    case "result": return resultSql(a);
  }
}

/** The trade's tags of one kind as text[] (trimmed, non-empty); `deskP` = $n of the lower-cased desk tags. */
export function tagsSql(kind: "gtags" | "ptags", deskP: string, a = "t"): string {
  const test = kind === "gtags" ? `LOWER(x.v) = ANY(${deskP}::text[])` : `NOT (LOWER(x.v) = ANY(${deskP}::text[]))`;
  return `ARRAY(SELECT x.v FROM (SELECT TRIM(s) AS v FROM unnest(string_to_array(COALESCE(${a}.tags, ''), ',')) s) x WHERE x.v <> '' AND ${test})`;
}

export function hasFacets(f: FacetFilters | null | undefined): boolean {
  return !!f && (f.excludeImx || FACET_DIMS.some((d) => (f.off[d]?.length ?? 0) > 0));
}

/** Predicate "the trade passes column `dim`" for the exclusion list `off` (non-empty). */
function dimPredicate(dim: FacetDim, off: readonly string[], p: Adder, deskP: () => string, a: string): string {
  const offP = p.add([...off]);
  if (dim === "gtags" || dim === "ptags") {
    const arr = tagsSql(dim, deskP(), a);
    return `(EXISTS (SELECT 1 FROM unnest(${arr}) g(v) WHERE NOT (g.v = ANY(${offP}::text[])))
      OR (cardinality(${arr}) = 0 AND NOT ('${NONE_KEY}' = ANY(${offP}::text[]))))`;
  }
  return `NOT (${facetKeySql(dim, a)} = ANY(${offP}::text[]))`;
}

/** The facet predicates (AND-ed by the caller); `skip` leaves one column out (its own counts); `imx: false` keeps IMX. */
export function facetPredicates(f: FacetFilters | null | undefined, p: Adder, opts: { a?: string; skip?: FacetDim; imx?: boolean } = {}): string[] {
  if (!f) return [];
  const a = opts.a ?? "t";
  const out: string[] = [];
  if (f.excludeImx && opts.imx !== false) out.push(`COALESCE(${a}.strategy, '') <> 'MOC'`);
  let desk: string | null = null;
  const deskP = () => (desk ??= p.add(f.deskTags.map((t) => t.toLowerCase())));
  for (const dim of FACET_DIMS) {
    const off = f.off[dim];
    if (!off?.length || dim === opts.skip) continue;
    out.push(dimPredicate(dim, off, p, deskP, a));
  }
  return out;
}

/** " AND …" of the facet predicates, appended to a hand-written query's positional `params` (e.g. /stats/aggregate). */
export function facetSqlTail(f: FacetFilters | null | undefined, params: unknown[], a = "t"): string {
  const adder: Adder = { add: (v) => { params.push(v); return `$${params.length}`; } };
  const preds = facetPredicates(f, adder, { a });
  return preds.length ? ` AND ${preds.join(" AND ")}` : "";
}

// ─── Parsing ────────────────────────────────────────────────────────────────────────────────────────────────

function listOf(v: unknown): string[] {
  const s = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
  const keys = s.split(",").map((k) => k.trim()).filter((k) => k && k.length <= FACET_MAX_KEY_LEN);
  return [...new Set(keys)].slice(0, FACET_MAX_KEYS);
}

/** Facet params of a raw query (`xYears=2024,2025&excludeImx=1`…); unknown / oversized keys are dropped. */
export function parseFacetQuery(q: Record<string, unknown>, deskTags: readonly string[]): FacetFilters {
  const off: Partial<Record<FacetDim, string[]>> = {};
  for (const dim of FACET_DIMS) {
    const keys = listOf(q[FACET_PARAMS[dim]]);
    if (keys.length) off[dim] = keys;
  }
  const imx = q[EXCLUDE_IMX_PARAM];
  const excludeImx = imx === "1" || imx === "true" || imx === true;
  return { off, excludeImx, deskTags };
}
