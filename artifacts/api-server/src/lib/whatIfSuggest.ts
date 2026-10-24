/**
 * «Что ещё дало бы больше всего» — the suggestion search over the single-rule grid (lib/whatIfGrid). Pure, no I/O.
 *
 *  1. prepare once: the sorted base, its calendar days, one shared bootstrap count matrix (the same draws as
 *     pairedDayBootstrap with the same seed, so the intervals match the scenario page) and the TRAIN/TEST split;
 *  2. a fast effect per candidate through the shared rule passes (lib/whatIfPasses): no metrics, no re-sorting;
 *  3. one family-wise bootstrap (single-step max-t) over every candidate tried — «устойчиво» means above zero even after
 *     correcting for the number of rules tried, and for candidates picked by their own result also on the later TEST days;
 *  4. gates, tiers (robust ex-ante → robust label → weak ex-ante → weak label), the IMX guard, one card per rule type,
 *     ≤ 1 label card, ≤ 2 picked cards and the overlap rule select at most `limit` cards;
 *  5. only those finalists run through runScenario for the scenario metrics.
 * These are historical facts on the trader's own trades, not forecasts.
 */
import type { Lang } from "../i18n";
import { describeRule, runScenario } from "./whatIf";
import { buildPasses } from "./whatIfPasses";
import { type CandidateKind, suggestionGrid, trainDays } from "./whatIfGrid";
import { type Timing, timingOf } from "./whatIfRecipes";
import { type Rule, type RuleType, type SimTrade, mulberry32, netOf, quantileSorted, round2, sortSim, traderDayKey } from "./whatIfTypes";
import type { Why } from "./whatIfWhy";

export interface Suggestion {
  rule: Rule;
  label: string;
  /** scenario.net − baseline.net, $. */
  improvement: number;
  /** 95% bootstrap interval of the improvement (per-rule, as on the scenario page). */
  ci: { lo: number; hi: number };
  tradesLeft: number;
  /** Trades the rule removes. */
  excluded: number;
  scenarioNet: number;
  scenarioWinRate: number | null;
  scenarioProfitFactor: number | null;
  /** Above zero after the family-wise correction (and on the holdout); false = a weaker signal. */
  robust: boolean;
  /** Net of the trades the rule removes (≤ 0 for a helpful filter), $. */
  removedNet: number;
  kind: CandidateKind;
  /** Chosen by its own past result (worst tickers / setups / tags). */
  picked: boolean;
  /** Picked and checked on the same days (too few days for a holdout). */
  sameData: boolean;
  /** Result on the TEST days (the last third); null without a holdout (< 30 days). */
  holdout: { delta: number; days: number; affected: number } | null;
  /** Trades removed or changed. */
  affected: number;
  /** Trades changed (scale rules). */
  changed: number;
  /** A scale rule: the number is an estimate. */
  estimate: boolean;
  /** «до входа» / «в сделке» / «разбор» (Ф2): when the rule can be followed. */
  timing: Timing;
  /** «Почему»: the trades and days behind the number (lib/whatIfWhy withWhy, added by the route). */
  why?: Why;
}

export interface SuggestionsResult {
  suggestions: Suggestion[];
  /** Candidates in the family-wise correction. */
  tested: number;
  /** < 30 days or < 60 trades: every card is a «ориентир», never robust. */
  smallSample: boolean;
}

export interface Prep {
  base: SimTrade[];
  n: number;
  days: string[];
  dayIdx: Map<string, number>;
  /** Unrounded baseline net per calendar day. */
  baseDay: Float64Array;
  iters: number;
  /** iters × days: how often bootstrap draw k picked day d (pairedDayBootstrap's draw order). */
  counts: Uint16Array;
  train: Set<string> | null;
  /** 1 for a TEST day; null without a holdout. */
  isTest: Uint8Array | null;
  testDays: number;
}

/** `holdout: false` (the honest path, lib/whatIfHonesty) = no TRAIN/TEST split; the count matrix is the same. */
export function prepare(trades: SimTrade[], opts: { iters?: number; seed?: number; holdout?: boolean } = {}): Prep {
  const iters = opts.iters ?? 600;
  const base = sortSim(trades).filter((t) => t.gross != null);
  const days = [...new Set(base.map((t) => t.day))].sort((a, b) => a.localeCompare(b));
  const D = days.length;
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const baseDay = new Float64Array(D);
  for (const t of base) baseDay[dayIdx.get(t.day) as number] += netOf(t) as number;
  const counts = new Uint16Array(iters * D);
  if (D >= 2) {
    const rnd = mulberry32(opts.seed ?? 20260101);
    for (let k = 0; k < iters; k++) {
      const row = k * D;
      for (let i = 0; i < D; i++) counts[row + ((rnd() * D) | 0)]++;
    }
  }
  const train = opts.holdout === false ? null : trainDays(base);
  const isTest = train ? Uint8Array.from(days, (d) => (train.has(d) ? 0 : 1)) : null;
  return { base, n: base.length, days, dayIdx, baseDay, iters, counts, train, isTest, testDays: train ? D - train.size : 0 };
}

