/**
 * The suggestion grid as stable, refittable slots («рецепты»). Every slot has a stable id and a `fit(view)` that makes
 * its data-dependent choices — size caps from qty quantiles, day limits from trader-day quantiles, the worst tickers /
 * setups / tags, the mistakes that qualify — on WEIGHTED calendar days:
 *   - the fast path (lib/whatIfGrid suggestionGrid): pick = the TRAIN days (or all), all = 1;
 *   - a walk-forward fold (lib/whatIfWalkForward): both = 1 on the fold's train days, 0 elsewhere;
 *   - a bootstrap replicate (lib/whatIfRepick): both = the replicate's day counts — a day drawn twice counts twice,
 *     «distinct trader-days» included, exactly as in the physically resampled data set.
 * Fixed slots do not depend on the data: their gate (enough pre-market entries, IMX, re-entries, grades …) is decided
 * once, on the whole base. Pure, no I/O. Never here: commissionPlan, capLoss, minHold, requireStop.
 */
import type { ErrorVocabCode } from "./tradingErrors";
import {
  MAX_SETUP_LEN, MAX_TAG_LEN, PREMARKET_STRATEGIES, type Rule, type SimTrade, gradeRank, netOf, round2, traderDayKey, weightedQuantileSorted,
} from "./whatIfTypes";

export type CandidateKind = "exante" | "label";

/** When the rule can be followed (Ф2): before the entry, during the trade, or only in review (marks set after it). */
export type Timing = "exante" | "inTrade" | "review";
export function timingOf(rule: Rule, kind: CandidateKind): Timing {
  if (kind === "label") return "review";
  return rule.type === "minHold" || rule.type === "capLoss" ? "inTrade" : "exante";
}

/** Mistakes known at the entry («oversize» is covered by the size rule). */
export const GRID_MISTAKES: readonly ErrorVocabCode[] = ["fomo", "offPlan", "earlyEntry", "revenge", "offSetup", "overtrading", "noStop"];

/** «Nice» threshold: below 100 → nearest 10, else nearest 50; null when it rounds to 0. */
export function nice(v: number): number | null {
  const r = v < 100 ? Math.round(v / 10) * 10 : Math.round(v / 50) * 50;
  return r > 0 ? r : null;
}

/** Weight per calendar day (index into the grid's `days`). */
export type Weights = ArrayLike<number>;

export interface FitView {
  /** Day weights of the PICK statistics (worst tickers / setups / tags). */
  pick: Weights;
  /** Day weights of the gates and quantiles (counts, trader-days, size / day-limit quantiles, mistakes, label bias). */
  all: Weights;
  /** Minimum trades of a picked ticker / setup / tag (7 on a train subset, 10 on a full-size view). */
  minPick: number;
}

export interface Recipe {
  /** Stable across folds and replicates. */
  id: string;
  /** Neighbour family for smoothing / the spike check; null = none. */
  family: string | null;
  /** Position inside the family. */
  order: number;
  kind: CandidateKind;
  /** Chosen by its own past result. */
  picked: boolean;
  /** A claim about the ORDER of trades inside the trader's day → the within-day permutation test. */
  ordering: boolean;
  /** The rule does not depend on the data (its gate is decided once, on the whole base). */
  fixed: boolean;
  fit(v: FitView): Rule | null;
}

export interface RecipeGrid {
  /** Sorted distinct days of the base (the index of every weight array; equals whatIfSuggest prepare().days). */
  days: string[];
  recipes: Recipe[];
}

export const unitWeights = (D: number): Float64Array => new Float64Array(D).fill(1);

/** 1 on the days of `set`, 0 elsewhere. */
export function dayIndicator(days: readonly string[], set: ReadonlySet<string>): Float64Array {
  return Float64Array.from(days, (d) => (set.has(d) ? 1 : 0));
}

/** The rule of every recipe on one view, in recipe order (null = the slot's gate fails on this view). */
export function fitRecipes(recipes: readonly Recipe[], view: FitView): (Rule | null)[] {
  return recipes.map((r) => r.fit(view));
}

