/**
 * Ф7 calibration of the honest «Что если» path (lib/whatIfHonesty) — the pure part; scripts/whatif-calibrate.ts is
 * the CLI (DB, workers, printing). Not part of CI. WHATIF_HONESTY_SPEC.md §15.
 *   perturb    — one trader's null and planted-effect data sets (§15.2): N1 P&L shuffled across the trader's days,
 *                N2 shuffled inside each trader-day, E1–E7 a planted loss on top of N1, ASIS the data as it is;
 *   computeRun — computeHonesty on that data set plus, per slot, what is needed to re-decide its status offline
 *                (sd of the day differences, the 5 best days);
 *   decide     — the statuses under a threshold profile (the documented knobs only: α, q, BH/BY, min days, the
 *                one-day guard, the walk-forward share, the MDE z), so a threshold change is re-measured on the very
 *                same runs without recomputing the bootstrap. At the default profile it must reproduce the engine;
 *   summarize  — the §15.3 acceptance numbers.
 */
import { computeHonesty, HONESTY, slotFacts } from "../src/lib/whatIfHonesty";
import { type FitView, gridRecipes, unitWeights } from "../src/lib/whatIfRecipes";
import { effectMemo, repickBootstrap, rowStats, type Slot } from "../src/lib/whatIfRepick";
import { bhQ, byQ } from "../src/lib/whatIfStepdown";
import { candidateEffect, prepare } from "../src/lib/whatIfSuggest";
import { mulberry32, netOf, round2, sortSim, traderDayKey, type SimTrade } from "../src/lib/whatIfTypes";
import { type HonestStatus, type SlotFacts, decideSlot, fragileOf } from "../src/lib/whatIfWalkForward";

export type RunKind = "N1" | "N2" | "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "ASIS";
export const EFFECTS: readonly RunKind[] = ["E1", "E2", "E3", "E4", "E5", "E6", "E7"];

export interface Task {
  key: string;
  /** Trader code (T01 …): never a name. */
  trader: string;
  kind: RunKind;
  seed: number;
  /** Planted loss per affected trade, in σ of the trader's trade net (E6: always 15). */
  k: number;
  trades: SimTrade[];
  iters: number;
  perms: number;
  /** Keep only the first N trading days after perturbing (the MDE check). */
  prefixDays?: number;
  /**
   * N1 and E1–E7 only: shift every trade of the shuffled base by −mean, so the trader's total is 0. Without it a
   * LOSING trader's N1 data still rewards any rule that removes trades («trade less» is a real effect there).
   */
  centre?: boolean;
}

export interface Plant {
  ticker?: string;
  /** E2: entries at or after this minute lose. */
  cutoff?: number;
  trades: number;
  days: number;
}

export interface CompactVerdict {
  id: string;
  rule: string;
  kind: "exante" | "label";
  ordering: boolean;
  picked: boolean;
  delta: number;
  t: number;
  pRaw: number;
  pAdj: number;
  pPermAdj: number | null;
  /** The engine's facts for decideSlot (lib/whatIfWalkForward), minus the one-day guard (re-decided per profile). */
  facts: Omit<SlotFacts, "concOk" | "q">;
  wf: { positive: number; sum: number };
  affectedDays: number;
  /** The 5 largest positive day differences, descending (the one-day guard for any topDays ≤ 5). */
  top: number[];
  spike: boolean;
  gates: boolean;
  sdDiff: number;
  /** Engine verdict (default profile). */
  status: HonestStatus;
}

export interface RunResult {
  key: string;
  trader: string;
  kind: RunKind;
  seed: number;
  k: number;
  prefixDays?: number;
  skip: string | null;
  ms: number;
  n: number;
  days: number;
  months: number;
  folds: number;
  testDays: number;
  wfAvailable: boolean;
  smallSample: boolean;
  tested: number;
  testedOrdering: number;
  plant: Plant | null;
  verdicts: CompactVerdict[];
  cards: { id: string; status: string; fragile: string | null }[];
  /** N1 / ASIS: the first-step Romano–Wolf critical value (see firstStep). */
  diag?: FirstStep;
}