export interface Effect {
  rule: Rule;
  skipped: boolean;
  /** Net difference by calendar day: −net of every removed trade, after − before of every changed one. */
  dayDiff: Float64Array;
  /**
   * Share of a trade the rule takes away, summed by calendar day: 1 per removed trade, 1 − x / sizeRel per trade a size
   * cap scales down (0 for a money change that removes no size). «Trade less» at random would give Δ = −mean · Σ this
   * (lib/whatIfRepick: the excess over the trader's average trade).
   */
  dayRemoved: Float64Array;
  affectedIds: Set<number>;
  excluded: number;
  changed: number;
  removedNet: number;
  delta: number;
  tradesLeft: number;
  affectedTraderDays: number;
  holdout: { delta: number; days: number; affected: number } | null;
  /** Share of the affected trades that are IMX (the IMX guard). */
  imxShare: number;
}

/** Effect of one rule on the prepared base — the same passes as runScenario, without metrics. */
export function candidateEffect(prep: Prep, rule: Rule): Effect {
  return rulesEffect(prep, [rule]);
}

/**
 * Effect of a SET of rules (lib/whatIfCombo «набор»), applied together like a scenario; `rule` of the result is the
 * first of them (the card caps only look at single rules).
 */
export function rulesEffect(prep: Prep, rules: Rule[]): Effect {
  const rule = rules[0];
  const scale = rules.find((r): r is Extract<Rule, { type: "maxSizeRel" }> => r.type === "maxSizeRel");
  const passes = buildPasses(rules, prep.base, null);
  const dayDiff = new Float64Array(prep.days.length);
  const dayRemoved = new Float64Array(prep.days.length);
  const ids = new Set<number>();
  const tdays = new Set<string>();
  let excluded = 0, changed = 0, removed = 0, imx = 0, testAffected = 0;
  const touch = (t: SimTrade, d: number) => {
    if (ids.has(t.id)) return;
    ids.add(t.id);
    tdays.add(traderDayKey(t));
    if (t.imx === true) imx++;
    if (prep.isTest?.[d]) testAffected++;
  };
  const onExclude = (t: SimTrade) => {
    const d = prep.dayIdx.get(t.day) as number;
    const net = netOf(t) ?? 0;
    dayDiff[d] -= net;
    dayRemoved[d] += 1;
    excluded++;
    removed += round2(net);
    touch(t, d);
  };
  const changedIds = new Set<number>();
  const onChange = (c: { reason: string }, delta: number, t: SimTrade) => {
    const d = prep.dayIdx.get(t.day) as number;
    dayDiff[d] += delta;
    if (scale && c.reason === "maxSizeRel" && t.sizeRel != null && t.sizeRel > 0) dayRemoved[d] += Math.max(0, 1 - scale.x / t.sizeRel);
    // A set may change one trade twice (a size cap, then a loss cap): it is one changed trade.
    if (!changedIds.has(t.id)) { changedIds.add(t.id); changed++; }
    touch(t, d);
  };
  if (passes.staticExclusion && !passes.money && !passes.sequential) {
    for (const t of prep.base) if (passes.staticExclusion(t)) onExclude(t);
  } else {
    let kept = prep.base;
    if (passes.staticExclusion) {
      kept = [];
      for (const t of prep.base) {
        if (passes.staticExclusion(t)) onExclude(t);
        else kept.push(t);
      }
    }
    if (passes.money) kept = passes.money(kept, onChange);
    if (passes.sequential) passes.sequential(kept, onExclude);
  }
  let delta = 0, testDelta = 0;
  for (let d = 0; d < dayDiff.length; d++) {
    delta += dayDiff[d];
    if (prep.isTest?.[d]) testDelta += dayDiff[d];
  }
  return {
    rule, skipped: passes.skipped.length > 0, dayDiff, dayRemoved, affectedIds: ids, excluded, changed, removedNet: round2(removed),
    delta: round2(delta), tradesLeft: prep.n - excluded, affectedTraderDays: tdays.size,
    holdout: prep.isTest ? { delta: round2(testDelta), days: prep.testDays, affected: testAffected } : null,
    imxShare: ids.size ? imx / ids.size : 0,
  };
}

