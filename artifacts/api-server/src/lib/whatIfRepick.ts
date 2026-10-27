/**
 * The resampling engines of the honest suggestion path (lib/whatIfHonesty), as generators that yield between
 * replicates so the async driver can give the event loop a turn. Pure and deterministic: the bootstrap draws are the
 * prepared count matrix (whatIfSuggest prepare), the permutations a seeded mulberry32.
 *   Ф4 repickBootstrap — the centred day bootstrap with every data-dependent slot REFIT inside each replicate (worst
 *      tickers / setups / tags, quantile thresholds, qualifying mistakes): the optimism of picking and checking on the
 *      same resample is in the null, as it is in the observed statistic.
 *   Ф4 the excess over the average trade — for every other (attribute) rule the same replicates also carry
 *      Δ_ex = Δ + mean · removed: what the rule adds beyond removing as many of the trader's average trades. On a
 *      losing trader any rule that removes enough trades adds dollars («trade less»); only an excess > 0 says the
 *      removed trades were worse than the rest. The mean is the replicate's own, so its noise is in the null too;
 *   Ф4 withinDayPermutation — for claims about the ORDER of trades inside a trader's day: (gross, fees) shuffled
 *      inside every trader-day, so times, attributes and day totals stay and only the order of the results changes.
 * A rule's effect on a day never depends on another day (lib/whatIfPasses), so an effect computed once on the base
 * serves every replicate: the replicate's Δ is the count-weighted sum of the base's day differences.
 */
import type { FitView, Recipe } from "./whatIfRecipes";
import { type Effect, type Prep, candidateEffect, effectDelta } from "./whatIfSuggest";
import { type Rule, type SimTrade, mulberry32, netOf, round2, traderDayKey } from "./whatIfTypes";

/** One rule's effect on the base, with its non-zero cent-rounded day differences (the bootstrap's own statistic). */
export interface MemoEffect {
  e: Effect;
  nz: Int32Array;
  vals: Float64Array;
  /** Σ vals = the observed total difference. */
  center: number;
  /** Days with removed trades (or removed size) and how much of a trade was removed on each (Effect.dayRemoved). */
  knz: Int32Array;
  kvals: Float64Array;
  /** Σ kvals: trades the rule removes (a scaled trade counts by the share removed). */
  removed: number;
}

/** Net and trade count per calendar day and the mean net per trade (the «trade less» baseline of the excess). */
export interface MeanBase {
  dayNet: Float64Array;
  dayCnt: Float64Array;
  mean: number;
}

export function meanBase(prep: Prep): MeanBase {
  const D = prep.days.length;
  const dayNet = new Float64Array(D), dayCnt = new Float64Array(D);
  for (const t of prep.base) {
    const d = prep.dayIdx.get(t.day) as number;
    dayNet[d] += netOf(t) ?? 0;
    dayCnt[d]++;
  }
  return { dayNet, dayCnt, mean: prep.n ? dayNet.reduce((s, v) => s + v, 0) / prep.n : 0 };
}

/** Mean net per trade over the days weighted by `w` (a bootstrap count row); 0 without trades. */
export function weightedMean(mb: MeanBase, w: ArrayLike<number>): number {
  let net = 0, cnt = 0;
  for (let d = 0; d < mb.dayNet.length; d++) {
    const x = w[d];
    if (x) { net += x * mb.dayNet[d]; cnt += x * mb.dayCnt[d]; }
  }
  return cnt > 0 ? net / cnt : 0;
}

/** Mean net per trade over the listed days (a tested month); 0 without trades. */
export function meanOfDays(mb: MeanBase, days: ArrayLike<number>): number {
  let net = 0, cnt = 0;
  for (let i = 0; i < days.length; i++) { net += mb.dayNet[days[i]]; cnt += mb.dayCnt[days[i]]; }
  return cnt > 0 ? net / cnt : 0;
}

/** Δ_ex = Δ + mean · removed: the effect beyond removing that many average trades. */
export const excessOf = (m: MemoEffect, mean: number): number => m.center + mean * m.removed;

/** candidateEffect memoised by rule (a refit threshold or pick set is computed once, on the base). */
export function effectMemo(prep: Prep): (rule: Rule) => MemoEffect {
  const memo = new Map<string, MemoEffect>();
  return (rule) => {
    const key = JSON.stringify(rule);
    const hit = memo.get(key);
    if (hit) return hit;
    const e = candidateEffect(prep, rule);
    const nz: number[] = [], vals: number[] = [], knz: number[] = [], kvals: number[] = [];
    let center = 0, removed = 0;
    for (let d = 0; d < e.dayDiff.length; d++) {
      if (e.dayRemoved[d] > 0) { knz.push(d); kvals.push(e.dayRemoved[d]); removed += e.dayRemoved[d]; }
      if (e.dayDiff[d] === 0) continue;
      // Same day nets as dailyResults (rounded to cents), as whatIfSuggest familyBootstrap.
      const v = round2(prep.baseDay[d] + e.dayDiff[d]) - round2(prep.baseDay[d]);
      if (v === 0) continue;
      nz.push(d); vals.push(v); center += v;
    }
    const out: MemoEffect = { e, nz: Int32Array.from(nz), vals: Float64Array.from(vals), center, knz: Int32Array.from(knz), kvals: Float64Array.from(kvals), removed };
    memo.set(key, out);
    return out;
  };
}