/** Values sorted ascending with the day of each (the weighted quantiles). */
type Sorted = { v: Float64Array; d: Int32Array };
/** Trades carrying one mark: their indices and the day of each distinct trader-day. */
type Marked = { trades: Int32Array; tdays: Int32Array };
/** A picked key (ticker / setup / tag): per key its trades and the spelling on each, in trade order. */
type Keyed = { spell: string[][]; of: Int32Array[] };

interface Index {
  n: number;
  days: string[];
  day: Int32Array;
  net: Float64Array;
  losses: Sorted;
  greens: Sorted;
  sizes: Sorted;
  tickers: Keyed;
  /** Per trade: ticker id. */
  tickerOf: Int32Array;
  setups: Keyed;
  /** Per trade: setup id, −1 = none. */
  setupOf: Int32Array;
  mistakes: Marked[];
  tags: Keyed & { marked: Marked[] };
}

function sortedOf(values: number[], days: number[]): Sorted {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  return { v: Float64Array.from(order, (i) => values[i]), d: Int32Array.from(order, (i) => days[i]) };
}

function marked(trades: ArrayLike<number>, tdKey: string[], day: Int32Array): Marked {
  const seen = new Set<string>();
  const tdays: number[] = [];
  for (let k = 0; k < trades.length; k++) {
    const i = trades[k];
    if (!seen.has(tdKey[i])) { seen.add(tdKey[i]); tdays.push(day[i]); }
  }
  return { trades: Int32Array.from(trades), tdays: Int32Array.from(tdays) };
}

/** Groups the trades by key (ids in first-seen order); `keysOf` gives each trade's distinct keys and spellings. */
function keyed(trades: SimTrade[], keysOf: (t: SimTrade) => { key: string; name: string }[]): Keyed & { ofTrade: Int32Array } {
  const ids = new Map<string, number>();
  const spell: string[][] = [];
  const of: number[][] = [];
  const ofTrade = new Int32Array(trades.length).fill(-1);
  trades.forEach((t, i) => {
    for (const { key, name } of keysOf(t)) {
      let k = ids.get(key);
      if (k == null) { k = ids.size; ids.set(key, k); spell.push([]); of.push([]); }
      spell[k].push(name);
      of[k].push(i);
      ofTrade[i] = k;
    }
  });
  return { spell, of: of.map((a) => Int32Array.from(a)), ofTrade };
}

function indexTrades(trades: SimTrade[]): Index {
  const days = [...new Set(trades.map((t) => t.day))].sort((a, b) => a.localeCompare(b));
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const day = Int32Array.from(trades, (t) => dayIdx.get(t.day) as number);
  const net = Float64Array.from(trades, (t) => netOf(t) as number);
  const tdKey = trades.map(traderDayKey);
  // Trader-day nets, summed in trade order and rounded to cents (as lib/whatIfGrid traderDayResults).
  const td = new Map<string, { d: number; net: number }>();
  trades.forEach((t, i) => {
    const e = td.get(tdKey[i]) ?? { d: day[i], net: 0 };
    e.net += net[i];
    td.set(tdKey[i], e);
  });
  const tdList = [...td.values()].map((e) => ({ d: e.d, net: round2(e.net) }));
  const lossRows = tdList.filter((e) => e.net < 0), greenRows = tdList.filter((e) => e.net > 0);
  const sizeIdx = trades.map((t, i) => (t.qty != null && t.qty > 0 ? i : -1)).filter((i) => i >= 0);
  const tickers = keyed(trades, (t) => [{ key: t.ticker, name: t.ticker }]);
  // A rule takes setup names ≤ MAX_SETUP_LEN and tags ≤ MAX_TAG_LEN (routes/whatif ruleSchema).
  const setups = keyed(trades, (t) => {
    const s = t.setup?.trim();
    return s && s.length <= MAX_SETUP_LEN ? [{ key: s.toLowerCase(), name: s }] : [];
  });
  const tags = keyed(trades, (t) => {
    const out: { key: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const tag of t.ptags ?? []) {
      const k = tag.trim().toLowerCase();
      if (!k || k.length > MAX_TAG_LEN || seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, name: tag.trim() });
    }
    return out;
  });
  const mistakes = GRID_MISTAKES.map((code) => marked(trades.flatMap((t, i) => (t.mistakes?.includes(code) ? [i] : [])), tdKey, day));
  return {
    n: trades.length, days, day, net,
    losses: sortedOf(lossRows.map((e) => -e.net), lossRows.map((e) => e.d)),
    greens: sortedOf(greenRows.map((e) => e.net), greenRows.map((e) => e.d)),
    sizes: sortedOf(sizeIdx.map((i) => trades[i].qty as number), sizeIdx.map((i) => day[i])),
    tickers, tickerOf: tickers.ofTrade, setups, setupOf: setups.ofTrade, mistakes,
    tags: { ...tags, marked: tags.of.map((a) => marked(a, tdKey, day)) },
  };
}

