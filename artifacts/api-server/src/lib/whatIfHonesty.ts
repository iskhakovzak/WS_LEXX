/**
 * «Что ещё дало бы больше всего» — the HONEST path: per trader, which single rules are «Подтверждено», which are a
 * «Гипотеза — нужно ещё ~N торговых дней», and which are hidden. Pure and deterministic (no I/O, no clock in the
 * result, seeded randomness); the fast path (lib/whatIfSuggest findSuggestions) stays for team scope and as the
 * «предварительно» fallback while this runs in the background.
 *   Ф3 walk-forward by months: every data-dependent choice of a slot (lib/whatIfRecipes) refit only before month k
 *      (5-day embargo) and scored on month k; slots are ranked by the summed out-of-sample Δ when it exists.
 *   Ф4 Romano–Wolf stepdown on the centred, studentized day bootstrap with the picks redone inside every replicate
 *      (lib/whatIfRepick), the BH (or BY) q tier from Gaussian raw p, and a guard on every claim (intersection–union):
 *      a within-day permutation test for claims about the order of trades inside the day, and for every other rule
 *      the excess over the trader's average trade — on a losing trader any rule that removes enough trades adds
 *      dollars, so «без тикера X» is confirmed only when the removed trades were worse than the trader's average.
 *   Ф5 one-day guard (≥ 20 affected days, Δ > 0 without the 3 best days, no lone peak among the family neighbours)
 *      and neighbour smoothing of the ranking metric.
 *   Ф6 status and the days still needed (MDE), out-of-sample μ only (the winner's curse).
 *   Ф2 every card carries its timing: «до входа» / «в сделке» / «разбор».
 * These are historical facts on the trader's own trades, not forecasts.
 */
import { runScenario } from "./whatIf";
import { type CandidateKind, type FitView, type Timing, gridRecipes, timingOf, unitWeights } from "./whatIfRecipes";
import {
  type MeanBase, type MemoEffect, type Slot, effectMemo, excessOf, meanBase, meanOfDays, repickBootstrap, rowStats, withinDayPermutation,
} from "./whatIfRepick";
import { bhQ, byQ, normalTail, romanoWolf } from "./whatIfStepdown";
import { type Prep, type Scored, familyBootstrap, passesGates, prepare, selectCards } from "./whatIfSuggest";
import { type Rule, type SimTrade, round2 } from "./whatIfTypes";
import {
  type DecideConfig, type HonestStatus, type SlotCtx, type SlotFacts, type WfResult, decideSlot, familyNeighbours, fragileOf, monthFolds,
  walkForward, withoutTopDays,
} from "./whatIfWalkForward";

/*
 * Version 3: the excess over the average trade guards every non-ordering rule (statuses, walk-forward, days needed,
 * ranking); a «разбор» card promises no days. Ф7 calibration (scripts/whatif-calibrate.ts on the synthetic desk,
 * 20 traders × 3 seeds), version 1 → 2:
 *   - wf.posShare 0.6 → 0.7: an effect that lived only in the first 40% of the months (E7) was confirmed in 15% of the
 *     runs on a zero-mean null (target ≤ 10%); 0.7 gives 7% for −1–2 points of recall on the planted effects;
 *   - mde.z 2.8 → 4.4 = c₁ + 0.84 (spec §15.4): truncated to the N* days that z = 2.8 predicts, a planted effect was
 *     confirmed in only ~20% of the runs (target ≥ 50%), because «Подтверждено» needs t ≥ c₁ ≈ 3.56, the first-step
 *     Romano–Wolf critical value, not 1.96.
 */
export const HONESTY = {
  /** Bump on ANY change to the recipes, passes, gates or these constants: it is part of the cache key. 4: wave-2 families. */
  version: 4,
  iters: 600, seed: 20260101, perms: 200, permSeed: 20260102,
  alphaConfirm: 0.1, qHypothesis: 0.2, fdrMethod: "bh" as "bh" | "by",
  wf: { minMonths: 6, warmupMonths: 2, minTrainDays: 30, embargoDays: 5, minFolds: 3, minTestDays: 20, posShare: 0.7, minPick: 7 },
  conc: { confirmDays: 20, fragileDays: 15, topDays: 3 },
  mde: { z: 4.4, floorDays: 21, maxNeedDays: 250, daysPerMonth: 21 },
  limit: 8, minTrades: 30,
} as const;

