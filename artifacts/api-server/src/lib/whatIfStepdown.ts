/**
 * Multiple-testing helpers of the honest suggestion path (lib/whatIfHonesty). Pure, no I/O, no randomness.
 *   - romanoWolf: one-sided studentized Romano–Wolf stepdown over a shared bootstrap (or permutation) null — the
 *     family-wise adjusted p value of every hypothesis (Romano & Wolf 2005; the stepdown form of White's reality check);
 *   - bhQ / byQ: Benjamini–Hochberg / Benjamini–Yekutieli q values (the «Гипотеза» tier);
 *   - normalTail: the upper normal tail, for the raw p values the FDR tier needs (an empirical p with B = 600
 *     replicates is too coarse for BH at m ≈ 72).
 */

/**
 * Adjusted p values, in input order. `tObs[j]` = observed statistic of hypothesis j; `T[j·B + b]` = its centred,
 * studentized null statistic in replicate b (−∞ = the hypothesis has no statistic in that replicate). In the order
 * of decreasing t: p̃(i) = (1 + #{b : max over l ≥ i of T(l)b ≥ t(i)}) / (B + 1) and pAdj(i) = max over l ≤ i of p̃(l).
 */
export function romanoWolf(tObs: ArrayLike<number>, T: ArrayLike<number>, m: number, B: number): Float64Array {
  const order = Array.from({ length: m }, (_, j) => j).sort((a, b) => tObs[b] - tObs[a] || a - b);
  const suf = new Float64Array(B).fill(-Infinity);
  const pTilde = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) {
    const j = order[i], row = j * B, t = tObs[j];
    let hits = 0;
    for (let b = 0; b < B; b++) {
      const v = T[row + b];
      if (v > suf[b]) suf[b] = v;
      if (suf[b] >= t) hits++;
    }
    pTilde[i] = (1 + hits) / (B + 1);
  }
  const out = new Float64Array(m);
  let run = 0;
  for (let i = 0; i < m; i++) {
    run = Math.max(run, pTilde[i]);
    out[order[i]] = run;
  }
  return out;
}

/** Benjamini–Hochberg q values, in input order: q(i) = min over k ≥ i of min(1, p(k)·m/k). */
export function bhQ(p: ArrayLike<number>): Float64Array {
  return stepUp(p, 1);
}

/** Benjamini–Yekutieli q values (any dependence): BH times c(m) = Σ 1/i. */
export function byQ(p: ArrayLike<number>): Float64Array {
  let c = 0;
  for (let i = 1; i <= p.length; i++) c += 1 / i;
  return stepUp(p, c);
}

function stepUp(p: ArrayLike<number>, c: number): Float64Array {
  const m = p.length;
  const order = Array.from({ length: m }, (_, j) => j).sort((a, b) => p[a] - p[b] || a - b);
  const out = new Float64Array(m);
  let run = 1;
  for (let i = m - 1; i >= 0; i--) {
    run = Math.min(run, Math.min(1, (p[order[i]] * m * c) / (i + 1)));
    out[order[i]] = run;
  }
  return out;
}

/** P(Z > z) for a standard normal Z: ½·erfc(z/√2), erfc by Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
export function normalTail(z: number): number {
  if (Number.isNaN(z)) return NaN;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfc = poly * Math.exp(-x * x);
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
}
