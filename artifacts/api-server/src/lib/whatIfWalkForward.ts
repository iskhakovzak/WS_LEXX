/**
 * Pure pieces of the honest suggestion path (lib/whatIfHonesty), each testable on its own:
 *   Ф3 monthFolds / walkForward — expanding-window walk-forward by calendar months: everything a slot picks or
 *      thresholds is refit only on the days before month k minus a 5-trading-day embargo, then scored on month k;
 *   Ф5 withoutTopDays / familyNeighbours / fragileOf — the one-day guard and the neighbour smoothing;
 *   Ф6 needDaysFor / statusFor / decideSlot — days still needed (MDE) and «Подтверждено» / «Гипотеза» / hidden; the
 *      engine (lib/whatIfHonesty) and the Ф7 calibration (scripts/whatif-calibrate-lib) decide through decideSlot.
 * No I/O, no randomness.
 */
import { round2 } from "./whatIfTypes";

export interface WfConfig {
  /** Distinct months needed for the walk-forward to count at all. */
  minMonths: number;
  /** The first months only train (never tested). */
  warmupMonths: number;
  /** A fold counts only when its train has at least this many days. */
  minTrainDays: number;
  /** Trading days dropped between the train and the tested month. */
  embargoDays: number;
  minFolds: number;
  minTestDays: number;
  /** Share of the counted months where the rule must have helped. */
  posShare: number;
}

export interface Fold {
  month: string;
  /** 1 on the fold's train days, 0 elsewhere (index = prep.days). */
  train: Float64Array;
  /** Indices of the tested month's days. */
  test: Int32Array;
}

export interface Folds {
  /** Distinct months of the base. */
  K: number;
  /** The folds that count, in month order. */
  folds: Fold[];
  /** Days tested over the counted folds. */
  testDays: number;
  /** K ≥ minMonths, ≥ minFolds counted folds and ≥ minTestDays tested days. */
  available: boolean;
}

/** Folds over the sorted distinct days (YYYY-MM-DD): month k ≥ warmup is tested on a model fit before it. */
export function monthFolds(days: readonly string[], cfg: WfConfig): Folds {
  const months = [...new Set(days.map((d) => d.slice(0, 7)))].sort((a, b) => a.localeCompare(b));
  const folds: Fold[] = [];
  let testDays = 0;
  for (let k = cfg.warmupMonths; k < months.length; k++) {
    const first = days.findIndex((d) => d.slice(0, 7) === months[k]);
    const trainEnd = Math.max(0, first - cfg.embargoDays);
    if (trainEnd < cfg.minTrainDays) continue;
    const train = new Float64Array(days.length);
    train.fill(1, 0, trainEnd);
    const test: number[] = [];
    for (let d = first; d < days.length && days[d].slice(0, 7) === months[k]; d++) test.push(d);
    folds.push({ month: months[k], train, test: Int32Array.from(test) });
    testDays += test.length;
  }
  const available = months.length >= cfg.minMonths && folds.length >= cfg.minFolds && testDays >= cfg.minTestDays;
  return { K: months.length, folds, testDays, available };
}

export interface WfResult {
  available: boolean;
  /** Counted folds. */
  months: number;
  /** Folds where the refit rule helped (Δ > 0; a month it never touched does not count). */
  positive: number;
  /** Σ out-of-sample Δ, $. */
  sum: number;
  testDays: number;
  perMonth: { month: string; delta: number }[];
}

/** Out-of-sample result of one slot from its per-fold Δ (same order as `f.folds`). */
export function walkForward(f: Folds, deltas: readonly number[]): WfResult {
  const perMonth = f.folds.map((fold, k) => ({ month: fold.month, delta: round2(deltas[k] ?? 0) }));
  return {
    available: f.available, months: f.folds.length, positive: perMonth.filter((m) => m.delta > 0).length,
    sum: round2(perMonth.reduce((s, m) => s + m.delta, 0)), testDays: f.testDays, perMonth,
  };
}

/** Helped in ≥ posShare of the counted months and in total. */
export const wfOk = (wf: WfResult, cfg: Pick<WfConfig, "posShare">): boolean => wf.available && wf.positive >= cfg.posShare * wf.months && wf.sum > 0;

/** Δ without the `k` best days (the largest positive day differences). */
export function withoutTopDays(dayDiff: ArrayLike<number>, delta: number, k: number): number {
  const top: number[] = [];
  for (let d = 0; d < dayDiff.length; d++) {
    const v = dayDiff[d];
    if (!(v > 0)) continue;
    if (top.length < k) top.push(v);
    else {
      let lo = 0;
      for (let i = 1; i < top.length; i++) if (top[i] < top[lo]) lo = i;
      if (v > top[lo]) top[lo] = v;
    }
  }
  return round2(delta - top.reduce((s, v) => s + v, 0));
}