/* ───────────────────────── perturbations ───────────────────────── */

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

/** (gross, fees) pairs shuffled inside every group of base indices (seeded Fisher–Yates). */
function shuffleNets(base: SimTrade[], groups: number[][], rnd: () => number): SimTrade[] {
  const out = base.slice();
  for (const g of groups) {
    const pairs = g.map((i) => [base[i].gross, base[i].fees] as const);
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = pairs[i];
      pairs[i] = pairs[j];
      pairs[j] = tmp;
    }
    g.forEach((i, k) => { out[i] = { ...base[i], gross: pairs[k][0], fees: pairs[k][1] }; });
  }
  return out;
}

const withLoss = (t: SimTrade, usd: number): SimTrade => ({ ...t, gross: round2((t.gross ?? 0) - usd) });
const monthOf = (t: SimTrade) => t.day.slice(0, 7);

/** The most traded ticker present in ≥ 60% of the months and ≤ 25% of the trades (a realistic «worst ticker»). */
export function plantTicker(base: SimTrade[]): string | null {
  const months = new Set(base.map(monthOf)).size;
  const by = new Map<string, { n: number; months: Set<string> }>();
  for (const t of base) {
    const e = by.get(t.ticker) ?? { n: 0, months: new Set<string>() };
    e.n++;
    e.months.add(monthOf(t));
    by.set(t.ticker, e);
  }
  const ok = [...by.entries()].filter(([, e]) => e.months.size >= 0.6 * months && e.n <= 0.25 * base.length && e.n >= 10);
  ok.sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  return ok[0]?.[0] ?? null;
}

/** E2 cutoff: 14:00, else 13:00, else 15:00 — the first whose late share is 5–45% of the trades. */
function lateCutoff(base: SimTrade[]): number | null {
  for (const c of [840, 780, 900]) {
    const share = base.filter((t) => t.entryMin != null && t.entryMin >= c).length / base.length;
    if (share >= 0.05 && share <= 0.45) return c;
  }
  return null;
}

