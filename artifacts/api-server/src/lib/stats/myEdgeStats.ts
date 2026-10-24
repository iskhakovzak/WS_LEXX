/**
 * «Мой edge» statistics — pure, seeded, no DB. Names carry the `me` prefix so they never clash with the coaching
 * stats module (lib/stats/index.ts on the coach branch: rng / bootstrap / multipleTesting …).
 *
 *   meHashSeed / meRng        FNV-1a seed of a string, mulberry32 PRNG — same data ⇒ same interval on every request
 *   meDayBootstrap            day-clustered bootstrap of a bucket: resample TRADING DAYS (not trades), so a single
 *                             wild day cannot pose as many independent trades. $ / day and $ / trade, percentile
 *                             interval at `level` (0.8 by default), a two-sided bootstrap p-value of «mean ≠ 0»
 *   meResampleDays            the generic engine: B draws of any statistic over day-resamples (used by «Сравнение»)
 *   meBhQ                     Benjamini–Hochberg q values (input order) — the multiple-testing correction across rows
 *   mePersistence             the window's trading days in 3 equal chronological blocks: the bucket's sign per block
 *   meStatus                  «надёжно» (q ≤ ME_Q_RELIABLE) / «гипотеза» / «мало данных» (< ME_MIN_DAYS or < ME_MIN_TRADES)
 */

export const ME_LEVEL = 0.8;
export const ME_ITERS = 2000;
export const ME_MIN_DAYS = 5;
export const ME_MIN_TRADES = 10;
export const ME_Q_RELIABLE = 0.1;
/** A persistence block needs this many trades of the bucket to show a sign. */
export const ME_BLOCK_MIN_TRADES = 3;

/** FNV-1a 32-bit hash of a string (the bootstrap seed of a row). */
export function meHashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a deterministic 32-bit PRNG in [0, 1). */
export function meRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated quantile of an ascending array (q in [0, 1]). */
export function meQuantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return Number.NaN;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export type MeDay = { sum: number; n: number };
export type MeInterval = { point: number; lo: number; hi: number };
export type MeBoot = { perDay: MeInterval; perTrade: MeInterval; p: number; days: number; trades: number };

const round2 = (v: number) => Math.round(v * 100) / 100;

function intervalOf(draws: Float64Array, point: number, level: number): MeInterval {
  const s = Float64Array.from(draws).sort();
  const a = (1 - level) / 2;
  return { point: round2(point), lo: round2(meQuantileSorted(s, a)), hi: round2(meQuantileSorted(s, 1 - a)) };
}

/**
 * B draws of `stat` over resamples of `units` (with replacement, same size). `stat` gets the drawn indices so it
 * can read several fields without copying; a null result is skipped (the draw is repeated at most once more).
 */
export function meResampleDays<T>(units: readonly T[], stat: (pick: readonly number[], units: readonly T[]) => number | null, seed: number, iters = ME_ITERS): Float64Array {
  const out: number[] = [];
  if (!units.length) return new Float64Array(0);
  const rnd = meRng(seed);
  const pick = new Array<number>(units.length);
  for (let b = 0, guard = 0; b < iters && guard < iters * 2; guard++) {
    for (let i = 0; i < units.length; i++) pick[i] = Math.floor(rnd() * units.length);
    const v = stat(pick, units);
    if (v == null || !Number.isFinite(v)) continue;
    out.push(v);
    b++;
  }
  return Float64Array.from(out);
}

/** Interval of a draw array around a point estimate. */
export function meInterval(draws: Float64Array, point: number, level = ME_LEVEL): MeInterval | null {
  if (!draws.length || !Number.isFinite(point)) return null;
  return intervalOf(draws, point, level);
}

/** Two-sided bootstrap p-value of «the statistic ≠ 0» (+1 smoothing: never exactly 0). */
export function meBootP(draws: ArrayLike<number>): number {
  const B = draws.length;
  if (!B) return 1;
  let le = 0;
  let ge = 0;
  for (let i = 0; i < B; i++) {
    if (draws[i]! <= 0) le++;
    if (draws[i]! >= 0) ge++;
  }
  return Math.min(1, (2 * (Math.min(le, ge) + 1)) / (B + 1));
}

/** Day-clustered bootstrap of one bucket: `days` = the bucket's trading days (sum of net $, trade count). */
export function meDayBootstrap(days: readonly MeDay[], opts: { seed: number; iters?: number; level?: number }): MeBoot | null {
  const D = days.length;
  const trades = days.reduce((s, d) => s + d.n, 0);
  if (!D || !trades) return null;
  const level = opts.level ?? ME_LEVEL;
  const iters = opts.iters ?? ME_ITERS;
  const rnd = meRng(opts.seed);
  const perDay = new Float64Array(iters);
  const perTrade = new Float64Array(iters);
  for (let b = 0; b < iters; b++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < D; i++) {
      const d = days[Math.floor(rnd() * D)]!;
      s += d.sum;
      n += d.n;
    }
    perDay[b] = s / D;
    perTrade[b] = n ? s / n : 0;
  }
  const total = days.reduce((s, d) => s + d.sum, 0);
  return {
    perDay: intervalOf(perDay, total / D, level),
    perTrade: intervalOf(perTrade, total / trades, level),
    p: meBootP(perDay),
    days: D,
    trades,
  };
}

/** Benjamini–Hochberg q values in input order: q(i) = min over ranks k ≥ rank(i) of p(k)·m/k, capped at 1. */
export function meBhQ(p: readonly number[]): number[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(m);
  let run = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [v, i] = order[k]!;
    run = Math.min(run, (v * m) / (k + 1));
    q[i] = Math.min(1, run);
  }
  return q;
}

export type MeBlock = { trades: number; perTrade: number | null; sign: 1 | -1 | 0 };

/**
 * The window's trading days (ascending, all of them — not only the bucket's) cut into 3 equal chronological blocks;
 * per block the bucket's trades and $ / trade. sign 0 = fewer than ME_BLOCK_MIN_TRADES trades (no verdict).
 */
export function mePersistence(windowDays: readonly string[], bucket: ReadonlyMap<string, MeDay>, blocks = 3): MeBlock[] {
  const out: MeBlock[] = [];
  const D = windowDays.length;
  for (let b = 0; b < blocks; b++) {
    const from = Math.floor((b * D) / blocks);
    const to = Math.floor(((b + 1) * D) / blocks);
    let s = 0;
    let n = 0;
    for (let i = from; i < to; i++) {
      const d = bucket.get(windowDays[i]!);
      if (d) { s += d.sum; n += d.n; }
    }
    const perTrade = n ? round2(s / n) : null;
    const sign: 1 | -1 | 0 = n < ME_BLOCK_MIN_TRADES || perTrade == null || perTrade === 0 ? 0 : perTrade > 0 ? 1 : -1;
    out.push({ trades: n, perTrade, sign });
  }
  return out;
}

export type MeStatus = "reliable" | "hypothesis" | "low";

export function meStatus(days: number, trades: number, q: number | null): MeStatus {
  if (days < ME_MIN_DAYS || trades < ME_MIN_TRADES || q == null) return "low";
  return q <= ME_Q_RELIABLE ? "reliable" : "hypothesis";
}

/** Median of a list (NaN for an empty one). */
export function meMedian(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return meQuantileSorted(s, 0.5);
}