/**
 * Neighbours of every slot: the previous and the next member of its family present in the family (by `order`); a slot
 * without a family has none.
 */
export function familyNeighbours(slots: readonly { family: string | null; order: number }[]): number[][] {
  const out: number[][] = slots.map(() => []);
  const by = new Map<string, number[]>();
  slots.forEach((s, i) => { if (s.family != null) by.set(s.family, [...(by.get(s.family) ?? []), i]); });
  for (const members of by.values()) {
    members.sort((a, b) => slots[a].order - slots[b].order || a - b);
    members.forEach((j, i) => {
      if (i > 0) out[j].push(members[i - 1]);
      if (i < members.length - 1) out[j].push(members[i + 1]);
    });
  }
  return out;
}

export interface ConcConfig { confirmDays: number; fragileDays: number; topDays: number }

/** The grey qualifier: few affected days, else the effect sits on the best `topDays` days; null = neither. */
export function fragileOf(affectedDays: number, withoutTop: number, cfg: ConcConfig): { reason: "fewDays" | "topDays"; days: number } | null {
  if (affectedDays < cfg.fragileDays) return { reason: "fewDays", days: affectedDays };
  if (withoutTop <= 0) return { reason: "topDays", days: cfg.topDays };
  return null;
}

export interface MdeConfig { z: number; floorDays: number; maxNeedDays: number; daysPerMonth: number }

/** One leg of the evidence: the per-day effect μ and its per-day sd. */
export interface NeedLeg { mu: number; sd: number }

/**
 * Trading days still needed to tell an effect of this size from noise: MDE = z·sd·√N, so N* = ⌈(z·sd / μ)²⌉ days in
 * all; at least `floorDays` more (one more month decides it). μ is per day — out of sample when the walk-forward
 * exists (the in-sample μ of a selected rule is inflated: the winner's curse); without it the answer is «at least» and
 * also covers the months still missing for the walk-forward. Every leg the status needs must be reached, so N* is the
 * largest over the legs (the raw Δ, and the excess over the average trade or the within-day permutation excess).
 * null = some leg has μ ≤ 0: that claim has nothing to wait for, more days cannot confirm it.
 */
export function needDaysFor(
  x: { legs: readonly NeedLeg[]; D: number; K: number; wfAvailable: boolean; minMonths: number },
  cfg: MdeConfig,
): { needDays: number | null; atLeast: boolean } {
  if (!x.legs.length || x.legs.some((l) => !(l.mu > 0))) return { needDays: null, atLeast: !x.wfAvailable };
  // −1e-9: (2.8·100/10)² is 784.0000000000002 in floating point, not 785 days.
  const total = Math.max(...x.legs.map((l) => Math.ceil(((cfg.z * l.sd) / l.mu) ** 2 - 1e-9)));
  let need = Math.max(cfg.floorDays, total - x.D);
  if (!x.wfAvailable) need = Math.max(need, Math.max(0, x.minMonths - x.K) * cfg.daysPerMonth);
  return { needDays: need, atLeast: !x.wfAvailable };
}

export type HonestStatus = "confirmed" | "hypothesis" | "hidden";

/**
 * «Подтверждено» needs everything: the keep gates, enough data, an ex-ante rule (marks are set after the trade, so a
 * label rule is circular), the family-wise Romano–Wolf p ≤ α of the dollar effect AND of its guard (intersection–union:
 * the within-day permutation for an ordering claim, the excess over the average trade for any other rule — on a
 * losing trader every rule that removes trades adds dollars), the walk-forward of both and the one-day guard.
 * «Гипотеза»: the gates, the FDR tier, a non-negative out-of-sample total and — for an ex-ante rule — a reachable
 * number of days. A «разбор» (label) rule can never be confirmed, so it promises no days: q and the walk-forward
 * alone. Anything else is hidden.
 */
export function statusFor(x: {
  gates: boolean; smallSample: boolean; kind: "exante" | "label"; pAdj: number; guardAdj: number | null;
  wfOk: boolean; wfAvailable: boolean; wfSum: number; concOk: boolean; q: number; needDays: number | null;
}, cfg: { alphaConfirm: number; qHypothesis: number; maxNeedDays: number }): HonestStatus {
  const guardOk = x.guardAdj != null && x.guardAdj <= cfg.alphaConfirm;
  if (x.gates && !x.smallSample && x.kind === "exante" && x.pAdj <= cfg.alphaConfirm && guardOk && x.wfOk && x.concOk) return "confirmed";
  const reachable = x.kind === "label" || (x.needDays != null && x.needDays <= cfg.maxNeedDays);
  if (x.gates && x.q <= cfg.qHypothesis && (!x.wfAvailable || x.wfSum > 0) && reachable) return "hypothesis";
  return "hidden";
}