/** E5: trades entered after the trader-day's 2nd REALISED loss (closed at or before the entry) lose `usd` more. */
function plantTilt(trades: SimTrade[], usd: number): { out: SimTrade[]; hit: number; days: Set<string> } {
  const out = trades.slice();
  const days = new Set<string>();
  let hit = 0;
  const groups = new Map<string, number[]>();
  trades.forEach((t, i) => {
    const k = traderDayKey(t);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const g of groups.values()) {
    const closed: { close: number; net: number }[] = [];
    for (const i of g) {
      const t = out[i];
      if (t.entryMin == null) continue;
      const losses = closed.filter((c) => c.close <= (t.entryMin as number) && c.net < 0).length;
      if (losses >= 2) {
        out[i] = withLoss(t, usd);
        hit++;
        days.add(t.day);
      }
      if (t.holdSec != null) closed.push({ close: (t.entryMin as number) + t.holdSec / 60, net: netOf(out[i]) ?? 0 });
    }
  }
  return { out, hit, days };
}

function shift(trades: SimTrade[], match: (t: SimTrade) => boolean, usd: number): { out: SimTrade[]; plant: Plant } {
  const days = new Set<string>();
  let hit = 0;
  const out = trades.map((t) => {
    if (!match(t)) return t;
    hit++;
    days.add(t.day);
    return withLoss(t, usd);
  });
  return { out, plant: { trades: hit, days: days.size } };
}

/** The data set of one run; `skip` = why this trader cannot carry this effect (n/a, not a miss). */
export function perturb(task: Task): { trades: SimTrade[]; plant: Plant | null; skip: string | null } {
  const base = sortSim(task.trades).filter((t) => t.gross != null);
  const sigma = sdOf(base.map((t) => netOf(t) as number));
  const rnd = mulberry32(hashSeed(`${task.trader}|${task.seed}`));
  if (task.kind === "ASIS") return { trades: base, plant: null, skip: null };
  if (task.kind === "N2") {
    const groups = new Map<string, number[]>();
    base.forEach((t, i) => groups.set(traderDayKey(t), [...(groups.get(traderDayKey(t)) ?? []), i]));
    return { trades: shuffleNets(base, [...groups.values()], rnd), plant: null, skip: null };
  }
  const shuffled = shuffleNets(base, [base.map((_, i) => i)], rnd);
  const mean = base.reduce((sum, t) => sum + (netOf(t) as number), 0) / Math.max(1, base.length);
  const n1 = task.centre ? shuffled.map((t) => withLoss(t, mean)) : shuffled;
  if (task.kind === "N1") return { trades: n1, plant: null, skip: null };
  const usd = task.k * sigma;
  const share = (m: (t: SimTrade) => boolean) => base.filter(m).length;
  switch (task.kind) {
    case "E1":
    case "E7": {
      const ticker = plantTicker(base);
      if (!ticker) return { trades: n1, plant: null, skip: "no ticker in ≥ 60% of months with ≤ 25% of trades" };
      const months = [...new Set(base.map(monthOf))].sort();
      const early = new Set(months.slice(0, Math.ceil(0.4 * months.length)));
      const r = shift(n1, (t) => t.ticker === ticker && (task.kind === "E1" || early.has(monthOf(t))), usd);
      return { trades: r.out, plant: { ...r.plant, ticker }, skip: null };
    }
    case "E2": {
      const cutoff = lateCutoff(base);
      if (cutoff == null) return { trades: n1, plant: null, skip: "late share outside 5–45% at 13/14/15:00" };
      const r = shift(n1, (t) => t.entryMin != null && t.entryMin >= cutoff, usd);
      return { trades: r.out, plant: { ...r.plant, cutoff }, skip: null };
    }
    case "E3": {
      const n = share((t) => t.reentry === true);
      if (n < 10 || n > 0.5 * base.length) return { trades: n1, plant: null, skip: `re-entries ${n} of ${base.length}` };
      const r = shift(n1, (t) => t.reentry === true, usd);
      return { trades: r.out, plant: r.plant, skip: null };
    }
    case "E4": {
      const n = share((t) => t.imx === true);
      if (n < 30 || n > 0.5 * base.length) return { trades: n1, plant: null, skip: `IMX ${n} of ${base.length}` };
      const r = shift(n1, (t) => t.imx === true, usd);
      return { trades: r.out, plant: r.plant, skip: null };
    }
    case "E5": {
      const r = plantTilt(n1, usd);
      if (r.hit < 10) return { trades: n1, plant: null, skip: `tilted trades ${r.hit}` };
      return { trades: r.out, plant: { trades: r.hit, days: r.days.size }, skip: null };
    }
    case "E6": {
      const byTicker = new Map<string, Set<string>>();
      for (const t of base) byTicker.set(t.ticker, (byTicker.get(t.ticker) ?? new Set()).add(t.day));
      const cands = [...byTicker.entries()]
        .filter(([tk, ds]) => ds.size >= 10 && base.filter((t) => t.ticker === tk).length <= 0.25 * base.length)
        .map(([tk]) => tk)
        .sort();
      if (!cands.length) return { trades: n1, plant: null, skip: "no ticker on ≥ 10 days" };
      const ticker = cands[Math.floor(rnd() * cands.length)];
      const days = [...(byTicker.get(ticker) as Set<string>)].sort();
      const chosen = new Set<string>();
      while (chosen.size < 3) chosen.add(days[Math.floor(rnd() * days.length)]);
      const done = new Set<string>();
      const r = shift(n1, (t) => {
        if (t.ticker !== ticker || !chosen.has(t.day) || done.has(t.day)) return false;
        done.add(t.day);
        return true;
      }, 15 * sigma);
      return { trades: r.out, plant: { ...r.plant, ticker }, skip: null };
    }
    default:
      return { trades: n1, plant: null, skip: `unknown run ${task.kind}` };
  }
}

/* ───────────────────────── the first Romano–Wolf step ───────────────────────── */

export interface FirstStep {
  /** Family size. */
  m: number;
  /** 90% quantile over the replicates of max_j T_jb: the t a top slot needs for pAdj ≤ 0.10 (spec §7.2: mde.z = c1 + 0.84). */
  c1: number;
  /** The same with every slot's null shifted to mean 0 ((N − mean)/sd): what c1 would be without the re-pick optimism. */
  c1Centred: number;
  /** Mean of T over the replicates: slots that refit on the data (picks, quantile thresholds) vs fixed slots. */
  meanTRefit: number;
  meanTFixed: number;
  /** Slot ids whose null mean T > 1 (they set c1). */
  shifted: string[];
}

const q90 = (v: Float64Array) => Float64Array.from(v).sort()[Math.min(v.length - 1, Math.floor(0.9 * v.length))];

/** Recomputes the engine's re-pick bootstrap (same draws, same family) and reads its first-step critical value. */
export function firstStep(trades: SimTrade[], iters: number): FirstStep {
  const prep = prepare(trades, { iters, seed: HONESTY.seed, holdout: false });
  const D = prep.days.length, B = prep.iters;
  const { recipes } = gridRecipes(prep.base);
  const effectOf = effectMemo(prep);
  const ones = unitWeights(D);
  const full: FitView = { pick: ones, all: ones, minPick: 10 };
  const slots: Slot[] = [];
  for (const recipe of recipes) {
    const rule = recipe.fit(full);
    if (!rule) continue;
    const e = effectOf(rule).e;
    if (!e.skipped && e.excluded + e.changed > 0) slots.push({ recipe, rule });
  }
  const g = repickBootstrap(prep, slots, effectOf, 10);
  let step = g.next();
  while (!step.done) step = g.next();
  const { N } = step.value;
  const max = new Float64Array(B).fill(-Infinity), maxC = new Float64Array(B).fill(-Infinity);
  let m = 0, refit = 0, nRefit = 0, fixed = 0, nFixed = 0;
  const shifted: string[] = [];
  slots.forEach((s, j) => {
    const st = rowStats(N, j, B);
    if (st.finite < 2 || !(st.sd > 0)) return;
    m++;
    const meanT = st.mean / st.sd;
    if (s.recipe.fixed) { fixed += meanT; nFixed++; } else { refit += meanT; nRefit++; }
    if (meanT > 1) shifted.push(s.recipe.id);
    for (let b = 0; b < B; b++) {
      const v = N[j * B + b];
      if (!Number.isFinite(v)) continue;
      if (v / st.sd > max[b]) max[b] = v / st.sd;
      if ((v - st.mean) / st.sd > maxC[b]) maxC[b] = (v - st.mean) / st.sd;
    }
  });
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    m, c1: r3(q90(max)), c1Centred: r3(q90(maxC)), meanTRefit: r3(nRefit ? refit / nRefit : 0), meanTFixed: r3(nFixed ? fixed / nFixed : 0), shifted,
  };
}