/** Count-weighted total of an effect in one replicate. */
function replicateSum(m: MemoEffect, counts: Uint16Array, row: number): number {
  let s = 0;
  for (let i = 0; i < m.nz.length; i++) s += counts[row + m.nz[i]] * m.vals[i];
  return s;
}

/** Count-weighted removed trades of an effect in one replicate. */
function replicateRemoved(m: MemoEffect, counts: Uint16Array, row: number): number {
  let s = 0;
  for (let i = 0; i < m.knz.length; i++) s += counts[row + m.knz[i]] * m.kvals[i];
  return s;
}

export interface Slot { recipe: Recipe; rule: Rule }

/**
 * N[j·B + b] = Δ*_b(r_jb) − Δ(r_jb): the replicate's total of the rule slot j picks ON that replicate, centred at the
 * base value of that same rule (−∞ when the slot's gate fails on the replicate). A fixed slot keeps its rule, so this
 * is exactly whatIfSuggest familyBootstrap's S − center. Nex: the same for the excess over the average trade,
 * Δ_ex*_b = Δ*_b + mean_b · removed*_b with the replicate's own mean, centred at Δ_ex(r_jb) on the base.
 */
export function* repickBootstrap(
  prep: Prep, slots: readonly Slot[], effectOf: (r: Rule) => MemoEffect, minPick: number, mb: MeanBase = meanBase(prep),
): Generator<void, { N: Float64Array; Nex: Float64Array }, void> {
  const D = prep.days.length, B = prep.iters, m = slots.length;
  const N = new Float64Array(m * B), Nex = new Float64Array(m * B);
  for (let b = 0; b < B; b++) {
    const row = b * D;
    const w = prep.counts.subarray(row, row + D);
    const view: FitView = { pick: w, all: w, minPick };
    const mean = weightedMean(mb, w);
    for (let j = 0; j < m; j++) {
      const s = slots[j];
      const rule = s.recipe.fixed ? s.rule : s.recipe.fit(view);
      if (!rule) { N[j * B + b] = -Infinity; Nex[j * B + b] = -Infinity; continue; }
      const me = effectOf(rule);
      const sum = replicateSum(me, prep.counts, row);
      N[j * B + b] = sum - me.center;
      Nex[j * B + b] = sum + mean * replicateRemoved(me, prep.counts, row) - excessOf(me, mb.mean);
    }
    yield;
  }
  return { N, Nex };
}

/** Mean and sample sd of the finite values of row j of an m × B matrix. */
export function rowStats(M: Float64Array, j: number, B: number): { mean: number; sd: number; finite: number } {
  let n = 0, mean = 0;
  for (let b = 0; b < B; b++) { const v = M[j * B + b]; if (Number.isFinite(v)) { n++; mean += v; } }
  if (n === 0) return { mean: 0, sd: 0, finite: 0 };
  mean /= n;
  let ss = 0;
  for (let b = 0; b < B; b++) { const v = M[j * B + b]; if (Number.isFinite(v)) ss += (v - mean) ** 2; }
  return { mean, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0, finite: n };
}

/** Trader-days with ≥ 2 trades: the base indices of their trades, in base order. */
function traderDayGroups(base: readonly SimTrade[]): number[][] {
  const by = new Map<string, number[]>();
  base.forEach((t, i) => {
    const k = traderDayKey(t);
    const g = by.get(k);
    if (g) g.push(i); else by.set(k, [i]);
  });
  return [...by.values()].filter((g) => g.length >= 2);
}

/**
 * Observed Δ of each rule and its Δ on P within-day permutations (obs[j], perm[j·P + π]). The permuted base keeps the
 * sort order (times, holds and attributes stay) and every trader-day total, so a day-limit threshold fitted on
 * trader-day totals is the same rule on every permutation.
 */
export function* withinDayPermutation(base: readonly SimTrade[], rules: readonly Rule[], P: number, seed: number): Generator<void, { obs: Float64Array; perm: Float64Array }, void> {
  const m = rules.length;
  const keys = rules.map((r) => JSON.stringify(r));
  const distinct = [...new Set(keys)];
  const rule = new Map(rules.map((r, j) => [keys[j], r]));
  const obsBy = new Map(distinct.map((k) => [k, effectDelta(base as SimTrade[], rule.get(k) as Rule)]));
  const obs = Float64Array.from(keys, (k) => obsBy.get(k) as number);
  const perm = new Float64Array(m * P);
  const groups = traderDayGroups(base);
  const rnd = mulberry32(seed);
  for (let p = 0; p < P; p++) {
    const shuffled = base.slice();
    for (const g of groups) {
      const pairs = g.map((i) => [base[i].gross, base[i].fees] as const);
      for (let i = pairs.length - 1; i > 0; i--) {
        const k = Math.floor(rnd() * (i + 1));
        const tmp = pairs[i]; pairs[i] = pairs[k]; pairs[k] = tmp;
      }
      g.forEach((i, k) => { shuffled[i] = { ...base[i], gross: pairs[k][0], fees: pairs[k][1] }; });
    }
    const got = new Map(distinct.map((k) => [k, effectDelta(shuffled, rule.get(k) as Rule)]));
    for (let j = 0; j < m; j++) perm[j * P + p] = got.get(keys[j]) as number;
    yield;
  }
  return { obs, perm };
}
