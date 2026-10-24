/**
 * P1 — day-clustered and moving-block bootstrap (ALGORITHMS.md P1). Pure, seeded.
 *
 * Trades of one day share regime, mood and limits, so they are not independent: never resample trades, resample days.
 *
 *   clusterBootstrapMean(sums, counts)   mean per trade: draw D days with replacement, m* = ΣS* / ΣN*
 *   blockBootstrap(series, stat)          a statistic of a daily series: moving blocks of length b ≈ n^(1/3)
 *   blockBootstrapMean(series)            the mean of a daily series with its intervals
 *   blockDiffProb(a, b)                   P(mean(a) − mean(b) > 0) over independent block bootstraps of both
 *
 * Intervals are percentile intervals: 80% (10 / 90) for decisions, 95% for reports. B = 1000 online by default.
 */
import { quantile, sd } from "./normal";
import { randInt, type Rng } from "./rng";

export const DEFAULT_B = 1000;

export type BootSummary = {
  /** Point estimate on the original sample. */
  mean: number;
  /** Standard deviation of the bootstrap distribution. */
  se: number;
  lo80: number;
  hi80: number;
  lo95: number;
  hi95: number;
  /** Share of bootstrap estimates ≥ 0 — the one-sided p-value of «the mean is negative» (a leak). */
  pGe0: number;
  /** Share of bootstrap estimates ≤ 0 — the one-sided p-value of «the mean is positive» (a strength). */
  pLe0: number;
  B: number;
};

/** Percentile summary of bootstrap draws around the point estimate. */
export function summarize(draws: Float64Array, point: number): BootSummary {
  const sorted = Float64Array.from(draws).sort();
  let ge = 0;
  let le = 0;
  for (const v of sorted) {
    if (v >= 0) ge++;
    if (v <= 0) le++;
  }
  const B = sorted.length;
  return {
    mean: point,
    se: sd(sorted),
    lo80: quantile(sorted, 0.1),
    hi80: quantile(sorted, 0.9),
    lo95: quantile(sorted, 0.025),
    hi95: quantile(sorted, 0.975),
    pGe0: B ? ge / B : 1,
    pLe0: B ? le / B : 1,
    B,
  };
}

/**
 * Mean per trade with a day-clustered bootstrap: `sums[d]` = Σ value of day d, `counts[d]` = trades of day d.
 * Null when there is no trade.
 */
export function clusterBootstrapMean(sums: ArrayLike<number>, counts: ArrayLike<number>, rng: Rng, B = DEFAULT_B): BootSummary | null {
  const D = sums.length;
  let S = 0;
  let N = 0;
  for (let d = 0; d < D; d++) {
    S += sums[d];
    N += counts[d];
  }
  if (!D || N <= 0) return null;
  const draws = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    let n = 0;
    for (let k = 0; k < D; k++) {
      const d = randInt(rng, D);
      s += sums[d];
      n += counts[d];
    }
    // A draw of only empty days cannot happen (every listed day has ≥ 1 trade); guard anyway.
    draws[b] = n > 0 ? s / n : S / N;
  }
  return summarize(draws, S / N);
}

/** Block length of the moving-block bootstrap: round(n^(1/3)), at least 1 (5 for 120–250 days). */
export function blockLength(n: number): number {
  return Math.max(1, Math.round(Math.cbrt(Math.max(1, n))));
}

/** One moving-block resample of `series` (same length), written into `out`. */
function resampleBlocks(series: ArrayLike<number>, block: number, rng: Rng, out: Float64Array): void {
  const n = series.length;
  const b = Math.min(block, n);
  const starts = n - b + 1;
  let i = 0;
  while (i < n) {
    const s = randInt(rng, starts);
    for (let j = 0; j < b && i < n; j++, i++) out[i] = series[s + j];
  }
}

/** Bootstrap draws of `stat` over moving-block resamples of a daily series. Empty series → empty draws. */
export function blockBootstrap(
  series: ArrayLike<number>,
  stat: (xs: Float64Array) => number,
  rng: Rng,
  opts: { B?: number; block?: number } = {},
): Float64Array {
  const n = series.length;
  const B = opts.B ?? DEFAULT_B;
  if (!n) return new Float64Array(0);
  const block = opts.block ?? blockLength(n);
  const buf = new Float64Array(n);
  const draws = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    resampleBlocks(series, block, rng, buf);
    draws[b] = stat(buf);
  }
  return draws;
}

const meanOf = (xs: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : Number.NaN;
};

/** Mean of a daily series with moving-block intervals; null when empty. */
export function blockBootstrapMean(series: ArrayLike<number>, rng: Rng, opts: { B?: number; block?: number } = {}): BootSummary | null {
  if (!series.length) return null;
  return summarize(blockBootstrap(series, meanOf, rng, opts), meanOf(series));
}

/**
 * P(mean(recent) − mean(previous) > 0): independent moving-block bootstraps of both windows, paired draw by draw.
 * Null when either window is empty.
 */
export function blockDiffProb(recent: ArrayLike<number>, previous: ArrayLike<number>, rng: Rng, opts: { B?: number; block?: number } = {}): number | null {
  if (!recent.length || !previous.length) return null;
  const B = opts.B ?? DEFAULT_B;
  const a = blockBootstrap(recent, meanOf, rng, { B, block: opts.block });
  const b = blockBootstrap(previous, meanOf, rng, { B, block: opts.block });
  let up = 0;
  for (let i = 0; i < B; i++) if (a[i] - b[i] > 0) up++;
  return up / B;
}