/* ───────────────────────── one run ───────────────────────── */

function topPositive(dayDiff: Float64Array, k: number): number[] {
  const pos: number[] = [];
  for (const v of dayDiff) if (v > 0) pos.push(v);
  return pos.sort((a, b) => b - a).slice(0, k);
}

export function computeRun(task: Task): RunResult {
  const p = perturb(task);
  let trades = p.trades;
  if (task.prefixDays != null) {
    const keep = new Set([...new Set(trades.map((t) => t.day))].sort().slice(0, task.prefixDays));
    trades = trades.filter((t) => keep.has(t.day));
  }
  const head = { key: task.key, trader: task.trader, kind: task.kind, seed: task.seed, k: task.k, prefixDays: task.prefixDays, skip: p.skip, plant: p.plant };
  if (p.skip) {
    return { ...head, ms: 0, n: 0, days: 0, months: 0, folds: 0, testDays: 0, wfAvailable: false, smallSample: true, tested: 0, testedOrdering: 0, verdicts: [], cards: [] };
  }
  const t0 = performance.now();
  const res = computeHonesty(trades, { iters: task.iters, perms: task.perms });
  const ms = Math.round(performance.now() - t0);
  const prep = prepare(trades, { iters: 1, holdout: false });
  const verdicts = res.verdicts.map((v): CompactVerdict => {
    const e = candidateEffect(prep, v.rule);
    const { concOk: _c, q: _q, ...facts } = slotFacts(v, false);
    return {
      id: v.id, rule: JSON.stringify(v.rule), kind: v.kind, ordering: v.ordering, picked: v.picked, delta: v.delta, t: v.t,
      pRaw: v.pRaw, pAdj: v.pAdj, pPermAdj: v.pPermAdj, facts: {
        ...facts, wf: { positive: facts.wf.positive, sum: facts.wf.sum },
        excess: facts.excess ? { delta: facts.excess.delta, sdDiff: facts.excess.sdDiff, wf: { positive: facts.excess.wf.positive, sum: facts.excess.wf.sum } } : null,
      },
      wf: { positive: v.wf.positive, sum: v.wf.sum },
      affectedDays: v.affectedDays, top: topPositive(e.dayDiff, 5), spike: v.spike, gates: v.gates, sdDiff: sdOf(e.dayDiff), status: v.status,
    };
  });
  return {
    ...head, ms, n: res.n, days: res.days, months: res.months, folds: res.verdicts[0]?.wf.months ?? 0, testDays: res.testDays,
    wfAvailable: res.wfAvailable, smallSample: res.smallSample, tested: res.tested, testedOrdering: res.testedOrdering, verdicts,
    cards: res.cards.map((c) => ({ id: c.recipeId, status: c.status, fragile: c.fragile ? `${c.fragile.reason}:${c.fragile.days}` : null })),
    ...(task.kind === "N1" || task.kind === "ASIS" ? { diag: firstStep(trades, task.iters) } : {}),
  };
}

