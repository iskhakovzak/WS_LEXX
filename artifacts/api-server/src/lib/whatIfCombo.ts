/**
 * «Набор правил» — up to 3 rules together: their joint effect, how they interact, and an honest status. Pure, no I/O.
 *
 * Search (the page's «Лучшие наборы»):
 *   1. the single-rule grid (lib/whatIfGrid) is scored on the TRAIN days only (the first two thirds of ≥ 30 days);
 *      the best K = 6 positive ex-ante rules of distinct types become the building blocks — chosen without the TEST days;
 *   2. every pair and triple of them is built (C(6,2) + C(6,3) = 35 sets) and scored as ONE scenario (the rules interact:
 *      a day stop changes what a per-ticker cap sees);
 *   3. ONE family-wise max-t bootstrap (lib/whatIfSuggest familyBootstrap) over EVERYTHING tried — every single rule of
 *      the grid AND every set built, plus the trader's own set when it is not one of them. `searched` = the sets built,
 *      `family` = the members of that correction. «Устойчиво» = above zero after that correction AND positive on the
 *      later TEST days (the blocks were picked on TRAIN); without a TEST split (< 30 days) a set is never robust.
 * Interaction: Δ(set) against Σ Δ(each rule alone), the marginal value of each rule (Δ(set) − Δ(set without it)) and the
 * share of the affected trades two rules both touch. «Пересекаются» = together ≤ 75% of the sum; «лишнее» = a rule
 * that adds nothing on top of the others.
 * These are historical facts on the trader's own trades, not forecasts.
 */
import type { Lang } from "../i18n";
import { describeRule } from "./whatIf";
import { suggestionGrid } from "./whatIfGrid";
import { type Effect, type Prep, candidateEffect, familyBootstrap, passesGates, prepare, rulesEffect } from "./whatIfSuggest";
import { type Rule, type RuleType, type SimTrade, round2 } from "./whatIfTypes";

/** Building blocks of the search. */
export const COMBO_BLOCKS = 6;
/** At most this many rules in a set. */
export const COMBO_MAX_RULES = 3;
/** Together at most this share of the sum of the singles = the rules overlap. */
export const OVERLAP_RATIO = 0.75;

export type ComboWarning = "overlap" | "redundant" | "synergy" | null;

export interface ComboEval {
  rules: Rule[];
  labels: string[];
  /** Δ of the set applied together ($). */
  delta: number;
  /** Δ of each rule alone, in `rules` order. */
  singles: number[];
  sumSingles: number;
  /** delta − sumSingles. */
  interaction: number;
  /** Δ(set) − Δ(set without rule i): what each rule adds on top of the others. */
  marginal: number[];
  /** Share of the affected trades touched by two rules or more (0–1). */
  overlap: number;
  warning: ComboWarning;
  /** 95% bootstrap interval of Δ (the scenario page's). */
  ci: { lo: number; hi: number };
  robust: boolean;
  /** Result on the TEST days; null without a split. */
  holdout: { delta: number; days: number; affected: number } | null;
  affected: number;
  excluded: number;
  tradesLeft: number;
  /** The set passes the card gates (enough trades left / touched, ≤ half removed, Δ > 0). */
  gates: boolean;
  /** The set beats its best single rule (else it is not worth three rules). */
  beatsBest: boolean;
}

export interface ComboSearch {
  combos: ComboEval[];
  own: ComboEval | null;
  /** Sets built by the search (pairs + triples of the blocks). */
  searched: number;
  /** Single rules of the grid tried (part of the correction). */
  singles: number;
  /** Members of the family-wise correction (singles + sets + the own set when new). */
  family: number;
  blocks: string[];
  smallSample: boolean;
  /** < 30 days: no TEST split, nothing can be robust. */
  holdout: boolean;
}