/** ≥ 10 matching trades on ≥ 3 trader-days (whole base). */
function enough(trades: SimTrade[], match: (t: SimTrade) => boolean): boolean {
  let n = 0;
  const days = new Set<string>();
  for (const t of trades) if (match(t)) { n++; days.add(traderDayKey(t)); }
  return n >= 10 && days.size >= 3;
}

/** Weight of each sorted value (its day's weight) and their total. */
function weigh(s: Sorted, w: Weights): { w: Float64Array; W: number } {
  const out = new Float64Array(s.v.length);
  let W = 0;
  for (let i = 0; i < out.length; i++) { out[i] = w[s.d[i]]; W += out[i]; }
  return { w: out, W };
}

/** Weighted count / net / non-losing count / distinct trader-days of the trades carrying one mark. */
function markAgg(ix: Index, m: Marked, w: Weights): { n: number; net: number; nonLosing: number; days: number } {
  let n = 0, net = 0, nonLosing = 0, days = 0;
  for (const i of m.trades) {
    const x = w[ix.day[i]];
    if (!x) continue;
    n += x;
    net += x * ix.net[i];
    if (ix.net[i] >= 0) nonLosing += x;
  }
  for (const d of m.tdays) days += w[d];
  return { n, net, nonLosing, days };
}
/** Labelling-bias gate: a mark only on losers makes the dollar delta circular — ≥ 2 and ≥ 15% must be non-losing. */
const labelOk = (a: { n: number; nonLosing: number }) => a.nonLosing >= 2 && a.nonLosing >= 0.15 * a.n;

/** Spelling of key `k` on its first trade with a positive weight. */
function nameOf(ix: Index, g: Keyed, k: number, w: Weights): string {
  const trades = g.of[k];
  for (let i = 0; i < trades.length; i++) if (w[ix.day[trades[i]]] > 0) return g.spell[k][i];
  return g.spell[k][0];
}

/** Losing keys (ticker / setup) with ≥ minPick weighted trades, worst first (ties: name). */
function worstKeys(ix: Index, keyOf: Int32Array, keys: number, nameFor: (k: number) => string, v: FitView): string[] {
  const sum = new Float64Array(keys), cnt = new Float64Array(keys);
  for (let i = 0; i < ix.n; i++) {
    const k = keyOf[i];
    const x = v.pick[ix.day[i]];
    if (k < 0 || !x) continue;
    sum[k] += x * ix.net[i];
    cnt[k] += x;
  }
  const out: { name: string; net: number }[] = [];
  for (let k = 0; k < keys; k++) if (cnt[k] >= v.minPick && sum[k] < 0) out.push({ name: nameFor(k), net: sum[k] });
  return out.sort((a, b) => a.net - b.net || a.name.localeCompare(b.name)).map((e) => e.name);
}

/**
 * The 95 slots (72 of the committed grid, then the 23 of wave 2; team scope: no share-size caps and no personal tags), in
 * the committed grid's order. `base` = the
 * trades with a money result in simulation order (whatIfSuggest prepare().base) or in the caller's order.
 */
