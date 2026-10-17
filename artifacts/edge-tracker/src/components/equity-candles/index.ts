/**
 * Equity curve from daily / weekly candles (lightweight-charts 5).
 *
 *   import { EquityCandles } from "@/components/equity-candles";
 *   <Panel title="Кривая капитала"><EquityCandles trades={trades} trader="Ориф" /></Panel>
 */
export { EquityCandles, type EquityCandlesProps } from "./EquityCandles";
export {
  buildCandles, buildDayCandles, toWeekCandles, summarize, filterPeriod, periodStart, soleTrader, dayReportHref, tradeValue, closeTimeKey,
  weekStart, fmtValue as fmtEquityValue,
  type EquityCandle, type EquitySummary, type EquityTradeInput, type EquityUnit, type EquityAgg, type EquityPeriod,
} from "./lib";