/** All k-subsets of 0..n−1 (k = 2, 3), lexicographic. */
export function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < n; i++) { acc.push(i); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

/** Sets the search builds from `blocks` building blocks: C(b,2) + C(b,3). */
export function comboCount(blocks: number): number {
  return subsets(blocks, 2).length + subsets(blocks, 3).length;
}

/** One rule per type (the engine ignores a second one); at most COMBO_MAX_RULES. */
export function normaliseSet(rules: Rule[]): Rule[] {
  const seen = new Set<RuleType>();
  return rules.filter((r) => !seen.has(r.type) && seen.add(r.type)).slice(0, COMBO_MAX_RULES);
}

const trainDelta = (prep: Prep, e: Effect) => {
  let s = 0;
  for (let d = 0; d < e.dayDiff.length; d++) if (!prep.isTest || !prep.isTest[d]) s += e.dayDiff[d];
  return s;
};

function overlapOf(singles: Effect[]): number {
  const count = new Map<number, number>();
  for (const e of singles) for (const id of e.affectedIds) count.set(id, (count.get(id) ?? 0) + 1);
  if (!count.size) return 0;
  let shared = 0;
  for (const c of count.values()) if (c >= 2) shared++;
  return round2(shared / count.size);
}

/** Interaction verdict of a set from its numbers (pure, unit-tested). */
export function warningOf(delta: number, singles: number[], marginal: number[]): ComboWarning {
  if (singles.length < 2) return null;
  if (marginal.some((m) => m <= 0)) return "redundant";
  const sum = singles.reduce((s, v) => s + v, 0);
  if (sum > 0 && delta <= OVERLAP_RATIO * sum) return "overlap";
  if (sum > 0 && delta >= 1.25 * sum) return "synergy";
  return null;
}

type Built = { rules: Rule[]; e: Effect; singles: Effect[]; marginal: number[] };

function build(prep: Prep, rules: Rule[], single: (r: Rule) => Effect): Built {
  const set = normaliseSet(rules);
  const e = rulesEffect(prep, set);
  const singles = set.map(single);
  const marginal = set.map((_, i) => (set.length < 2 ? e.delta : round2(e.delta - rulesEffect(prep, set.filter((__, j) => j !== i)).delta)));
  return { rules: set, e, singles, marginal };
}

/**
 * The search and (optionally) the trader's own set, with ONE correction over everything tried. `own` with fewer than
 * 2 distinct rule types is ignored (a single rule is the suggestions' job).
 */
export function findCombos(
  trades: SimTrade[],
  opts: { own?: Rule[] | null; limit?: number; iters?: number; seed?: number; lang?: Lang; team?: boolean; minTrades?: number } = {},
): ComboSearch {
  const prep = prepare(trades, { iters: opts.iters ?? 600, seed: opts.seed ?? 20260101 });
  const smallSample = prep.days.length < 30 || prep.n < 60;
  const lang = opts.lang ?? "ru";
  const empty: ComboSearch = { combos: [], own: null, searched: 0, singles: 0, family: 0, blocks: [], smallSample, holdout: prep.train != null };
  if (prep.days.length < 2) return empty;

  // 1. The grid's singles; the blocks are picked on TRAIN days only.
  const grid = suggestionGrid(prep.base, { team: opts.team === true, train: prep.train });
  const memo = new Map<string, Effect>();
  const single = (r: Rule) => {
    const k = JSON.stringify(r);
    let e = memo.get(k);
    if (!e) { e = candidateEffect(prep, r); memo.set(k, e); }
    return e;
  };
  const tried = grid.map((c) => ({ ...c, e: single(c.rule) })).filter((x) => !x.e.skipped && x.e.excluded + x.e.changed > 0);
  const n = prep.n;
  const blocks: Rule[] = [];
  const types = new Set<RuleType>();
  for (const x of [...tried].filter((x) => x.kind === "exante" && trainDelta(prep, x.e) > 0 && passesGates(x.e, false, n, opts.minTrades ?? 30))
    .sort((a, b) => trainDelta(prep, b.e) - trainDelta(prep, a.e) || JSON.stringify(a.rule).localeCompare(JSON.stringify(b.rule)))) {
    if (blocks.length >= COMBO_BLOCKS) break;
    if (types.has(x.rule.type)) continue;
    types.add(x.rule.type);
    blocks.push(x.rule);
  }

  // 2. Every pair and triple of the blocks.
  const built: Built[] = [];
  for (const k of [2, 3]) for (const idx of subsets(blocks.length, k)) built.push(build(prep, idx.map((i) => blocks[i]), single));
  const keyOf = (rs: Rule[]) => JSON.stringify([...rs].map((r) => JSON.stringify(r)).sort());
  const ownSet = opts.own ? normaliseSet(opts.own) : [];
  const ownKey = ownSet.length >= 2 ? keyOf(ownSet) : null;
  let ownIdx = ownKey ? built.findIndex((b) => keyOf(b.rules) === ownKey) : -1;
  if (ownKey && ownIdx < 0) { built.push(build(prep, ownSet, single)); ownIdx = built.length - 1; }

  // 3. One family-wise correction over every single rule tried and every set.
  const family = [...tried.map((x) => x.e), ...built.map((b) => b.e)];
  const { boots, c } = familyBootstrap(prep, family);
  const off = tried.length;
  const evalOf = (b: Built, j: number): ComboEval => {
    const boot = boots[off + j];
    const singles = b.singles.map((s) => s.delta);
    const sumSingles = round2(singles.reduce((s, v) => s + v, 0));
    const gates = passesGates(b.e, false, n, opts.minTrades ?? 30);
    const robust = gates && !smallSample && prep.train != null && boot.se > 0 && boot.center / boot.se > c
      && b.e.holdout != null && b.e.holdout.delta > 0 && b.e.holdout.affected >= 3;
    return {
      rules: b.rules, labels: b.rules.map((r) => describeRule(r, lang)),
      delta: b.e.delta, singles, sumSingles, interaction: round2(b.e.delta - sumSingles), marginal: b.marginal,
      overlap: overlapOf(b.singles), warning: warningOf(b.e.delta, singles, b.marginal), ci: boot.ci, robust, holdout: b.e.holdout,
      affected: b.e.affectedIds.size, excluded: b.e.excluded, tradesLeft: b.e.tradesLeft, gates,
      beatsBest: b.e.delta > Math.max(...singles),
    };
  };
  const evals = built.map(evalOf);
  // The search's own sets come first; a new own set was appended after them and is shown apart.
  const combos = evals.slice(0, comboCount(blocks.length))
    .filter((x) => x.gates && x.beatsBest)
    .sort((a, b) => Number(b.robust) - Number(a.robust) || b.delta - a.delta || a.labels.join().localeCompare(b.labels.join()))
    .slice(0, opts.limit ?? 3);
  return {
    combos, own: ownIdx >= 0 ? evals[ownIdx] : null,
    searched: comboCount(blocks.length), singles: tried.length, family: family.length,
    blocks: blocks.map((r) => describeRule(r, lang)), smallSample, holdout: prep.train != null,
  };
}
