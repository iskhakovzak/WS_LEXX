/**
 * «One truth» — the ONE server module for the five core numbers (docs/one-truth/INVENTORY.md). Every reader (dashboard,
 * mentor, capital engine, leak guard, junior cost, curator / benchmark, Telegram texts) takes them from here; the check
 * scripts/checks/check-core-metrics.mjs fails a formula written anywhere else.
 *
 *   net P&L          pnl − |fees|, booked on the close date (netPnlSql / closeDateSql / netPnl)
 *   win rate         wins / (wins + losses), BE and open excluded (winRateOf; by net sign: winLossByNet)
 *   drawdown         of a window: maxDrawdownOfSeries / maxDrawdownByDay / drawdownOf (end-of-day curve, peak from 0)
 *                    from the peak NOW (the stop): riskStateOf / riskSummary / drawdownsFromPeak — the risk desk's
 *   breakeven        breakevenWinRate / edgeMargin (net results, ≥ 5 wins and 5 losses)
 *   payoff / PF      payoffOf / profitFactorOf; $ per trade: perTrade
 *
 * The SQL fragments and the JS primitives live in lib/tradeMath.ts (mirrored on the web by src/lib/trade-math.ts) and
 * the stop state machine in lib/riskMetrics.ts; this module is their public face.
 */
export {
  closeDateSql, closedSql, decidedSql, netPnlSql, resultSql, signedRSql,
  maxDrawdownByDay, maxDrawdownOfSeries, netPnl, normResult, payoffOf, signedR, winRateOf,
} from "../tradeMath";
export { breakevenWinRate, edgeMargin, edgeMarginOf, MIN_SIDE, type EdgeMargin } from "./breakeven";
export { drawdownOf, perTrade, profitFactorOf, roundShare, winLossByNet } from "./kpi";
export { drawdownsFromPeak, riskStateOf, riskSummary, UNKNOWN_RISK, type RiskState, type RiskSummary } from "./risk";
