/**
 * Small, honest statistics for the insight tiles (components/insight-tiles): a seeded RNG, a day-clustered percentile
 * bootstrap, a confidence label and a trend versus the previous equal period. Pure, no React, no imports.
 *
 * Why days, not trades: trades of one day share the market, the mood and the plan, so they are not independent. Resampling
 * single trades would make an interval look narrower than the evidence is. Here whole trading days are drawn with
 * replacement (the same number of days as observed) and the statistic is recomputed on the trades of the drawn days.
 * The RNG is seeded, so the same data always gives the same interval (no flicker between renders or machines).
 */

/** Default interval level of the tiles: 80% — wide enough to be honest on a few weeks of trading. */
export const CI_LEVEL = 0.8;
/** Default resamples: enough for stable 10th / 90th percentiles, cheap on a few hundred trades. */
export const CI_ITERS = 600;

/** Deterministic 32-bit PRNG (mulberry32): the same seed gives the same sequence on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string hash (FNV-1a): turns a label such as «seq:4-5» into a seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Quantile of an ascending array with linear interpolation; NaN when empty. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Median of a list; null when empty. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type Interval = {
  /** The statistic on the observed data. */
  estimate: number;
  /** Lower / upper percentile of the resampled statistic. */
  lo: number;
  hi: number;
  /** Two-sided level (0.8 = the 10th…90th percentile). */
  level: number;
  /** Distinct days resampled. */
  days: number;
  /** Resamples that produced a value. */
  iters: number;
};

export type BootstrapOptions = { level?: number; iters?: number; seed?: number | string };

/**
 * Day-clustered percentile bootstrap of `stat` over `rows`. Days are drawn with replacement; the statistic is computed
 * on all rows of the drawn days. Null when the statistic is undefined on the data, fewer than two days exist, or more
 * than half of the resamples are undefined (e.g. a win-rate gap where one side often has no trades).
 */
export function dayBootstrap<T>(
  rows: readonly T[],
  dayOf: (row: T) => string,
  stat: (rows: readonly T[]) => number | null,
  opts: BootstrapOptions = {},
): Interval | null {
  const estimate = stat(rows);
  if (estimate == null || !Number.isFinite(estimate)) return null;
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const d = dayOf(r);
    const g = groups.get(d);
    if (g) g.push(r);
    else groups.set(d, [r]);
  }
  // Sorted keys: the draw order (and so the interval) does not depend on the input order.
  const days = [...groups.keys()].sort().map((k) => groups.get(k)!);
  const D = days.length;
  if (D < 2) return null;
  const level = opts.level ?? CI_LEVEL;
  const iters = opts.iters ?? CI_ITERS;
  const seed = typeof opts.seed === "string" ? hashSeed(opts.seed) : opts.seed ?? 0x5eed;
  const rnd = mulberry32(seed);
  const out: number[] = [];
  const buf: T[] = [];
  for (let b = 0; b < iters; b++) {
    buf.length = 0;
    for (let i = 0; i < D; i++) {
      const g = days[(rnd() * D) | 0];
      for (let j = 0; j < g.length; j++) buf.push(g[j]);
    }
    const v = stat(buf);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  if (out.length < iters / 2) return null;
  out.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { estimate, lo: quantileSorted(out, tail), hi: quantileSorted(out, 1 - tail), level, days: D, iters: out.length };
}

/** «надёжно» — the interval sits on the claimed side; «пока гипотеза» — it crosses; «мало данных» — under the floor. */
export type Confidence = "solid" | "hypothesis" | "low";

/**
 * Confidence of a directional claim («above» / «below» `threshold`, default 0) from its interval and sample.
 * Under `minN` observations (or `minDays` days) the answer is «low» whatever the interval says.
 */
export function confidenceOf(
  iv: Interval | null,
  claim: "above" | "below",
  sample: { n: number; minN: number; days?: number; minDays?: number; threshold?: number },
): Confidence {
  if (sample.n < sample.minN) return "low";
  if (sample.days != null && sample.minDays != null && sample.days < sample.minDays) return "low";
  if (!iv) return "low";
  const th = sample.threshold ?? 0;
  if (claim === "above") return iv.lo > th ? "solid" : "hypothesis";
  return iv.hi < th ? "solid" : "hypothesis";
}

export type Trend = {
  cur: number;
  prev: number;
  /** cur − prev. */
  delta: number;
  /** Judged by the metric's good direction; «flat» inside `flatWithin`. */
  dir: "better" | "worse" | "flat";
};

/** The metric now versus the previous equal period; null when either side is missing. */
export function trendOf(
  cur: number | null | undefined,
  prev: number | null | undefined,
  opts: { higherIsBetter?: boolean; flatWithin?: number } = {},
): Trend | null {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const delta = cur - prev;
  const flat = Math.abs(delta) <= (opts.flatWithin ?? 0);
  const up = delta > 0;
  const better = (opts.higherIsBetter ?? true) ? up : !up;
  return { cur, prev, delta, dir: flat ? "flat" : better ? "better" : "worse" };
}
