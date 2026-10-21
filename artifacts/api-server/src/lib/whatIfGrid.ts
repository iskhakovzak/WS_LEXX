/**
 * Grid of «Что ещё дало бы больше всего»: the single-rule candidates the suggestion search (lib/whatIfSuggest) tries.
 * Every candidate is tagged
 *   - kind "exante" (known before the entry: time, price, day limits, IMX, re-entry, size) or "label" (depends on the
 *     trader's own marks: setups, mistakes, personal tags, grades — marks are also set after the trade);
 *   - picked: the candidate itself was chosen by its past result (worst tickers / setups / tags) — picked on the
 *     TRAIN days (the first two thirds of ≥ 30 days) so the search can check it on the later TEST days.
 * Pure, no I/O. Day quantiles come from trader-days (traderDayResults), so team scope does not pool traders.
 * Never in the grid: commissionPlan (the desk does not choose broker fees), capLoss, minHold (known only at the exit).
 */
import type { ErrorVocabCode } from "./tradingErrors";
import { MAX_SETUP_LEN, MAX_TAG_LEN, type Rule, type SimTrade, gradeRank, netOf, quantileSorted, round2, traderDayKey } from "./whatIfTypes";

export type CandidateKind = "exante" | "label";
export interface GridCandidate { rule: Rule; kind: CandidateKind; picked: boolean }

/** Mistakes known at the entry («oversize» is covered by the size rule). */
export const GRID_MISTAKES: readonly ErrorVocabCode[] = ["fomo", "offPlan", "earlyEntry", "revenge", "offSetup", "overtrading", "noStop"];

/** «Nice» threshold: below 100 → nearest 10, else nearest 50; null when it rounds to 0. */
export function nice(v: number): number | null {
  const r = v < 100 ? Math.round(v / 10) * 10 : Math.round(v / 50) * 50;
  return r > 0 ? r : null;
}

export interface TraderDay { trader: string; day: string; net: number; trades: number }

/** Net per trader-day (trader "" = unknown), in day order. Trades without gross are skipped. */
export function traderDayResults(trades: SimTrade[]): TraderDay[] {
  const map = new Map<string, TraderDay>();
  for (const t of trades) {
    const net = netOf(t);
    if (net == null) continue;
    const k = traderDayKey(t);
    const d = map.get(k) ?? { trader: t.trader ?? "", day: t.day, net: 0, trades: 0 };
    d.net += net;
    d.trades++;
    map.set(k, d);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day) || a.trader.localeCompare(b.trader)).map((d) => ({ ...d, net: round2(d.net) }));
}

/** TRAIN days for picked candidates: the first ⌊2D/3⌋ of D ≥ 30 distinct days (sorted); null = no holdout. */
export function trainDays(trades: SimTrade[]): Set<string> | null {
  const days = [...new Set(trades.filter((t) => t.gross != null).map((t) => t.day))].sort((a, b) => a.localeCompare(b));
  if (days.length < 30) return null;
  return new Set(days.slice(0, Math.floor((2 * days.length) / 3)));
}

/**
 * Losing setups (≥ `minTrades` trades, negative net), worst first: the single worst, then the worst two together.
 * Empty when the trades carry no setups.
 */
export function worstSetups(trades: SimTrade[], minTrades = 10): string[][] {
  const by = new Map<string, { name: string; net: number; n: number }>();
  for (const t of trades) {
    const net = netOf(t);
    // A rule takes setup names ≤ MAX_SETUP_LEN (ruleSchema): a longer one could never be applied.
    if (net == null || !t.setup?.trim() || t.setup.trim().length > MAX_SETUP_LEN) continue;
    const k = t.setup.trim().toLowerCase();
    const e = by.get(k) ?? { name: t.setup.trim(), net: 0, n: 0 };
    e.net += net; e.n++;
    by.set(k, e);
  }
  const losing = [...by.values()].filter((e) => e.n >= minTrades && e.net < 0).sort((a, b) => a.net - b.net || a.name.localeCompare(b.name));
  const out: string[][] = [];
  if (losing[0]) out.push([losing[0].name]);
  if (losing[1]) out.push([losing[0].name, losing[1].name]);
  return out;
}