export interface HonestyOpts { iters: number; seed: number; perms: number; permSeed: number; fdrMethod: "bh" | "by"; limit: number; minTrades: number }

export { type Timing, timingOf } from "./whatIfRecipes";

type Fragile = { reason: "fewDays" | "topDays"; days: number };

/** A card as stored (numbers only; labels are rendered per request language). */
export interface HonestCard {
  recipeId: string;
  rule: Rule;
  status: "confirmed" | "hypothesis";
  kind: CandidateKind;
  timing: Timing;
  picked: boolean;
  /** Picked by its own result with no walk-forward to check it on later months. */
  sameData: boolean;
  improvement: number;
  /** Per-rule 95% interval (the scenario page's). */
  ci: { lo: number; hi: number };
  tradesLeft: number;
  excluded: number;
  changed: number;
  affected: number;
  removedNet: number;
  estimate: boolean;
  scenarioNet: number;
  scenarioWinRate: number | null;
  scenarioProfitFactor: number | null;
  /** Out of sample: Σ Δ over the tested months and in how many it helped; null without a walk-forward. */
  oos: { sum: number; months: number; positive: number; testDays: number } | null;
  needDays: number | null;
  needDaysAtLeast: boolean;
  fragile: Fragile | null;
}

/** The excess over the trader's average trade (non-ordering rules): Δ_ex = Δ + mean · removed trades. */
export interface ExcessVerdict {
  delta: number;
  se: number;
  t: number;
  pRaw: number;
  pAdj: number;
  /** sd of its day differences over all days (the days-needed leg). */
  sdDiff: number;
  /** Out of sample: each tested month's removed trades against that month's average trade. */
  wf: WfResult;
}

export interface RecipeVerdict {
  id: string;
  rule: Rule;
  kind: CandidateKind;
  picked: boolean;
  ordering: boolean;
  delta: number;
  /** Δ / days and se / days: the per-trader input of the later desk shrinkage (Ф8). */
  perDay: number;
  se: number;
  sePerDay: number;
  t: number;
  /** Raw p of the FDR tier: the larger of the dollar effect's and its guard's (intersection–union). */
  pRaw: number;
  pAdj: number;
  pPermRaw: number | null;
  pPermAdj: number | null;
  /** Within-day permutation t (ordering rules). */
  tPerm: number | null;
  excess: ExcessVerdict | null;
  q: number;
  /** sd of the day differences over all days (the days-needed leg). */
  sdDiff: number;
  wf: WfResult;
  affectedDays: number;
  withoutTop3: number;
  spike: boolean;
  smoothed: number;
  gates: boolean;
  status: HonestStatus;
}

