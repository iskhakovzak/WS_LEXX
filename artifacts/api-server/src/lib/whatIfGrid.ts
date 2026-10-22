/**
 * Grid of «Что ещё дало бы больше всего»: the single-rule candidates the suggestion search (lib/whatIfSuggest) tries.
 * The slots themselves live in lib/whatIfRecipes (stable ids, refittable on weighted days for the honest path);
 * this is the fast path's view of them. Every candidate is tagged
 *   - kind "exante" (known before the entry: time, price, day limits, IMX, re-entry, size) or "label" (depends on the
 *     trader's own marks: setups, mistakes, personal tags, grades — marks are also set after the trade);
 *   - picked: the candidate itself was chosen by its past result (worst tickers / setups / tags) — picked on the
 *     TRAIN days (the first two thirds of ≥ 30 days) so the search can check it on the later TEST days.
 * Pure, no I/O. Day quantiles come from trader-days, so team scope does not pool traders.
 * Never in the grid: commissionPlan (the desk does not choose broker fees), capLoss, minHold (known only at the exit).
 */
import { type CandidateKind, type FitView, dayIndicator, gridRecipes, unitWeights } from "./whatIfRecipes";
import { MAX_SETUP_LEN, type Rule, type SimTrade, netOf, round2, traderDayKey } from "./whatIfTypes";

export { type CandidateKind, GRID_MISTAKES, nice } from "./whatIfRecipes";
export interface GridCandidate { rule: Rule; kind: CandidateKind; picked: boolean }

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

/**
 * The candidates for these trades. `team` = the whole desk (no share-size caps, no personal tags); `train` = TRAIN days
 * (default: trainDays of the trades; null = no holdout, picked families use the whole period). Two quantile slots that
 * land on the same threshold give one candidate (the first).
 */
export function suggestionGrid(input: SimTrade[], opts: { team?: boolean; train?: ReadonlySet<string> | null } = {}): GridCandidate[] {
  const trades = input.filter((t) => t.gross != null);
  const train = opts.train === undefined ? trainDays(trades) : opts.train;
  const { days, recipes } = gridRecipes(trades, { team: opts.team === true });
  const all = unitWeights(days.length);
  const view: FitView = { pick: train ? dayIndicator(days, train) : all, all, minPick: train ? 7 : 10 };
  const out: GridCandidate[] = [];
  const seen = new Set<string>();
  for (const r of recipes) {
    const rule = r.fit(view);
    const key = rule && JSON.stringify(rule);
    if (!rule || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ rule, kind: r.kind, picked: r.picked });
  }
  return out;
}
