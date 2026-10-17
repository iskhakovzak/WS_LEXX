/** Trade-day window for the chart's candle request. Pure (today injectable). */
import { addDays, nyDate, prevWeekday } from "@/lib/trading-date";
import type { TradeLike } from "../types";

/** Age of a YYYY-MM-DD day in calendar days relative to `today` (YYYY-MM-DD). */
function ageDays(day: string, today: string): number {
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000;
}

/**
 * Trade-day window: from `contextDays` trading days before the entry day to the exit day (or today for open multi-day).
 * Context never costs resolution: the server serves 1-minute bars only for days ≤ 7 days old (5-minute ≤ 60), and the
 * OLDEST day of the range decides the interval — so context days that would push a fresh trade from 1m to 5m (or from
 * 5m to 60m) are dropped. `today` is injectable for tests.
 */
export function tradeWindow(trade: TradeLike, contextDays: number, today: string = nyDate()): { dateKey: string; toKey: string; fromKey: string; multiDay: boolean } {
  const dateKey = (trade.date || "").slice(0, 10);
  const multiDay = trade.horizon === "overnight" || trade.horizon === "swing";
  const exitKey = trade.exitDate ? trade.exitDate.slice(0, 10) : null;
  let toKey = dateKey;
  if (multiDay) {
    if (exitKey && exitKey > dateKey) toKey = exitKey;
    else if (trade.result === "open") toKey = today;
    else toKey = addDays(dateKey, trade.horizon === "swing" ? 5 : 1);
  }
  if (toKey > today) toKey = today;
  const limit = ageDays(dateKey, today) <= 7 ? 7 : ageDays(dateKey, today) <= 60 ? 60 : Infinity;
  let fromKey = dateKey;
  for (let i = 0; i < Math.max(0, contextDays); i++) {
    const prev = prevWeekday(fromKey);
    if (ageDays(prev, today) > limit) break;
    fromKey = prev;
  }
  return { dateKey, toKey, fromKey, multiDay };
}