export interface HonestyResult {
  version: number;
  n: number;
  days: number;
  months: number;
  smallSample: boolean;
  wfAvailable: boolean;
  testDays: number;
  /** Slots in the Romano–Wolf family. */
  tested: number;
  /** Ordering slots in the within-day permutation family. */
  testedOrdering: number;
  /** Among the chosen cards. */
  confirmed: number;
  hypotheses: number;
  /** ≤ limit, in display order. */
  cards: HonestCard[];
  /** Every slot of the family (calibration and debugging; never sent to the web). */
  verdicts: RecipeVerdict[];
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

function sdOf(v: ArrayLike<number>): number {
  const n = v.length;
  if (n < 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += v[i];
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (v[i] - mean) ** 2;
  return Math.sqrt(ss / (n - 1));
}

type Member = Slot & { me: MemoEffect; j: number; se: number };
type Tier = { adj: (number | null)[]; raw: (number | null)[]; t: (number | null)[]; tested: number };

/** Within-day permutation family: adjusted p, raw p and t of every ordering member (null for the others). */
function* permutationTier(base: SimTrade[], fam: Member[], o: HonestyOpts): Generator<void, Tier, void> {
  const adj: (number | null)[] = fam.map(() => null), raw: (number | null)[] = fam.map(() => null), t: (number | null)[] = fam.map(() => null);
  const ord = fam.map((_, i) => i).filter((i) => fam[i].recipe.ordering);
  if (!ord.length) return { adj, raw, t, tested: 0 };
  for (const i of ord) { adj[i] = 1; raw[i] = 1; }
  const P = o.perms;
  if (P < 2) return { adj, raw, t, tested: ord.length };
  const { obs, perm } = yield* withinDayPermutation(base, ord.map((i) => fam[i].rule), P, o.permSeed);
  // Centred and studentized by the permutation distribution of each rule (its mean is far from 0 for «trade less»).
  const live: number[] = [], tObs: number[] = [];
  const stats = ord.map((_, k) => rowStats(perm, k, P));
  ord.forEach((_, k) => { if (stats[k].sd > 0) { live.push(k); tObs.push((obs[k] - stats[k].mean) / stats[k].sd); } });
  const T = new Float64Array(live.length * P);
  live.forEach((k, li) => { for (let p = 0; p < P; p++) T[li * P + p] = (perm[k * P + p] - stats[k].mean) / stats[k].sd; });
  const pAdj = romanoWolf(tObs, T, live.length, P);
  live.forEach((k, li) => { adj[ord[k]] = pAdj[li]; raw[ord[k]] = normalTail(tObs[li]); t[ord[k]] = tObs[li]; });
  return { adj, raw, t, tested: ord.length };
}

/**
 * Excess family (every non-ordering member): the observed Δ_ex studentized by the sd of its re-pick bootstrap null,
 * Romano–Wolf over the family, Gaussian raw p (as the dollar effect's).
 */
function excessTier(fam: Member[], Nex: Float64Array, B: number, mean: number): Tier & { se: number[] } {
  const adj: (number | null)[] = fam.map(() => null), raw: (number | null)[] = fam.map(() => null), t: (number | null)[] = fam.map(() => null);
  const se = fam.map(() => 0);
  const live: number[] = [], tObs: number[] = [];
  fam.forEach((f, i) => {
    if (f.recipe.ordering) return;
    const st = rowStats(Nex, f.j, B);
    if (st.finite < 2 || !(st.sd > 0)) return;
    live.push(i);
    se[i] = st.sd;
    tObs.push(excessOf(f.me, mean) / st.sd);
  });
  const T = new Float64Array(live.length * B);
  live.forEach((i, li) => {
    for (let b = 0; b < B; b++) T[li * B + b] = Nex[fam[i].j * B + b] / se[i];
    const st = rowStats(T, li, B);
    raw[i] = normalTail(st.sd > 0 ? (tObs[li] - st.mean) / st.sd : tObs[li]);
    t[i] = tObs[li];
  });
  const pAdj = romanoWolf(tObs, T, live.length, B);
  live.forEach((i, li) => { adj[i] = pAdj[li]; });
  return { adj, raw, t, se, tested: live.length };
}

/** Σ over the tested month of the day differences, and of the excess against that month's own average trade. */
function* walkForwardDeltas(
  fam: Member[], folds: ReturnType<typeof monthFolds>, effectOf: (r: Rule) => MemoEffect, mb: MeanBase,
): Generator<void, { raw: number[][]; ex: number[][] }, void> {
  const raw = fam.map(() => new Array<number>(folds.folds.length).fill(0));
  const ex = fam.map(() => new Array<number>(folds.folds.length).fill(0));
  for (const [k, fold] of folds.folds.entries()) {
    const view: FitView = { pick: fold.train, all: fold.train, minPick: HONESTY.wf.minPick };
    const mean = meanOfDays(mb, fold.test);
    fam.forEach((f, i) => {
      const rule = f.recipe.fixed ? f.rule : f.recipe.fit(view);
      if (!rule) return;
      const e = effectOf(rule).e;
      let s = 0, removed = 0;
      for (const d of fold.test) { s += e.dayDiff[d]; removed += e.dayRemoved[d]; }
      raw[i][k] = s;
      ex[i][k] = s + mean * removed;
    });
    yield;
  }
  return { raw, ex };
}

/** The facts decideSlot reads from a verdict (and the one-day guard, which is not stored as such). */
export function slotFacts(v: RecipeVerdict, concOk: boolean): SlotFacts {
  return {
    kind: v.kind, ordering: v.ordering, gates: v.gates, pAdj: v.pAdj, guardAdj: v.ordering ? v.pPermAdj : v.excess?.pAdj ?? null, q: v.q,
    delta: v.delta, sdDiff: v.sdDiff, wf: v.wf, tPerm: v.tPerm, concOk,
    excess: v.excess ? { delta: v.excess.delta, sdDiff: v.excess.sdDiff, wf: v.excess.wf } : null,
  };
}

export const DECIDE: DecideConfig = {
  alphaConfirm: HONESTY.alphaConfirm, qHypothesis: HONESTY.qHypothesis, posShare: HONESTY.wf.posShare, minMonths: HONESTY.wf.minMonths, mde: HONESTY.mde,
};

function* honestySteps(trades: SimTrade[], o: HonestyOpts): Generator<void, HonestyResult, void> {
  const H = HONESTY;
  const prep = prepare(trades, { iters: o.iters, seed: o.seed, holdout: false });
  const D = prep.days.length, n = prep.n, B = prep.iters;
  const smallSample = D < 30 || n < 60;
  const folds = monthFolds(prep.days, H.wf);
  const head = { version: H.version, n, days: D, months: folds.K, smallSample, wfAvailable: folds.available, testDays: folds.testDays };
  const empty: HonestyResult = { ...head, tested: 0, testedOrdering: 0, confirmed: 0, hypotheses: 0, cards: [], verdicts: [] };
  if (D < 2) return empty;

  // Full-data fit of every slot.
  const { recipes } = gridRecipes(prep.base);
  const effectOf = effectMemo(prep);
  const mb = meanBase(prep);
  const ones = unitWeights(D);
  const full: FitView = { pick: ones, all: ones, minPick: 10 };
  const slots: (Slot & { me: MemoEffect })[] = [];
  for (const recipe of recipes) {
    const rule = recipe.fit(full);
    if (!rule) continue;
    const me = effectOf(rule);
    if (!me.e.skipped && me.e.excluded + me.e.changed > 0) slots.push({ recipe, rule, me });
  }
  yield;

  // Ф4: re-pick bootstrap → se, t, the family F, Romano–Wolf and the Gaussian raw p; the same for the excess.
  const { N, Nex } = yield* repickBootstrap(prep, slots, effectOf, 10, mb);
  const fam: Member[] = [];
  slots.forEach((s, j) => { const st = rowStats(N, j, B); if (st.finite >= 2 && st.sd > 0) fam.push({ ...s, j, se: st.sd }); });
  const m = fam.length;
  if (!m) return empty;
  const t = Float64Array.from(fam, (f) => f.me.center / f.se);
  const T = new Float64Array(m * B);
  const pBoot = new Float64Array(m);
  fam.forEach((f, i) => {
    for (let b = 0; b < B; b++) T[i * B + b] = N[f.j * B + b] / f.se;
    const st = rowStats(T, i, B);
    pBoot[i] = normalTail(st.sd > 0 ? (t[i] - st.mean) / st.sd : t[i]);
  });
  const pAdj = romanoWolf(t, T, m, B);
  const exc = excessTier(fam, Nex, B, mb.mean);

  // Ф3: walk-forward by months (the dollar effect and the excess against each tested month's own average trade).
  const wfd = yield* walkForwardDeltas(fam, folds, effectOf, mb);
  const wf = wfd.raw.map((d) => walkForward(folds, d));
  const wfEx = wfd.ex.map((d) => walkForward(folds, d));

  // Ф4: within-day permutation for the ordering claims; the q tier (intersection–union of each rule's raw p and its guard's).
  const perm = yield* permutationTier(prep.base, fam, o);
  const pForQ = fam.map((f, i) => Math.max(pBoot[i], (f.recipe.ordering ? perm.raw[i] : exc.raw[i]) ?? 1));
  const q = o.fdrMethod === "by" ? byQ(pForQ) : bhQ(pForQ);

  // Ф5 / Ф6: the one-day guard, then status, days still needed and the ranking metric of every slot.
  const delta = fam.map((f) => f.me.e.delta);
  const nb = familyNeighbours(fam.map((f) => f.recipe));
  const ctx: SlotCtx = { smallSample, avail: folds.available, folds: folds.folds.length, testDays: folds.testDays, D, K: folds.K };
  const verdicts: RecipeVerdict[] = [];
  const extra: { fragile: Fragile | null; needDays: number | null; atLeast: boolean }[] = [];
  const metric: number[] = [];
  fam.forEach((f, i) => {
    const e = f.me.e;
    const withoutTop3 = withoutTopDays(e.dayDiff, e.delta, H.conc.topDays);
    const spike = nb[i].length > 0 && nb[i].every((k) => delta[k] <= 0);
    const concOk = e.affectedTraderDays >= H.conc.confirmDays && withoutTop3 > 0 && !spike;
    const excess: ExcessVerdict | null = exc.adj[i] == null ? null : {
      delta: round2(excessOf(f.me, mb.mean)), se: round2(exc.se[i]), t: r4(exc.t[i] as number), pRaw: r6(exc.raw[i] as number),
      pAdj: r6(exc.adj[i] as number), sdDiff: r4(sdOf(Float64Array.from(e.dayDiff, (v, d) => v + mb.mean * e.dayRemoved[d]))), wf: wfEx[i],
    };
    const v: RecipeVerdict = {
      id: f.recipe.id, rule: f.rule, kind: f.recipe.kind, picked: f.recipe.picked, ordering: f.recipe.ordering,
      delta: e.delta, perDay: r4(e.delta / D), se: round2(f.se), sePerDay: r4(f.se / D), t: r4(t[i]),
      pRaw: r6(pForQ[i]), pAdj: r6(pAdj[i]), pPermRaw: perm.raw[i] == null ? null : r6(perm.raw[i] as number),
      pPermAdj: perm.adj[i] == null ? null : r6(perm.adj[i] as number), tPerm: perm.t[i] == null ? null : r4(perm.t[i] as number),
      excess, q: r6(q[i]), sdDiff: r4(sdOf(e.dayDiff)), wf: wf[i],
      affectedDays: e.affectedTraderDays, withoutTop3, spike, smoothed: 0, gates: passesGates(e, f.recipe.picked, n, o.minTrades), status: "hidden",
    };
    const d = decideSlot(slotFacts(v, concOk), ctx, DECIDE);
    v.status = d.status;
    metric.push(d.metric);
    extra.push({ fragile: fragileOf(e.affectedTraderDays, withoutTop3, H.conc), needDays: d.needDays, atLeast: d.atLeast });
    verdicts.push(v);
  });
  // Neighbour smoothing of the ranking metric (families with an order only).
  fam.forEach((f, i) => {
    const sm = f.recipe.family == null ? metric[i] : [i, ...nb[i]].reduce((s, k) => s + metric[k], 0) / (nb[i].length + 1);
    verdicts[i].smoothed = round2(sm);
  });
  yield;

  const cards = chooseCards(trades, prep, fam, verdicts, extra, o);
  return {
    ...head, tested: m, testedOrdering: perm.tested, cards, verdicts,
    confirmed: cards.filter((c) => c.status === "confirmed").length, hypotheses: cards.filter((c) => c.status === "hypothesis").length,
  };
}

/** Ф6 ranking and the caps: confirmed ex-ante → hypothesis ex-ante → «разбор»; then smoothed, Δ, rule text. */
function chooseCards(
  trades: SimTrade[], prep: Prep, fam: Member[], verdicts: RecipeVerdict[],
  extra: { fragile: Fragile | null; needDays: number | null; atLeast: boolean }[], o: HonestyOpts,
): HonestCard[] {
  const key = verdicts.map((v) => JSON.stringify(v.rule));
  const rank = (i: number) => (verdicts[i].kind === "label" ? 2 : verdicts[i].status === "confirmed" ? 0 : 1);
  const cmp = (a: number, b: number) => rank(a) - rank(b) || verdicts[b].smoothed - verdicts[a].smoothed || verdicts[b].delta - verdicts[a].delta || key[a].localeCompare(key[b]);
  const seen = new Set<string>();
  const shown = verdicts.map((_, i) => i).filter((i) => verdicts[i].status !== "hidden").sort(cmp).filter((i) => !seen.has(key[i]) && seen.add(key[i]));
  const idx = new Map<Scored, number>();
  const scored = shown.map((i) => {
    const s: Scored = { kind: verdicts[i].kind, picked: verdicts[i].picked, e: fam[i].me.e, b: { ci: { lo: 0, hi: 0 }, se: fam[i].se, center: fam[i].me.center }, robust: verdicts[i].status === "confirmed" };
    idx.set(s, i);
    return s;
  });
  const chosen = selectCards(scored, o.limit, (a, b) => cmp(idx.get(a) as number, idx.get(b) as number)).map((s) => idx.get(s) as number);
  const { boots } = familyBootstrap(prep, chosen.map((i) => fam[i].me.e));
  return chosen.map((i, c): HonestCard => {
    const v = verdicts[i], e = fam[i].me.e, x = extra[i];
    const r = runScenario(trades, [v.rule], { bootstrap: false });
    return {
      recipeId: v.id, rule: v.rule, status: v.status as "confirmed" | "hypothesis", kind: v.kind, timing: timingOf(v.rule, v.kind),
      picked: v.picked, sameData: v.picked && !v.wf.available, improvement: e.delta, ci: boots[c].ci,
      tradesLeft: e.tradesLeft, excluded: e.excluded, changed: e.changed, affected: e.excluded + e.changed, removedNet: e.removedNet,
      estimate: v.rule.type === "maxSizeRel" || v.rule.type === "capLoss",
      scenarioNet: r.scenario.net, scenarioWinRate: r.scenario.winRate, scenarioProfitFactor: r.scenario.profitFactor,
      oos: v.wf.available ? { sum: v.wf.sum, months: v.wf.months, positive: v.wf.positive, testDays: v.wf.testDays } : null,
      needDays: x.needDays, needDaysAtLeast: x.needDays != null && x.atLeast, fragile: x.fragile,
    };
  });
}

const resolve = (opts: Partial<HonestyOpts>): HonestyOpts => ({
  iters: HONESTY.iters, seed: HONESTY.seed, perms: HONESTY.perms, permSeed: HONESTY.permSeed,
  fdrMethod: HONESTY.fdrMethod, limit: HONESTY.limit, minTrades: HONESTY.minTrades, ...opts,
});

/** The honest verdict for one trader's trades (synchronous: tests, the calibration harness). */
export function computeHonesty(trades: SimTrade[], opts: Partial<HonestyOpts> = {}): HonestyResult {
  const g = honestySteps(trades, resolve(opts));
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

const abortError = () => new DOMException("The honesty computation was aborted", "AbortError");

/**
 * Same result as computeHonesty, giving the event loop a turn (setImmediate) whenever more than `yieldMs` ms passed
 * since the last one — the API is one process, so a 30 s computation must not block requests. Rejects with an
 * AbortError as soon as `signal` is aborted.
 */
export async function computeHonestyAsync(
  trades: SimTrade[], opts: Partial<HonestyOpts> = {}, run: { signal?: AbortSignal; yieldMs?: number } = {},
): Promise<HonestyResult> {
  const yieldMs = run.yieldMs ?? 20;
  if (run.signal?.aborted) throw abortError();
  const g = honestySteps(trades, resolve(opts));
  let last = performance.now();
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    if (run.signal?.aborted) throw abortError();
    if (performance.now() - last >= yieldMs) {
      await new Promise<void>((res) => setImmediate(res));
      if (run.signal?.aborted) throw abortError();
      last = performance.now();
    }
  }
}