/* ───────────────────────── offline statuses ───────────────────────── */

export interface Profile {
  name: string;
  alpha: number;
  q: number;
  fdr: "bh" | "by";
  confirmDays: number;
  fragileDays: number;
  topDays: number;
  posShare: number;
  minMonths: number;
  minFolds: number;
  minTestDays: number;
  mdeZ: number;
  floorDays: number;
  maxNeedDays: number;
}

export const DEFAULT_PROFILE: Profile = {
  name: "default", alpha: HONESTY.alphaConfirm, q: HONESTY.qHypothesis, fdr: HONESTY.fdrMethod,
  confirmDays: HONESTY.conc.confirmDays, fragileDays: HONESTY.conc.fragileDays, topDays: HONESTY.conc.topDays,
  posShare: HONESTY.wf.posShare, minMonths: HONESTY.wf.minMonths, minFolds: HONESTY.wf.minFolds, minTestDays: HONESTY.wf.minTestDays,
  mdeZ: HONESTY.mde.z, floorDays: HONESTY.mde.floorDays, maxNeedDays: HONESTY.mde.maxNeedDays,
};

export interface Decided { status: HonestStatus[]; fragile: (string | null)[]; needDays: (number | null)[] }

export function decide(r: RunResult, p: Profile): Decided {
  const avail = r.months >= p.minMonths && r.folds >= p.minFolds && r.testDays >= p.minTestDays;
  const pr = r.verdicts.map((v) => v.pRaw);
  const q = p.fdr === "by" ? byQ(pr) : bhQ(pr);
  const out: Decided = { status: [], fragile: [], needDays: [] };
  const ctx = { smallSample: r.smallSample, avail, folds: r.folds, testDays: r.testDays, D: r.days, K: r.months };
  const cfg = {
    alphaConfirm: p.alpha, qHypothesis: p.q, posShare: p.posShare, minMonths: p.minMonths,
    mde: { z: p.mdeZ, floorDays: p.floorDays, maxNeedDays: p.maxNeedDays, daysPerMonth: HONESTY.mde.daysPerMonth },
  };
  r.verdicts.forEach((v, i) => {
    const withoutTop = round2(v.delta - v.top.slice(0, p.topDays).reduce((s, x) => s + x, 0));
    const concOk = v.affectedDays >= p.confirmDays && withoutTop > 0 && !v.spike;
    const d = decideSlot({ ...v.facts, q: q[i], concOk }, ctx, cfg);
    const f = fragileOf(v.affectedDays, withoutTop, { confirmDays: p.confirmDays, fragileDays: p.fragileDays, topDays: p.topDays });
    out.status.push(d.status);
    out.fragile.push(f ? `${f.reason}:${f.days}` : null);
    out.needDays.push(d.needDays);
  });
  return out;
}