/**
 * Only the total net difference of one rule on `base` (sorted, with gross) — candidateEffect without the per-day,
 * per-trade bookkeeping, for the within-day permutation test (lib/whatIfRepick), where it runs thousands of times.
 */
export function effectDelta(base: SimTrade[], rule: Rule): number {
  const passes = buildPasses([rule], base, null);
  let delta = 0;
  const onExclude = (t: SimTrade) => { delta -= netOf(t) ?? 0; };
  let kept = base;
  if (passes.staticExclusion) {
    kept = [];
    for (const t of base) {
      if (passes.staticExclusion(t)) onExclude(t);
      else kept.push(t);
    }
  }
  if (passes.money) kept = passes.money(kept, (_c, d) => { delta += d; });
  if (passes.sequential) passes.sequential(kept, onExclude);
  return round2(delta);
}

export interface FamilyBoot {
  ci: { lo: number; hi: number };
  /** Bootstrap standard deviation of the total difference; 0 ⇒ out of the family, never robust. */
  se: number;
  /** Observed total difference on cent-rounded days (the bootstrap's own statistic). */
  center: number;
}

/**
 * Paired day bootstrap of every candidate on the shared count matrix (per candidate: iters × changed days), plus the
 * single-step max-t critical value `c` over the family: robust ⇔ center / se > c.
 */
export function familyBootstrap(prep: Prep, effects: Effect[]): { boots: FamilyBoot[]; c: number; tested: number } {
  const D = prep.days.length, iters = prep.iters;
  const samples: Float64Array[] = [];
  const boots = effects.map((e): FamilyBoot => {
    const nz: number[] = [], vals: number[] = [];
    let center = 0;
    for (let d = 0; d < D; d++) {
      if (e.dayDiff[d] === 0) continue;
      // Same day nets as dailyResults (rounded to cents) → the same interval as pairedDayBootstrap.
      const v = round2(prep.baseDay[d] + e.dayDiff[d]) - round2(prep.baseDay[d]);
      if (v === 0) continue;
      nz.push(d); vals.push(v); center += v;
    }
    const S = new Float64Array(iters);
    let mean = 0;
    for (let k = 0; k < iters; k++) {
      const row = k * D;
      let s = 0;
      for (let i = 0; i < nz.length; i++) s += prep.counts[row + nz[i]] * vals[i];
      S[k] = s;
      mean += s;
    }
    mean /= iters || 1;
    let ss = 0;
    for (let k = 0; k < iters; k++) ss += (S[k] - mean) ** 2;
    const se = iters > 1 && nz.length ? Math.sqrt(ss / (iters - 1)) : 0;
    samples.push(S);
    const sorted = Float64Array.from(S).sort();
    return { ci: { lo: round2(quantileSorted(sorted, 0.025)), hi: round2(quantileSorted(sorted, 0.975)) }, se, center };
  });
  const M = new Float64Array(iters).fill(-Infinity);
  let tested = 0;
  boots.forEach((b, j) => {
    if (!(b.se > 0)) return;
    tested++;
    const S = samples[j];
    for (let k = 0; k < iters; k++) {
      const v = (S[k] - b.center) / b.se;
      if (v > M[k]) M[k] = v;
    }
  });
  const c = tested ? quantileSorted(M.sort(), 0.95) : Number.NaN;
  return { boots, c, tested };
}

export interface Scored { kind: CandidateKind; picked: boolean; e: Effect; b: FamilyBoot; robust: boolean }

/**
 * Keep gates: enough trades left (`minTrades`), enough affected (≥ max(5, 2%) on ≥ 3 trader-days), at most half the
 * trades removed (no «trade less» cards for a losing trader), a positive effect and — for a picked candidate with a
 * holdout — a positive effect on ≥ 3 affected TEST trades.
 */
export function passesGates(e: Effect, picked: boolean, n: number, minTrades = 30): boolean {
  if (e.skipped || e.tradesLeft < minTrades || e.affectedTraderDays < 3) return false;
  if (e.excluded + e.changed < Math.max(5, Math.ceil(0.02 * n))) return false;
  if (e.excluded > 0.5 * n || !(e.delta > 0)) return false;
  return !(picked && e.holdout && !(e.holdout.delta > 0 && e.holdout.affected >= 3));
}

/** A card whose removed trades are ≥ 70% IMX is «без IMX» in disguise. */
const IMX_MASK_SHARE = 0.7;
const isImxCard = (s: Scored) => s.e.rule.type === "excludeImx";

/**
 * Order (robust ex-ante → robust label → weak ex-ante → weak label; then the effect, then the rule text so ties sort
 * the same way every time — or the caller's `order`, the honest path's), the caps (one card per rule type, ≤ 1 label card, ≤ 2 picked cards, no card whose affected
 * trades are ≥ 70% those of a card above) and the IMX guard: only when «без IMX» is actually SHOWN, the cards that are
 * mostly IMX make way for the next ones. When «без IMX» does not make the list (limit, overlap), they stay.
 */
