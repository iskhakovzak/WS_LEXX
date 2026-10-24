/** Standard normal helpers (pure). */

/** z of the two-sided 80% interval (10th / 90th percentile). */
export const Z80 = 1.2815515655446004;
/** z of the two-sided 95% interval. */
export const Z95 = 1.959963984540054;

/** Φ(x): standard normal CDF (Abramowitz–Stegun 7.1.26 on erf, |error| < 1.5e-7). */
export function normCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Linear-interpolated quantile of an ascending array (q in [0, 1]); NaN when empty. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return Number.NaN;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function mean(xs: ArrayLike<number>): number {
  if (!xs.length) return Number.NaN;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

/** Sample standard deviation (n − 1); 0 for fewer than two values. */
export function sd(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return Number.NaN;
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}
