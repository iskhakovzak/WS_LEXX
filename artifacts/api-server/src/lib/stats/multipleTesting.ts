/**
 * P3 — multiple testing (ALGORITHMS.md P3). Pure.
 *
 *   bhQValues(p)                 Benjamini–Hochberg q values (step-up, monotone): within a trader-month across slices
 *   rejectedAt(q, alpha)         which hypotheses BH rejects at level alpha (q ≤ alpha)
 *   blocksAgreeing(values, sign) how many of the given non-overlapping blocks carry the sign (the persistence gate:
 *                                «negative in ≥ 2 of the last 3 60-trading-day blocks»)
 *
 * Rule families of the what-if keep Romano–Wolf (lib/whatIfStepdown.ts).
 */

/** Benjamini–Hochberg q values in the input order. NaN p-values are treated as 1. */
export function bhQValues(p: readonly number[]): number[] {
  const m = p.length;
  if (!m) return [];
  const clean = p.map((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1));
  const order = clean.map((_, i) => i).sort((a, b) => clean[a] - clean[b] || a - b);
  const q = new Array<number>(m);
  let run = 1;
  for (let k = m - 1; k >= 0; k--) {
    const i = order[k];
    run = Math.min(run, (clean[i] * m) / (k + 1));
    q[i] = Math.min(1, run);
  }
  return q;
}

export function rejectedAt(q: readonly number[], alpha: number): boolean[] {
  return q.map((v) => v <= alpha);
}

/**
 * Blocks whose value has the wanted sign (null / NaN = a block without data: never agrees).
 * `sign` −1 counts negative blocks, +1 positive ones.
 */
export function blocksAgreeing(values: readonly (number | null)[], sign: -1 | 1): number {
  let n = 0;
  for (const v of values) if (v != null && Number.isFinite(v) && (sign < 0 ? v < 0 : v > 0)) n++;
  return n;
}
