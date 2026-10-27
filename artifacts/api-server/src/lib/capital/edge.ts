/**
 * Capital allocation — the honest estimates (pure, seeded). Three inputs of the decision, each on a −1 … 1 or 0–100 scale:
 *
 *   edge        expectancy per trade in R (day-clustered bootstrap: trades of one day are not independent, lib/stats
 *               clusterBootstrapMean) and net $ per day ÷ the daily loss limit («return on the risk budget», comparable
 *               across limit sizes). Each is shrunk toward ZERO (normal–normal, lib/stats shrink) with the desk's
 *               between-trader spread τ (method of moments, lib/stats deskPrior): an edge nobody has proven yet counts as
 *               none, and a short lucky streak is pulled back hard. score = 2·P(edge > 0) − 1, averaged over R and $.
 *               «Proven» = the 80 % interval of R or $ is above zero and neither point estimate is negative; «negative» =
 *               an 80 % interval below zero.
 *   regime      the same $ estimate on the days of the current desk regime only (desk_regime_days), shrunk toward the
 *               trader's own overall estimate — «how this trader does in THIS market», not a second guess of the edge.
 *   discipline  0–100: the behaviour engine's discipline index (pattern penalties + own-contract adherence, the one index
 *               of the ladder, lib/disciplineIndex) 40 %, rule violations per traded day 20 %, share of traded days with a
 *               closed EOD 20 %, days the risk desk stopped the trader 20 % (weights renormalised over the parts known).
 */
import { STATS_SEED, clusterBootstrapMean, deskPrior, mean, rngFor, sd, shrink } from "../stats";
import type { RegimeKey } from "../marketRegime/regimes";
import type { CapDay, CapDiscipline, DisciplineScore, EdgeEstimate, Estimate, RegimeEstimate } from "./types";

const BOOT_B = 1000;
/** A bucket needs at least this many trading days to be estimated at all. */
export const MIN_DAYS = 2;
/**
 * Noise floors of the standard error (per observation): a trade's R never varies less than 1R, a day's net never less
 * than a quarter of the daily limit. Without them a handful of identical outcomes would read as a certainty.
 */
export const SE_FLOOR_R = 1;
export const SE_FLOOR_U = 0.25;
/** Prior spread when fewer than 5 traders have enough history (R per trade / daily limit share per day). */
export const FALLBACK_TAU_R = 0.25;
export const FALLBACK_TAU_U = 0.15;
/** Days of history a trader needs to enter the $ prior. */
const PRIOR_MIN_DAYS = 10;

/** Discipline parts: one violation every other traded day → 0; three stop days in the window → 0. */
export const VIOLATION_ZERO_RATE = 0.5;
export const STOP_ZERO_DAYS = 3;
const DISCIPLINE_WEIGHTS = { index: 0.4, violations: 0.2, closed: 0.2, stops: 0.2 } as const;

