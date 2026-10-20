/**
 * Window of the plain list GET /api/trades (Волна 2, п. 2.15): the endpoint never returns the whole book any more.
 *   - from (and optionally to): a date window of at most MAX_WINDOW_DAYS days (to defaults to today, New York);
 *   - limit: the newest N trades by trade date;
 *   - neither: the newest DEFAULT_LIMIT trades (callers that want everything walk GET /trades/page by cursor).
 * Pure (unit-tested in __tests__/tradesListWindow.test.ts); routes/trades.ts turns `tooLong` into RANGE_TOO_LONG.
 */
import { nyDate } from "./tradingDate";

export const TRADES_LIST_DEFAULT_LIMIT = 500;
export const TRADES_LIST_MAX_LIMIT = 5000;
export const TRADES_LIST_MAX_WINDOW_DAYS = 400;

const dayNo = (ymd: string): number => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;

export type TradesListWindow =
  | { ok: true; limit: number | null }
  | { ok: false; tooLong: true; max: number };

/** Resolve the row cap for a list request; `limit` null = bounded by the date window alone. */
export function tradesListWindow(q: { from?: string; to?: string; limit?: number }, today: string = nyDate()): TradesListWindow {
  if (q.from) {
    const span = dayNo(q.to ?? today) - dayNo(q.from);
    if (span > TRADES_LIST_MAX_WINDOW_DAYS) return { ok: false, tooLong: true, max: TRADES_LIST_MAX_WINDOW_DAYS };
    return { ok: true, limit: q.limit != null ? Math.min(q.limit, TRADES_LIST_MAX_LIMIT) : null };
  }
  return { ok: true, limit: Math.min(q.limit ?? TRADES_LIST_DEFAULT_LIMIT, TRADES_LIST_MAX_LIMIT) };
}