/** Trades carrying a mark: count, net, non-losing trades and trader-days (for the gates below). */
type Agg = { n: number; net: number; nonLosing: number; days: Set<string> };
const agg = (): Agg => ({ n: 0, net: 0, nonLosing: 0, days: new Set() });
function add(a: Agg, t: SimTrade, net: number): void {
  a.n++;
  a.net += net;
  if (net >= 0) a.nonLosing++;
  a.days.add(traderDayKey(t));
}
/** Labelling-bias gate: a mark only on losers makes the dollar delta circular — ≥ 2 and ≥ 15% must be non-losing. */
const labelOk = (a: Agg) => a.nonLosing >= 2 && a.nonLosing >= 0.15 * a.n;

/** ≥ 10 matching trades on ≥ 3 trader-days. */
function enough(trades: SimTrade[], match: (t: SimTrade) => boolean): boolean {
  let n = 0;
  const days = new Set<string>();
  for (const t of trades) if (match(t)) { n++; days.add(traderDayKey(t)); }
  return n >= 10 && days.size >= 3;
}

function niceSet(sorted: number[], qs: number[]): number[] {
  const out = new Set<number>();
  for (const q of qs) { const v = nice(quantileSorted(sorted, q)); if (v != null) out.add(v); }
  return [...out];
}

/**
 * The candidates for these trades. `team` = the whole desk (no share-size caps, no personal tags); `train` = TRAIN days
 * (default: trainDays of the trades; null = no holdout, picked families use the whole period).
 */
