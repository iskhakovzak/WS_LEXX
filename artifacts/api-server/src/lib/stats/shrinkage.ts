/**
 * P2 — partial pooling toward a desk prior (normal–normal, empirical Bayes; ALGORITHMS.md P2). Pure.
 *
 *   deskPrior(units)        μ0 = precision-weighted mean of the units' x̄, τ² = max(τ²_min, var(x̄) − mean(se²)),
 *                           over units with n ≥ minN; fewer than minUnits such units → the fallback prior
 *   shrink(x̄, se, prior)    w = τ² / (τ² + se²), θ = w·x̄ + (1 − w)·μ0, sd_post = √w·se, 80% = θ ± 1.2816·sd_post,
 *                           P(θ < 0) = Φ(−θ / sd_post)
 *   winsorize(xs, k)        clip at mean ± k·SD of the pooled distribution (desk-wide, ±5 SD by default)
 *
 * Limits (tests): w → 1 as se → 0 (n → ∞), w → 0 as se → ∞. `playbookEdge.edgeScore` (μ0 = 0, a fixed 8-trade weight)
 * is the special case this replaces once the playbook moves to it.
 */
import { normCdf, Z80 } from "./normal";

export type PriorUnit = { xbar: number; se: number; n: number };

export type Prior = {
  mu: number;
  tau: number;
  /** "moments": estimated from `units` units; "fallback": too few units, the desk default is used. */
  method: "moments" | "fallback";
  units: number;
};

export type PriorOpts = {
  /** A unit enters the prior with at least this many observations (30 trades per slice). */
  minN?: number;
  /** Fewer qualifying units than this → fallback (5 traders). */
  minUnits?: number;
  /** Floor of τ (1 bps on the trade scale). */
  tauMin?: number;
  fallbackMu: number;
  fallbackTau: number;
};

/** Method-of-moments desk prior over the qualifying units. */
export function deskPrior(units: readonly PriorUnit[], opts: PriorOpts): Prior {
  const minN = opts.minN ?? 30;
  const minUnits = opts.minUnits ?? 5;
  const tauMin = opts.tauMin ?? 1;
  const ok = units.filter((u) => u.n >= minN && Number.isFinite(u.xbar) && Number.isFinite(u.se) && u.se >= 0);
  if (ok.length < minUnits) return { mu: opts.fallbackMu, tau: Math.max(tauMin, opts.fallbackTau), method: "fallback", units: ok.length };
  // Precision weights 1/se² (a unit with se = 0 would dominate: floor se at a tiny positive value).
  let wSum = 0;
  let wx = 0;
  for (const u of ok) {
    const w = 1 / Math.max(u.se, 1e-9) ** 2;
    wSum += w;
    wx += w * u.xbar;
  }
  const mu = wx / wSum;
  const m = ok.length;
  const xm = ok.reduce((s, u) => s + u.xbar, 0) / m;
  const varX = ok.reduce((s, u) => s + (u.xbar - xm) ** 2, 0) / (m - 1);
  const meanSe2 = ok.reduce((s, u) => s + u.se ** 2, 0) / m;
  const tau2 = Math.max(tauMin ** 2, varX - meanSe2);
  return { mu, tau: Math.sqrt(tau2), method: "moments", units: m };
}

export type Posterior = {
  /** Weight of the unit's own estimate (0..1). */
  w: number;
  theta: number;
  sdPost: number;
  lo80: number;
  hi80: number;
  /** P(θ < 0) under the posterior. */
  pNeg: number;
};

/** Shrink one unit's estimate toward the prior. */
export function shrink(xbar: number, se: number, prior: Pick<Prior, "mu" | "tau">): Posterior {
  const tau2 = prior.tau ** 2;
  const se2 = se ** 2;
  // se = ∞ (no information) → w = 0; se = 0 (exact) → w = 1.
  const w = !Number.isFinite(se2) ? 0 : tau2 + se2 > 0 ? tau2 / (tau2 + se2) : 1;
  const theta = w * xbar + (1 - w) * prior.mu;
  const sdPost = Number.isFinite(se2) ? Math.sqrt(w) * se : prior.tau;
  const half = Z80 * sdPost;
  return {
    w,
    theta,
    sdPost,
    lo80: theta - half,
    hi80: theta + half,
    pNeg: sdPost > 0 ? normCdf(-theta / sdPost) : theta < 0 ? 1 : 0,
  };
}

/** Clip every value at mean ± k·SD of the values (sample SD). Fewer than 3 values → unchanged copy. */
export function winsorize(xs: readonly number[], k = 5): number[] {
  if (xs.length < 3) return [...xs];
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  const s = Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
  if (!(s > 0)) return [...xs];
  const lo = m - k * s;
  const hi = m + k * s;
  return xs.map((v) => Math.min(hi, Math.max(lo, v)));
}

/** Clip bounds (mean ± k·SD) for streaming use; null when fewer than 3 values or no spread. */
export function winsorBounds(xs: readonly number[], k = 5): { lo: number; hi: number } | null {
  if (xs.length < 3) return null;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  const s = Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
  return s > 0 ? { lo: m - k * s, hi: m + k * s } : null;
}