/* ───────────────────────── targets and the summary ───────────────────────── */

/** Is slot `v` the one the planted effect of run `r` should surface (N1 / ASIS: every slot; N2: the ordering ones)? */
export function isTarget(kind: RunKind, plant: Plant | null, v: CompactVerdict): boolean {
  switch (kind) {
    case "E1": case "E6": case "E7": {
      const rule = JSON.parse(v.rule) as { type: string; tickers?: string[] };
      return rule.type === "excludeTickers" && !!plant?.ticker && (rule.tickers ?? []).some((x) => x.toUpperCase() === plant.ticker);
    }
    case "E2": return v.id.startsWith("tw.to.");
    case "E3": return v.id === "reentry";
    case "E4": return v.id === "imx";
    case "E5": return /^(sal|dll|mtd)\./.test(v.id);
    case "N2": return v.ordering;
    default: return true;
  }
}

export interface Rate { hit: number; of: number }
const rate = (): Rate => ({ hit: 0, of: 0 });
export const pct = (r: Rate) => (r.of ? `${((100 * r.hit) / r.of).toFixed(0)}% (${r.hit}/${r.of})` : "n/a");

export interface EffectRow { kind: RunKind; k: number; confirmed: Rate; atLeastHyp: Rate; nullConfirmed: Rate; bigConfirmed: Rate; smallConfirmed: Rate; shown: Rate; fragileShown: Rate; skipped: number }

export interface Summary {
  profile: string;
  n1Confirmed: Rate;
  n1Hyp: Rate;
  n1ConfirmedLosing: Rate;
  n1ConfirmedWinning: Rate;
  n1Ids: Record<string, number>;
  n2OrderingConfirmed: Rate;
  n2Ids: Record<string, number>;
  effects: EffectRow[];
  asis: { trader: string; n: number; confirmed: string[]; hypotheses: number; fragileShown: number; shown: number }[];
}

