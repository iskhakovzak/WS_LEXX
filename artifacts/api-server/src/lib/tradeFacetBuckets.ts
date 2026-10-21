/**
 * Bucket keys of the filter panel's numeric columns (lib/tradeFacetsSql) — ONE definition per column, used by the SQL
 * builders (bucketSql) and by the TypeScript side (bucketOf). The web mirror is edge-tracker/src/lib/trade-facets.ts;
 * the parity test (edge-tracker/src/lib/__tests__/facetBucketsParity.test.ts) runs the same fixtures through both.
 *
 *   seq     trades.day_seq (order of the trade in the trader's NY day): 1 | 2 | 3 | 4-5 | 6+
 *   hold    trades.hold_sec / trades.overnight: lt1m | 1-5m | 5-15m | 15-60m | 1-4h | gt4h | overnight
 *   price   trades.entry (entry price, $): lt5 | 5-10 | 10-20 | 20-50 | 50-100 | 100-200 | gt200
 *   size    trades.notional (max position × average entry, $): lt2k | 2-5k | 5-10k | 10-25k | 25-50k | 50-100k | gt100k
 *   result  net = pnl − |fees| (tradeMath netPnlSql): win (> 0) | loss (< 0) | be (= 0)
 *   sizeRel trades.size_rel (notional ÷ the trader's own median notional of the previous SIZE_REL_DAYS days, see
 *           lib/tradeFacetDerive sizeRelations): lt05 (< 0.5×) | normal (0.5–1.5×) | x2 (1.5–3×) | x3 (≥ 3×)
 *   stop    trades.has_stop: with | none
 * A missing / non-positive value (a negative hold, a zero price) is «unknown».
 *
 * The rule thresholds of the derived kinds (lib/tradeFacetDerive) live here too, so the web names them in its tooltips
 * with the same numbers (the parity test compares both copies).
 */
import { netPnlSql } from "./tradeMath";

export const UNKNOWN = "unknown";

export interface Bucket { key: string; before: number }

const b = (key: string, before: number): Bucket => ({ key, before });

export const SEQ_BUCKETS: readonly Bucket[] = [b("1", 2), b("2", 3), b("3", 4), b("4-5", 6), b("6+", Number.POSITIVE_INFINITY)];
export const HOLD_BUCKETS: readonly Bucket[] = [
  b("lt1m", 60), b("1-5m", 300), b("5-15m", 900), b("15-60m", 3600), b("1-4h", 14_400), b("gt4h", Number.POSITIVE_INFINITY),
];
export const OVERNIGHT_KEY = "overnight";
export const PRICE_BUCKETS: readonly Bucket[] = [
  b("lt5", 5), b("5-10", 10), b("10-20", 20), b("20-50", 50), b("50-100", 100), b("100-200", 200), b("gt200", Number.POSITIVE_INFINITY),
];
export const SIZE_BUCKETS: readonly Bucket[] = [
  b("lt2k", 2000), b("2-5k", 5000), b("5-10k", 10_000), b("10-25k", 25_000), b("25-50k", 50_000), b("50-100k", 100_000),
  b("gt100k", Number.POSITIVE_INFINITY),
];

/** Size relative to the trader's usual one (a ratio, not $ — visible to every viewer). */
export const SIZE_REL_BUCKETS: readonly Bucket[] = [b("lt05", 0.5), b("normal", 1.5), b("x2", 3), b("x3", Number.POSITIVE_INFINITY)];

/**
 * Entry «aggressive» (any one of, legs = orders, so a fill split in pieces counts once):
 *   - AGGRESSIVE_ADDS_MIN+ adds within AGGRESSIVE_WINDOW_SEC of the first fill (inclusive), or
 *   - a max position ≥ AGGRESSIVE_SIZE_MULT × the first fill's shares (with at least one add), or
 *   - AGGRESSIVE_GAP_MIN_ADDS+ adds and a median gap between consecutive opening legs under AGGRESSIVE_GAP_SEC.
 */
export const AGGRESSIVE_ADDS_MIN = 3;
export const AGGRESSIVE_WINDOW_SEC = 300;
export const AGGRESSIVE_SIZE_MULT = 3;
export const AGGRESSIVE_GAP_SEC = 60;
export const AGGRESSIVE_GAP_MIN_ADDS = 2;
/** Size relative to usual: the median notional of the trader's trades of the previous SIZE_REL_DAYS calendar days
 *  (opened before this one), at least SIZE_REL_MIN_TRADES of them — else unknown. */
export const SIZE_REL_DAYS = 60;
export const SIZE_REL_MIN_TRADES = 10;

