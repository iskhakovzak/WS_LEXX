/**
 * Core KPI helpers for rows already in memory (pure). The definitions (docs/one-truth/INVENTORY.md):
 *
 *   win rate         wins / (wins + losses); scratches (BE) and open trades excluded. «Винрейт» in the UI counts by the
 *                    stored result (winRateOf over result counts); the breakeven comparison counts by the NET sign
 *                    (winLossByNet) because its payoff is net — the UI calls that one «винрейт нетто».
 *   drawdown         of a window: the deepest fall of the end-of-day cumulative curve below its running peak (peak
 *                    starts at 0) — drawdownOf / maxDrawdownOfSeries. «Now from the peak» for the stop is the risk
 *                    desk's (lib/coreMetrics/risk), never recomputed here.
 *   profit factor    Σ positive / |Σ negative|; null without a loss (not «∞», not the count of wins)
 *   $ per trade      net / trades with $ data (the same trades the net is summed over)
 */
import { maxDrawdownOfSeries } from "../tradeMath";

/** The pure primitives (no DB): import them from here in code that must stay DB-free. */
export { closeDateSql, closedSql, decidedSql, maxDrawdownByDay, maxDrawdownOfSeries, netPnl, netPnlSql, normResult, payoffOf, resultSql, winRateOf } from "../tradeMath";
export { breakevenWinRate, edgeMargin, edgeMarginOf, MIN_SIDE, type EdgeMargin } from "./breakeven";

/** Rounded share (`digits` decimals), null-safe. */
export function roundShare(v: number | null, digits: number): number | null {
  if (v == null) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/** Wins / losses by the sign of the net result (0 and null are neither). */
export function winLossByNet(nets: Iterable<number | null | undefined>): { wins: number; losses: number } {
  let wins = 0, losses = 0;
  for (const v of nets) {
    if (v == null || !Number.isFinite(v) || v === 0) continue;
    if (v > 0) wins++;
    else losses++;
  }
  return { wins, losses };
}

/** Drawdown depth (≥ 0, $ or R) of the cumulative series of `values` in order — the positive twin of maxDrawdownOfSeries. */
export function drawdownOf(values: readonly number[]): number {
  return -maxDrawdownOfSeries([...values]) || 0;
}

/** Profit factor Σ positive / |Σ negative|; null without a negative value. */
export function profitFactorOf(values: Iterable<number | null | undefined>): number | null {
  let pos = 0, neg = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v > 0) pos += v;
    else neg += v;
  }
  return neg < 0 ? pos / Math.abs(neg) : null;
}

/** $ (or R) per trade: total / count; null without trades. */
export function perTrade(total: number | null, count: number): number | null {
  return total != null && count > 0 ? total / count : null;
}