export type Raw = { xbar: number; se: number; n: number };
export type CapPriors = { tauR: number; tauU: number; unitsR: number; unitsU: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Expectancy per trade in R over the days that have an R (null with fewer than MIN_DAYS such days). */
export function rawR(days: readonly CapDay[], seedKey: string): Raw | null {
  const ds = days.filter((d) => d.rCount > 0);
  if (ds.length < MIN_DAYS) return null;
  const boot = clusterBootstrapMean(ds.map((d) => d.rSum), ds.map((d) => d.rCount), rngFor(STATS_SEED, seedKey, "capital-r"), BOOT_B);
  if (!boot) return null;
  const n = ds.reduce((s, d) => s + d.rCount, 0);
  return { xbar: boot.mean, se: Math.max(boot.se, SE_FLOOR_R / Math.sqrt(n)), n };
}

/** Net $ per day ÷ the daily loss limit (null without a positive limit or with fewer than MIN_DAYS days). */
export function rawU(days: readonly CapDay[], limit: number | null, seedKey: string): Raw | null {
  if (limit == null || !(limit > 0) || days.length < MIN_DAYS) return null;
  const xs = days.map((d) => d.net / limit);
  const boot = clusterBootstrapMean(xs, xs.map(() => 1), rngFor(STATS_SEED, seedKey, "capital-u"), BOOT_B);
  if (!boot) return null;
  return { xbar: boot.mean, se: Math.max(boot.se, SE_FLOOR_U / Math.sqrt(xs.length)), n: xs.length };
}

/** The desk spread τ of R and $ edges (the prior mean is not used: shrinkage goes toward zero). */
export function capitalPriors(units: readonly { r: Raw | null; u: Raw | null }[], minTrades: number): CapPriors {
  const rs = units.flatMap((x) => (x.r ? [x.r] : []));
  const us = units.flatMap((x) => (x.u ? [x.u] : []));
  const pr = deskPrior(rs, { minN: minTrades, minUnits: 5, tauMin: 0.02, fallbackMu: 0, fallbackTau: FALLBACK_TAU_R });
  const pu = deskPrior(us, { minN: PRIOR_MIN_DAYS, minUnits: 5, tauMin: 0.01, fallbackMu: 0, fallbackTau: FALLBACK_TAU_U });
  return { tauR: pr.tau, tauU: pu.tau, unitsR: pr.units, unitsU: pu.units };
}

export function posterior(raw: Raw, mu: number, tau: number): Estimate {
  const p = shrink(raw.xbar, raw.se, { mu, tau });
  return { n: raw.n, mean: raw.xbar, se: raw.se, theta: p.theta, sd: p.sdPost, lo80: p.lo80, hi80: p.hi80, pPos: 1 - p.pNeg };
}

const scoreOf = (e: Estimate | null): number | null => (e ? 2 * e.pPos - 1 : null);

export function edgeOf(days: readonly CapDay[], limit: number | null, priors: CapPriors, seedKey: string, raw?: { r: Raw | null; u: Raw | null }): EdgeEstimate {
  const rr = raw ? raw.r : rawR(days, seedKey);
  const ru = raw ? raw.u : rawU(days, limit, seedKey);
  const r = rr ? posterior(rr, 0, priors.tauR) : null;
  const u = ru ? posterior(ru, 0, priors.tauU) : null;
  const known = [r, u].filter((e): e is Estimate => e != null);
  const scores = known.map((e) => scoreOf(e) as number);
  return {
    trades: days.reduce((s, d) => s + d.trades, 0),
    days: days.length,
    r,
    u,
    score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    proven: known.length > 0 && known.some((e) => e.lo80 > 0) && known.every((e) => e.theta >= 0),
    negative: known.some((e) => e.hi80 < 0),
  };
}

/** The trader's $ edge on the days of `regime`, shrunk toward the overall $ estimate. Null without a regime. */
export function regimeEdgeOf(days: readonly CapDay[], regime: RegimeKey | null, limit: number | null, overall: Estimate | null, tauU: number): RegimeEstimate | null {
  if (!regime) return null;
  const ds = days.filter((d) => d.regime === regime);
  if (ds.length < MIN_DAYS || limit == null || !(limit > 0)) return { regime, days: ds.length, u: null, score: null };
  const xs = ds.map((d) => d.net / limit);
  const n = xs.length;
  const raw: Raw = { xbar: mean(xs), se: Math.max(sd(xs), SE_FLOOR_U) / Math.sqrt(n), n };
  const u = posterior(raw, overall?.theta ?? 0, tauU);
  return { regime, days: n, u, score: scoreOf(u) };
}

/** Discipline 0–100 from the parts that are known (null when none is). */
export function disciplineOf(d: CapDiscipline): DisciplineScore {
  const traded = d.tradedDays > 0;
  const parts = {
    index: d.index == null || !Number.isFinite(d.index) ? null : clamp(d.index, 0, 100),
    violations: traded ? clamp(100 * (1 - d.violations / d.tradedDays / VIOLATION_ZERO_RATE), 0, 100) : null,
    closed: traded ? clamp((100 * d.closedDays) / d.tradedDays, 0, 100) : null,
    stops: traded ? clamp(100 * (1 - d.stopDays / STOP_ZERO_DAYS), 0, 100) : null,
  };
  let w = 0;
  let s = 0;
  for (const k of Object.keys(DISCIPLINE_WEIGHTS) as (keyof typeof DISCIPLINE_WEIGHTS)[]) {
    const v = parts[k];
    if (v == null) continue;
    w += DISCIPLINE_WEIGHTS[k];
    s += DISCIPLINE_WEIGHTS[k] * v;
  }
  return { score: w > 0 ? s / w : null, parts };
}