export function suggestionGrid(input: SimTrade[], opts: { team?: boolean; train?: ReadonlySet<string> | null } = {}): GridCandidate[] {
  const team = opts.team === true;
  const trades = input.filter((t) => t.gross != null);
  const train = opts.train === undefined ? trainDays(trades) : opts.train;
  const inTrain = (t: SimTrade) => train == null || train.has(t.day);
  const out: GridCandidate[] = [];
  const ex = (rule: Rule, picked = false) => out.push({ rule, kind: "exante", picked });
  const lb = (rule: Rule, picked = false) => out.push({ rule, kind: "label", picked });

  const hasTime = trades.some((t) => t.entryMin != null);
  if (hasTime) {
    for (const to of ["10:30", "11:00", "11:30", "12:00", "13:00", "14:00", "15:00"]) ex({ type: "timeWindow", to });
    for (const from of ["09:35", "09:45", "10:00", "10:30"]) ex({ type: "timeWindow", from });
    // «Без премаркета» / «без входов после 16:00» only when there is enough of it.
    if (enough(trades, (t) => t.entryMin != null && t.entryMin < 570)) ex({ type: "timeWindow", from: "09:30" });
    if (enough(trades, (t) => t.entryMin != null && t.entryMin >= 960)) ex({ type: "timeWindow", to: "16:00" });
    ex({ type: "timeWindow", from: "09:30", to: "10:30" });
    ex({ type: "timeWindow", from: "10:00", to: "12:00" });
  }
  for (const min of [2, 5, 10, 20, 50]) ex({ type: "priceRange", min });
  for (const max of [20, 50, 100, 200]) ex({ type: "priceRange", max });
  for (const n of [2, 3, 5, 8, 10]) ex({ type: "maxTradesPerDay", n });
  for (const n of [1, 2, 3]) ex({ type: "stopAfterLosses", n });
  if (hasTime) for (const minutes of [2, 5, 10, 15, 30, 60]) ex({ type: "afterLoss", minutes });

  // Share-size caps relative to the trader's own sizes (one trader only: sizes of different traders do not compare).
  const sizes = team ? [] : trades.map((t) => t.qty).filter((q): q is number => q != null && q > 0).sort((a, b) => a - b);
  if (sizes.length >= 20) {
    const caps = new Set<number>();
    for (const q of [0.5, 0.75, 0.9]) {
      const v = quantileSorted(sizes, q);
      const capped = v < 100 ? Math.max(1, Math.round(v / 10) * 10) : Math.round(v / 50) * 50;
      if (capped > 0) caps.add(capped);
    }
    for (const max of caps) ex({ type: "sizeRange", max });
  }

  // Day limits from the trader-days (team scope: each trader's own day).
  const tdays = traderDayResults(trades);
  const losses = tdays.filter((d) => d.net < 0).map((d) => -d.net).sort((a, b) => a - b);
  if (losses.length >= 3) for (const usd of niceSet(losses, [0.5, 0.75, 0.9])) ex({ type: "dailyLossLimit", usd });
  ex({ type: "excludeSide", side: "long" });
  ex({ type: "excludeSide", side: "short" });

  const imx = trades.filter((t) => t.imx === true).length;
  if (imx >= 10 && trades.length - imx >= 30) ex({ type: "excludeImx" });
  if (trades.filter((t) => t.reentry === true).length >= 10) ex({ type: "noReentry" });
  const rels = trades.map((t) => t.sizeRel).filter((v): v is number => v != null && v > 0);
  if (rels.length >= 20) for (const x of [1.5, 2, 3]) if (rels.filter((v) => v > x).length >= 10) ex({ type: "maxSizeRel", x });

  const greens = tdays.filter((d) => d.net > 0).map((d) => d.net).sort((a, b) => a - b);
  if (greens.length >= 10) {
    const peak = nice(quantileSorted(greens, 0.5));
    if (peak != null) for (const pct of [30, 50]) ex({ type: "profitGiveback", peak, pct });
    for (const usd of niceSet(greens, [0.75, 0.9])) ex({ type: "dailyProfitTarget", usd });
  }

  // Worst tickers, picked on TRAIN.
  const byTicker = new Map<string, { net: number; n: number }>();
  for (const t of trades) {
    if (!inTrain(t)) continue;
    const e = byTicker.get(t.ticker) ?? { net: 0, n: 0 };
    e.net += netOf(t) as number; e.n++;
    byTicker.set(t.ticker, e);
  }
  const minPick = train ? 7 : 10;
  const worst = [...byTicker.entries()].filter(([, e]) => e.n >= minPick && e.net < 0).sort((a, b) => a[1].net - b[1].net || a[0].localeCompare(b[0])).slice(0, 3);
  for (const [ticker] of worst) ex({ type: "excludeTickers", tickers: [ticker] }, true);
  for (const setups of worstSetups(train ? trades.filter(inTrain) : trades, minPick)) lb({ type: "excludeSetups", setups }, true);

  // Entry-time mistakes the trader marked (whole period; the labelling-bias gate keeps it honest).
  const qualifying: ErrorVocabCode[] = [];
  for (const code of GRID_MISTAKES) {
    const a = agg();
    for (const t of trades) if (t.mistakes?.includes(code)) add(a, t, netOf(t) as number);
    if (a.n >= 8 && a.days.size >= 3 && a.net < 0 && labelOk(a)) qualifying.push(code);
  }
  for (const code of qualifying) lb({ type: "excludeMistakes", codes: [code] });
  if (qualifying.length >= 2) lb({ type: "excludeMistakes", codes: [...qualifying] });

  // Personal tags (one trader only: every trader uses their own words), picked on TRAIN.
  if (!team) {
    const by = new Map<string, { name: string; all: Agg; train: Agg }>();
    for (const t of trades) {
      if (!t.ptags?.length) continue;
      const net = netOf(t) as number;
      const seen = new Set<string>();
      for (const tag of t.ptags) {
        const k = tag.trim().toLowerCase();
        // A rule takes tags ≤ MAX_TAG_LEN (ruleSchema): a longer one would be a card the server refuses to run.
        if (!k || k.length > MAX_TAG_LEN || seen.has(k)) continue;
        seen.add(k);
        const e = by.get(k) ?? { name: tag.trim(), all: agg(), train: agg() };
        add(e.all, t, net);
        if (inTrain(t)) add(e.train, t, net);
        by.set(k, e);
      }
    }
    const pickNet = (e: { all: Agg; train: Agg }) => (train ? e.train.net : e.all.net);
    const ok = [...by.values()]
      .filter((e) => e.all.n >= 10 && e.all.days.size >= 3 && (!train || e.train.n >= 7) && pickNet(e) < 0 && labelOk(e.all))
      .sort((a, b) => pickNet(a) - pickNet(b) || a.name.localeCompare(b.name));
    if (ok[0]) lb({ type: "excludeTags", tags: [ok[0].name] }, true);
    if (ok[1]) lb({ type: "excludeTags", tags: [ok[0].name, ok[1].name] }, true);
  }

  // Own grades: only when most trades are graded (the rule drops ungraded trades).
  const graded = trades.filter((t) => gradeRank(t.grade) != null).length;
  if (graded >= 30 && graded >= 0.6 * trades.length) for (const grade of ["A", "B"] as const) lb({ type: "minGrade", grade });
  return out;
}