/** Fixed orders of the enumerated columns (the panel lists them this way). */
export const PREV_KEYS = ["first", "after-win", "after-loss", "after-be"] as const;
export const ENTRY_KEYS = ["single", "scaled", "aggressive", "reentry"] as const;
export const ADDS_KEYS = ["none", "pyramid", "average", "mixed"] as const;
export const EXIT_KEYS = ["whole", "partials", "stopped", "flip"] as const;
export const STOP_KEYS = ["with", "none"] as const;
export const RESULT_KEYS = ["win", "loss", "be"] as const;
export type PrevKind = (typeof PREV_KEYS)[number];
export type EntryKind = (typeof ENTRY_KEYS)[number];
export type AddsKind = (typeof ADDS_KEYS)[number];
export type ExitKind = (typeof EXIT_KEYS)[number];
export type StopKey = (typeof STOP_KEYS)[number];
export type ResultKey = (typeof RESULT_KEYS)[number];

/** Natural order of every bucketed column (unknown last). */
export const HOLD_ORDER = [...HOLD_BUCKETS.map((x) => x.key), OVERNIGHT_KEY, UNKNOWN];

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Key of `v` in a bucket list (first `v < before`); `min` = smallest valid value (below it → unknown). */
export function bucketOf(list: readonly Bucket[], v: unknown, min: number, minInclusive: boolean): string {
  const n = toNum(v);
  if (n == null || (minInclusive ? n < min : n <= min)) return UNKNOWN;
  return list.find((x) => n < x.before)!.key;
}

export const seqKeyOf = (seq: unknown): string => bucketOf(SEQ_BUCKETS, seq, 1, true);
export const priceKeyOf = (entry: unknown): string => bucketOf(PRICE_BUCKETS, entry, 0, false);
export const sizeKeyOf = (notional: unknown): string => bucketOf(SIZE_BUCKETS, notional, 0, false);
export const sizeRelKeyOf = (ratio: unknown): string => bucketOf(SIZE_REL_BUCKETS, ratio, 0, false);
/** with | none by trades.has_stop; unknown when it was never derived. */
export function stopKeyOf(hasStop: unknown): StopKey | typeof UNKNOWN {
  return hasStop === true ? "with" : hasStop === false ? "none" : UNKNOWN;
}
export function holdKeyOf(holdSec: unknown, overnight: unknown): string {
  if (overnight === true) return OVERNIGHT_KEY;
  return bucketOf(HOLD_BUCKETS, holdSec, 0, true);
}

/** win / loss / be by the net (pnl − |fees|, rounded to 1/10000 like the numeric(14,4) columns); unknown without pnl. */
export function resultKeyOf(pnl: unknown, fees: unknown): ResultKey | typeof UNKNOWN {
  const g = toNum(pnl);
  if (g == null) return UNKNOWN;
  const net = Math.round((g - Math.abs(toNum(fees) ?? 0)) * 1e4);
  return net > 0 ? "win" : net < 0 ? "loss" : "be";
}

// ─── SQL (same lists) ───────────────────────────────────────────────────────────────────────────────────────

/** CASE expression of a bucket list over a numeric SQL expression (same rules as bucketOf). */
export function bucketSql(list: readonly Bucket[], expr: string, min: number, minInclusive: boolean): string {
  const arms = list.filter((x) => Number.isFinite(x.before)).map((x) => `WHEN ${expr} < ${x.before} THEN '${x.key}'`).join(" ");
  const last = list[list.length - 1]!.key;
  return `(CASE WHEN ${expr} IS NULL OR ${expr} ${minInclusive ? "<" : "<="} ${min} THEN '${UNKNOWN}' ${arms} ELSE '${last}' END)`;
}

export const seqSql = (a: string) => bucketSql(SEQ_BUCKETS, `${a}.day_seq`, 1, true);
export const priceSql = (a: string) => bucketSql(PRICE_BUCKETS, `${a}.entry`, 0, false);
export const sizeSql = (a: string) => bucketSql(SIZE_BUCKETS, `${a}.notional`, 0, false);
export const sizeRelSql = (a: string) => bucketSql(SIZE_REL_BUCKETS, `${a}.size_rel`, 0, false);
export const stopSql = (a: string) => `(CASE WHEN ${a}.has_stop IS TRUE THEN 'with' WHEN ${a}.has_stop IS FALSE THEN 'none' ELSE '${UNKNOWN}' END)`;
export const holdSql = (a: string) => `(CASE WHEN ${a}.overnight IS TRUE THEN '${OVERNIGHT_KEY}' ELSE ${bucketSql(HOLD_BUCKETS, `${a}.hold_sec`, 0, true)} END)`;
export function resultSql(a: string): string {
  const net = netPnlSql(a); // numeric(14,4) − numeric(14,4): exact, compared as is
  return `(CASE WHEN ${a}.pnl IS NULL THEN '${UNKNOWN}' WHEN ${net} > 0 THEN 'win' WHEN ${net} < 0 THEN 'loss' ELSE 'be' END)`;
}
