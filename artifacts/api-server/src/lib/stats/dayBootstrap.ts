/**
 * Day-clustered bootstrap (coaching primitive P1): trades of one day share regime, mood and limits, so days are
 * resampled, never trades. Each draw takes D days with replacement and returns Σnum / Σden (e.g. Σnet / Σtrades =
 * mean per trade, Σgross / Σshares = gross per share). Seeded (mulberry32): the same data gives the same bound.
 */
import { mulberry32 } from "../behaviorStats";
import { quantileSorted } from "../whatIfTypes";

/** The desk-wide default seed of every coaching bootstrap (as whatIf.pairedDayBootstrap). */
export const COACH_SEED = 20260101;

export type DayCluster = { num: number; den: number };

/**
 * The `q` quantile (0…1) of the ratio of sums over `iters` day resamples; null when fewer than 2 days or the
 * observed denominator is 0. Draws with a zero denominator are skipped.
 */
export function dayClusterQuantile(days: readonly DayCluster[], q: number, iters = 1000, seed = COACH_SEED): number | null {
  const n = days.length;
  if (n < 2 || days.reduce((s, d) => s + d.den, 0) === 0) return null;
  const rnd = mulberry32(seed);
  const out: number[] = [];
  for (let b = 0; b < iters; b++) {
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const d = days[Math.floor(rnd() * n)];
      num += d.num;
      den += d.den;
    }
    if (den !== 0) out.push(num / den);
  }
  if (!out.length) return null;
  out.sort((a, b) => a - b);
  return quantileSorted(out, q);
}