export function gridRecipes(base: SimTrade[], opts: { team?: boolean } = {}): RecipeGrid {
  const team = opts.team === true;
  const trades = base.filter((t) => t.gross != null);
  const ix = indexTrades(trades);
  const recipes: Recipe[] = [];
  const memo = new WeakMap<FitView, Map<string, unknown>>();
  const shared = <T>(v: FitView, key: string, f: () => T): T => {
    let m = memo.get(v);
    if (!m) { m = new Map(); memo.set(v, m); }
    if (!m.has(key)) m.set(key, f());
    return m.get(key) as T;
  };
  type Opts = { kind?: CandidateKind; ordering?: boolean; picked?: boolean };
  const fixed = (id: string, family: string | null, order: number, rule: Rule | null, o: Opts = {}) =>
    recipes.push({ id, family, order, kind: o.kind ?? "exante", picked: false, ordering: o.ordering ?? false, fixed: true, fit: () => rule });
  const fitted = (id: string, family: string | null, order: number, fit: (v: FitView) => Rule | null, o: Opts = {}) =>
    recipes.push({ id, family, order, kind: o.kind ?? "exante", picked: o.picked ?? false, ordering: o.ordering ?? false, fixed: false, fit });

  const hasTime = trades.some((t) => t.entryMin != null);
  const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const time = (rule: Rule, gate = true): Rule | null => (hasTime && gate ? rule : null);
  for (const to of ["10:30", "11:00", "11:30", "12:00", "13:00", "14:00", "15:00"]) fixed(`tw.to.${to}`, "tw.to", hm(to), time({ type: "timeWindow", to }));
  for (const from of ["09:35", "09:45", "10:00", "10:30"]) fixed(`tw.from.${from}`, "tw.from", hm(from), time({ type: "timeWindow", from }));
  // «Без премаркета» / «без входов после 16:00» only when there is enough of it.
  fixed("tw.from.09:30", "tw.from", hm("09:30"), time({ type: "timeWindow", from: "09:30" }, enough(trades, (t) => t.entryMin != null && t.entryMin < 570)));
  fixed("tw.to.16:00", "tw.to", hm("16:00"), time({ type: "timeWindow", to: "16:00" }, enough(trades, (t) => t.entryMin != null && t.entryMin >= 960)));
  fixed("tw.both.0930-1030", null, 0, time({ type: "timeWindow", from: "09:30", to: "10:30" }));
  fixed("tw.both.1000-1200", null, 0, time({ type: "timeWindow", from: "10:00", to: "12:00" }));
  for (const min of [2, 5, 10, 20, 50]) fixed(`price.min.${min}`, "price.min", min, { type: "priceRange", min });
  for (const max of [20, 50, 100, 200]) fixed(`price.max.${max}`, "price.max", max, { type: "priceRange", max });
  for (const n of [2, 3, 5, 8, 10]) fixed(`mtd.${n}`, "mtd", n, { type: "maxTradesPerDay", n }, { ordering: true });
  for (const n of [1, 2, 3]) fixed(`sal.${n}`, "sal", n, { type: "stopAfterLosses", n }, { ordering: true });
  for (const minutes of [2, 5, 10, 15, 30, 60]) fixed(`afterLoss.${minutes}`, "afterLoss", minutes, time({ type: "afterLoss", minutes }), { ordering: true });

  // Share-size caps relative to the trader's own sizes (one trader only: sizes of different traders do not compare).
  if (!team) {
    for (const p of [50, 75, 90]) {
      fitted(`size.p${p}`, "size", p, (v) => {
        const s = shared(v, "sizes", () => weigh(ix.sizes, v.all));
        if (s.W < 20) return null;
        const q = weightedQuantileSorted(ix.sizes.v, s.w, p / 100);
        const capped = q < 100 ? Math.max(1, Math.round(q / 10) * 10) : Math.round(q / 50) * 50;
        return capped > 0 ? { type: "sizeRange", max: capped } : null;
      });
    }
  }
  // Day limits from the trader-days (team scope: each trader's own day).
  for (const p of [50, 75, 90]) {
    fitted(`dll.p${p}`, "dll", p, (v) => {
      const s = shared(v, "losses", () => weigh(ix.losses, v.all));
      const usd = s.W >= 3 ? nice(weightedQuantileSorted(ix.losses.v, s.w, p / 100)) : null;
      return usd != null ? { type: "dailyLossLimit", usd } : null;
    }, { ordering: true });
  }
  fixed("side.long", null, 0, { type: "excludeSide", side: "long" });
  fixed("side.short", null, 0, { type: "excludeSide", side: "short" });

  const imx = trades.filter((t) => t.imx === true).length;
  fixed("imx", null, 0, imx >= 10 && trades.length - imx >= 30 ? { type: "excludeImx" } : null);
  fixed("reentry", null, 0, trades.filter((t) => t.reentry === true).length >= 10 ? { type: "noReentry" } : null);
  const rels = trades.map((t) => t.sizeRel).filter((v): v is number => v != null && v > 0);
  for (const x of [1.5, 2, 3]) fixed(`sizeRel.${x}`, "sizeRel", x, rels.length >= 20 && rels.filter((v) => v > x).length >= 10 ? { type: "maxSizeRel", x } : null);

  const greens = (v: FitView) => shared(v, "greens", () => weigh(ix.greens, v.all));
  const greenQ = (v: FitView, q: number) => { const s = greens(v); return s.W >= 10 ? nice(weightedQuantileSorted(ix.greens.v, s.w, q)) : null; };
  for (const pct of [30, 50]) {
    fitted(`giveback.${pct}`, "giveback", pct, (v) => { const peak = greenQ(v, 0.5); return peak != null ? { type: "profitGiveback", peak, pct } : null; }, { ordering: true });
  }
  for (const p of [75, 90]) {
    fitted(`target.p${p}`, "target", p, (v) => { const usd = greenQ(v, p / 100); return usd != null ? { type: "dailyProfitTarget", usd } : null; }, { ordering: true });
  }

  // Worst tickers / setups, picked by their own result on the pick days.
  const worstTickers = (v: FitView) => shared(v, "tickers", () => worstKeys(ix, ix.tickerOf, ix.tickers.of.length, (k) => ix.tickers.spell[k][0], v).slice(0, 3));
  for (const k of [1, 2, 3]) {
    fitted(`tickers.worst${k}`, null, 0, (v) => { const w = worstTickers(v)[k - 1]; return w != null ? { type: "excludeTickers", tickers: [w] } : null; }, { picked: true });
  }
  const worstSetups = (v: FitView) => shared(v, "setups", () => worstKeys(ix, ix.setupOf, ix.setups.of.length, (k) => nameOf(ix, ix.setups, k, v.pick), v));
  fitted("setups.worst1", null, 0, (v) => { const w = worstSetups(v); return w[0] != null ? { type: "excludeSetups", setups: [w[0]] } : null; }, { kind: "label", picked: true });
  fitted("setups.worst12", null, 0, (v) => { const w = worstSetups(v); return w[1] != null ? { type: "excludeSetups", setups: [w[0], w[1]] } : null; }, { kind: "label", picked: true });

  // Entry-time mistakes the trader marked (the labelling-bias gate keeps it honest).
  const qualifying = (v: FitView) => shared(v, "mistakes", () => GRID_MISTAKES.filter((_, c) => {
    const a = markAgg(ix, ix.mistakes[c], v.all);
    return a.n >= 8 && a.days >= 3 && a.net < 0 && labelOk(a);
  }));
  for (const code of GRID_MISTAKES) {
    fitted(`mistake.${code}`, null, 0, (v) => (qualifying(v).includes(code) ? { type: "excludeMistakes", codes: [code] } : null), { kind: "label" });
  }
  fitted("mistakes.all", null, 0, (v) => { const q = qualifying(v); return q.length >= 2 ? { type: "excludeMistakes", codes: [...q] } : null; }, { kind: "label" });

  // Personal tags (one trader only: every trader uses their own words), picked by their own result.
  if (!team) {
    const worstTags = (v: FitView) => shared(v, "tags", () => {
      const ok: { name: string; net: number }[] = [];
      ix.tags.marked.forEach((m, k) => {
        const all = markAgg(ix, m, v.all), pick = markAgg(ix, m, v.pick);
        if (all.n >= 10 && all.days >= 3 && pick.n >= v.minPick && pick.net < 0 && labelOk(all)) {
          ok.push({ name: nameOf(ix, ix.tags, k, v.all), net: pick.net });
        }
      });
      return ok.sort((a, b) => a.net - b.net || a.name.localeCompare(b.name)).map((e) => e.name);
    });
    fitted("tags.worst1", null, 0, (v) => { const w = worstTags(v); return w[0] != null ? { type: "excludeTags", tags: [w[0]] } : null; }, { kind: "label", picked: true });
    fitted("tags.worst12", null, 0, (v) => { const w = worstTags(v); return w[1] != null ? { type: "excludeTags", tags: [w[0], w[1]] } : null; }, { kind: "label", picked: true });
  }

  // Own grades: only when most trades are graded (the rule drops ungraded trades).
  const graded = trades.filter((t) => gradeRank(t.grade) != null).length;
  const gradesOk = graded >= 30 && graded >= 0.6 * trades.length;
  for (const [i, grade] of (["A", "B"] as const).entries()) fixed(`grade.${grade}`, "grade", i + 1, gradesOk ? { type: "minGrade", grade } : null, { kind: "label" });
  addWave2(recipes, trades, ix, { fixed, fitted, time, hasTime, hm, shared });
  return { days: ix.days, recipes };
}