/** Out-of-sample summary of one leg (counted months where it helped, Σ Δ). */
export interface WfLeg { positive: number; sum: number }

/** What decideSlot needs about one slot (engine verdicts and the calibration's compact verdicts both carry it). */
export interface SlotFacts {
  kind: "exante" | "label";
  ordering: boolean;
  gates: boolean;
  /** Romano–Wolf p of the dollar effect. */
  pAdj: number;
  /** Romano–Wolf p of the guard: the within-day permutation (ordering) or the excess over the average trade; null = none. */
  guardAdj: number | null;
  q: number;
  delta: number;
  /** sd of the day differences over all days (zeros included). */
  sdDiff: number;
  wf: WfLeg;
  /** A non-ordering rule: its excess over the trader's average trade (Δ_ex, sd of its day differences, out of sample). */
  excess: { delta: number; sdDiff: number; wf: WfLeg } | null;
  /** An ordering rule: the within-day permutation t of the observed effect (centred, studentized); null = none. */
  tPerm: number | null;
  concOk: boolean;
}

export interface SlotCtx { smallSample: boolean; avail: boolean; folds: number; testDays: number; D: number; K: number }

export interface DecideConfig { alphaConfirm: number; qHypothesis: number; posShare: number; minMonths: number; mde: MdeConfig }

/**
 * Status, days still needed and the ranking metric of one slot. The metric is the out-of-sample Σ Δ when the
 * walk-forward exists (Ф3), else Δ — for a non-ordering rule the smaller of the dollar effect and its excess, so a
 * «trade less» card never outranks a real attribute effect.
 */
/**
 * The evidence legs of a slot's days-needed estimate: the dollar effect, plus the excess over the average trade (a
 * non-ordering rule) or the within-day permutation excess (an ordering rule). μ per day, out of sample when available.
 */
export function slotLegs(f: Pick<SlotFacts, "ordering" | "delta" | "sdDiff" | "wf" | "excess" | "tPerm">, c: Pick<SlotCtx, "avail" | "testDays" | "D">): NeedLeg[] {
  const mu = (w: WfLeg, delta: number) => (c.avail ? w.sum / c.testDays : delta / c.D);
  const legs: NeedLeg[] = [{ mu: mu(f.wf, f.delta), sd: f.sdDiff }];
  if (!f.ordering && f.excess) legs.push({ mu: mu(f.excess.wf, f.excess.delta), sd: f.excess.sdDiff });
  // Within-day permutation: Σ over D independent days, so per day μ = (Δ − mean)/D and sd = sd_perm/√D, i.e. t/√D in sd units.
  if (f.ordering) legs.push({ mu: f.tPerm != null ? f.tPerm / Math.sqrt(c.D) : 0, sd: 1 });
  return legs;
}

export function decideSlot(f: SlotFacts, c: SlotCtx, cfg: DecideConfig): { status: HonestStatus; needDays: number | null; atLeast: boolean; metric: number } {
  const legOk = (w: WfLeg) => c.avail && w.positive >= cfg.posShare * c.folds && w.sum > 0;
  const rawM = c.avail ? f.wf.sum : f.delta;
  const ex = f.ordering ? null : f.excess;
  const metric = ex ? Math.min(rawM, c.avail ? ex.wf.sum : ex.delta) : rawM;
  const need = f.kind === "label"
    ? { needDays: null, atLeast: false }
    : needDaysFor({ legs: slotLegs(f, c), D: c.D, K: c.K, wfAvailable: c.avail, minMonths: cfg.minMonths }, cfg.mde);
  const status = statusFor({
    gates: f.gates, smallSample: c.smallSample, kind: f.kind, pAdj: f.pAdj, guardAdj: f.guardAdj,
    wfOk: legOk(f.wf) && (!ex || legOk(ex.wf)), wfAvailable: c.avail, wfSum: Math.min(f.wf.sum, ex ? ex.wf.sum : Infinity),
    concOk: f.concOk, q: f.q, needDays: need.needDays,
  }, { alphaConfirm: cfg.alphaConfirm, qHypothesis: cfg.qHypothesis, maxNeedDays: cfg.mde.maxNeedDays });
  if (status === "confirmed" || f.kind === "label") return { status, needDays: null, atLeast: false, metric };
  return { status, needDays: need.needDays, atLeast: need.needDays != null && need.atLeast, metric };
}
