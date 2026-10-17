/**
 * Equity curve as candles — the data layer (pure functions). The chart itself is <EquityChart> in
 * @/components/equity-chart (own canvas engine), which builds on these candles.
 *
 *   import { buildDayCandles } from "@/components/equity-candles";
 */
export {
  buildCandles, buildDayCandles, toWeekCandles, summarize, filterPeriod, periodStart, soleTrader, dayReportHref, tradeValue, closeTimeKey,
  weekStart, fmtValue as fmtEquityValue,
  type EquityCandle, type EquitySummary, type EquityTradeInput, type EquityUnit, type EquityAgg, type EquityPeriod,
} from "./lib";