type SlotMakers = {
  fixed: (id: string, family: string | null, order: number, rule: Rule | null, o?: { kind?: CandidateKind; ordering?: boolean }) => void;
  fitted: (id: string, family: string | null, order: number, fit: (v: FitView) => Rule | null, o?: { kind?: CandidateKind; ordering?: boolean }) => void;
  time: (rule: Rule, gate?: boolean) => Rule | null;
  hasTime: boolean;
  hm: (s: string) => number;
  shared: <T>(v: FitView, key: string, f: () => T) => T;
};

/**
 * Wave 2 families (appended after the committed grid, so its order and dedup never change). All known before the
 * entry; the ones about the order of trades inside the day are `ordering` (the within-day permutation guard):
 *   afterWin (a pause after a WIN), the day's red zone, blocked windows, a cap per ticker per day, no re-entry into a
 *   ticker soon after a loss in it, price bands, the pre-market family by strategy (only when the entry times cannot
 *   say it — else «без премаркета» is the same rule), stocks reporting earnings that day (the calendar is known ahead).
 */
function addWave2(recipes: Recipe[], trades: SimTrade[], ix: Index, m: SlotMakers): void {
  const { fixed, fitted, time, hasTime, hm, shared } = m;
  for (const minutes of [2, 5, 10, 15, 30]) fixed(`afterWin.${minutes}`, "afterWin", minutes, time({ type: "afterWin", minutes }), { ordering: true });
  // Red zone: from the trader's own losing days — the median losing day starts the zone, then 1 or 2 more entries.
  for (const [p, k] of [[50, 1], [50, 2], [25, 2]] as const) {
    fitted(`redZone.p${p}.k${k}`, `redZone.k${k}`, p, (v) => {
      const s = shared(v, "losses", () => weigh(ix.losses, v.all));
      const usd = s.W >= 3 ? nice(weightedQuantileSorted(ix.losses.v, s.w, p / 100)) : null;
      return usd != null ? { type: "redZone", usd, k } : null;
    }, { ordering: true });
  }
  for (const [from, to] of [["09:30", "09:35"], ["09:30", "09:45"], ["11:30", "13:30"], ["15:00", "16:00"]] as const) {
    fixed(`block.${from}-${to}`, null, hm(from), time({ type: "blockWindow", from, to }));
  }
  for (const n of [1, 2, 3]) fixed(`mtt.${n}`, "mtt", n, { type: "maxTradesPerTicker", n }, { ordering: true });
  for (const minutes of [5, 15, 30]) fixed(`reentryLoss.${minutes}`, "reentryLoss", minutes, time({ type: "noReentryAfterLoss", minutes }), { ordering: true });
  for (const [min, max] of [[2, 20], [5, 50], [10, 100]] as const) fixed(`price.band.${min}-${max}`, null, min, { type: "priceRange", min, max });
  const premarketByTime = hasTime && enough(trades, (t) => t.entryMin != null && t.entryMin < 570);
  const premarketByStrategy = enough(trades, (t) => t.strategy != null && PREMARKET_STRATEGIES.includes(t.strategy));
  fixed("strategy.premarket", null, 0, !premarketByTime && premarketByStrategy ? { type: "excludeStrategies", strategies: [...PREMARKET_STRATEGIES] } : null);
  const earn = trades.filter((t) => t.earnings === true).length;
  fixed("earnings", null, 0, enough(trades, (t) => t.earnings === true) && trades.length - earn >= 30 ? { type: "excludeEarnings" } : null);
}