/** The §15.3 numbers under one profile. `losing` = trader codes whose real net is < 0 (N1 keeps the total). */
export function summarize(runs: RunResult[], p: Profile, losing: ReadonlySet<string>, bigTrades = 1500): Summary {
  const live = runs.filter((r) => !r.skip && r.prefixDays == null);
  const dec = new Map(live.map((r) => [r.key, decide(r, p)]));
  const n1 = new Map(live.filter((r) => r.kind === "N1").map((r) => [`${r.trader}|${r.seed}`, r]));
  const s: Summary = {
    profile: p.name, n1Confirmed: rate(), n1Hyp: rate(), n1ConfirmedLosing: rate(), n1ConfirmedWinning: rate(), n1Ids: {},
    n2OrderingConfirmed: rate(), n2Ids: {}, effects: [], asis: [],
  };
  const rows = new Map<string, EffectRow>();
  const hitIds = (r: RunResult, d: Decided, pick: (i: number) => boolean, into: Record<string, number>) => {
    let any = false;
    r.verdicts.forEach((v, i) => { if (d.status[i] === "confirmed" && pick(i)) { any = true; into[v.id] = (into[v.id] ?? 0) + 1; } });
    return any;
  };
  for (const r of live) {
    const d = dec.get(r.key) as Decided;
    if (r.kind === "N1") {
      const conf = hitIds(r, d, () => true, s.n1Ids);
      const side = losing.has(r.trader) ? s.n1ConfirmedLosing : s.n1ConfirmedWinning;
      for (const x of [s.n1Confirmed, side]) { x.of++; if (conf) x.hit++; }
      s.n1Hyp.of++;
      if (d.status.some((st) => st === "hypothesis")) s.n1Hyp.hit++;
    } else if (r.kind === "N2") {
      s.n2OrderingConfirmed.of++;
      if (hitIds(r, d, (i) => r.verdicts[i].ordering, s.n2Ids)) s.n2OrderingConfirmed.hit++;
    } else if (r.kind === "ASIS") {
      const shown = d.status.filter((st) => st !== "hidden").length;
      s.asis.push({
        trader: r.trader, n: r.n, confirmed: r.verdicts.filter((_, i) => d.status[i] === "confirmed").map((v) => v.id),
        hypotheses: d.status.filter((st) => st === "hypothesis").length, shown,
        fragileShown: d.status.filter((st, i) => st !== "hidden" && d.fragile[i] != null).length,
      });
    }
  }
  for (const r of runs.filter((x) => EFFECTS.includes(x.kind) && x.prefixDays == null)) {
    const id = `${r.kind}|${r.k}`;
    const row = rows.get(id) ?? { kind: r.kind, k: r.k, confirmed: rate(), atLeastHyp: rate(), nullConfirmed: rate(), bigConfirmed: rate(), smallConfirmed: rate(), shown: rate(), fragileShown: rate(), skipped: 0 };
    rows.set(id, row);
    if (r.skip) { row.skipped++; continue; }
    const d = dec.get(r.key) as Decided;
    const tgt = r.verdicts.map((v) => isTarget(r.kind, r.plant, v));
    const conf = tgt.some((x, i) => x && d.status[i] === "confirmed");
    const hyp = tgt.some((x, i) => x && d.status[i] !== "hidden");
    row.confirmed.of++; row.atLeastHyp.of++;
    if (conf) row.confirmed.hit++;
    if (hyp) row.atLeastHyp.hit++;
    const size = r.n >= bigTrades ? row.bigConfirmed : row.smallConfirmed;
    size.of++;
    if (conf) size.hit++;
    const base = n1.get(`${r.trader}|${r.seed}`);
    if (base) {
      const bd = dec.get(base.key) as Decided;
      row.nullConfirmed.of++;
      if (base.verdicts.some((v, i) => isTarget(r.kind, r.plant, v) && bd.status[i] === "confirmed")) row.nullConfirmed.hit++;
    }
    const shownIdx = tgt.map((x, i) => (x && d.status[i] !== "hidden" ? i : -1)).filter((i) => i >= 0);
    if (shownIdx.length) {
      row.shown.hit++;
      row.fragileShown.of++;
      if (shownIdx.some((i) => d.fragile[i] != null)) row.fragileShown.hit++;
    }
    row.shown.of++;
  }
  s.effects = [...rows.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.k - b.k);
  return s;
}

/** Engine status vs the offline re-decision at the default profile: must be 0 mismatches. */
export function selfCheck(runs: RunResult[]): { verdicts: number; mismatches: string[] } {
  const bad: string[] = [];
  let n = 0;
  for (const r of runs.filter((x) => !x.skip)) {
    const d = decide(r, DEFAULT_PROFILE);
    r.verdicts.forEach((v, i) => {
      n++;
      if (d.status[i] !== v.status) bad.push(`${r.key} ${v.id}: engine ${v.status}, offline ${d.status[i]}`);
    });
  }
  return { verdicts: n, mismatches: bad };
}