export function selectCards(input: Scored[], limit = 8, order?: (a: Scored, b: Scored) => number): Scored[] {
  const tier = (s: Scored) => (s.robust ? 0 : 2) + (s.kind === "label" ? 1 : 0);
  const byTier = (a: Scored, b: Scored) => tier(a) - tier(b) || b.e.delta - a.e.delta || JSON.stringify(a.e.rule).localeCompare(JSON.stringify(b.e.rule));
  const sorted = [...input].sort(order ?? byTier);
  const unmasked = (s: Scored) => isImxCard(s) || s.e.imxShare < IMX_MASK_SHARE;
  if (!sorted.some(isImxCard) || sorted.every(unmasked)) return pickCards(sorted, limit);
  const guarded = pickCards(sorted.filter(unmasked), limit);
  if (guarded.some(isImxCard)) return guarded;
  const plain = pickCards(sorted, limit);
  // Rare: «без IMX» makes the list only next to its disguises — show it, without them.
  return plain.some(isImxCard) ? plain.filter(unmasked) : plain;
}

/** Greedy pick in the given order under the caps. */
function pickCards(sorted: Scored[], limit: number): Scored[] {
  const chosen: Scored[] = [];
  const types = new Set<RuleType>();
  let labels = 0, picked = 0;
  for (const s of sorted) {
    if (chosen.length >= limit) break;
    if (types.has(s.e.rule.type)) continue;
    if (s.kind === "label" && labels >= 1) continue;
    if (s.picked && picked >= 2) continue;
    const ids = s.e.affectedIds;
    const overlaps = chosen.some((o) => {
      let common = 0;
      for (const id of ids) if (o.e.affectedIds.has(id)) common++;
      return ids.size > 0 && common / ids.size >= 0.7;
    });
    if (overlaps) continue;
    chosen.push(s);
    types.add(s.e.rule.type);
    if (s.kind === "label") labels++;
    if (s.picked) picked++;
  }
  return chosen;
}

/**
 * Best single rules for these trades (see the module comment). `team` = the whole desk: day rules per trader, no
 * share-size or personal-tag candidates.
 */
export function findSuggestions(
  trades: SimTrade[],
  opts: { limit?: number; minTrades?: number; iters?: number; seed?: number; lang?: Lang; team?: boolean } = {},
): SuggestionsResult {
  const prep = prepare(trades, { iters: opts.iters ?? 600, seed: opts.seed ?? 20260101 });
  const smallSample = prep.days.length < 30 || prep.n < 60;
  if (prep.days.length < 2) return { suggestions: [], tested: 0, smallSample };

  const grid = suggestionGrid(prep.base, { team: opts.team === true, train: prep.train });
  const tried = grid.map((c) => ({ ...c, e: candidateEffect(prep, c.rule) })).filter((x) => !x.e.skipped && x.e.excluded + x.e.changed > 0);
  const { boots, c, tested } = familyBootstrap(prep, tried.map((x) => x.e));
  const kept: Scored[] = [];
  tried.forEach((x, j) => {
    const e = x.e, b = boots[j];
    if (!passesGates(e, x.picked, prep.n, opts.minTrades ?? 30)) return;
    const robust = !smallSample && b.se > 0 && b.center / b.se > c && (e.holdout == null || e.holdout.delta >= 0) && !(x.picked && e.holdout == null);
    kept.push({ kind: x.kind, picked: x.picked, e, b, robust });
  });
  const chosen = selectCards(kept, opts.limit ?? 8);

  const lang = opts.lang ?? "ru";
  const suggestions = chosen.map(({ kind, picked: wasPicked, e, b, robust }): Suggestion => {
    const r = runScenario(trades, [e.rule], { bootstrap: false, lang });
    return {
      rule: e.rule, label: describeRule(e.rule, lang), improvement: e.delta, ci: b.ci,
      tradesLeft: e.tradesLeft, excluded: e.excluded,
      scenarioNet: r.scenario.net, scenarioWinRate: r.scenario.winRate, scenarioProfitFactor: r.scenario.profitFactor,
      robust, removedNet: e.removedNet,
      kind, picked: wasPicked, sameData: wasPicked && e.holdout == null, holdout: e.holdout,
      affected: e.excluded + e.changed, changed: e.changed, estimate: e.rule.type === "maxSizeRel" || e.rule.type === "capLoss",
      timing: timingOf(e.rule, kind),
    };
  });
  return { suggestions, tested, smallSample };
}
