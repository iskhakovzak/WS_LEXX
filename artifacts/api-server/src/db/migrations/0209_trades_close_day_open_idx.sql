-- no-transaction
-- Review 2026-10-18 (speed of GET /curator/today and the risk views). Two hot queries scanned the whole trades table
-- (~3 KB a row: the context snapshot) on every call:
--
--   • per-trader day aggregates by the CLOSE day — lib/daily/costQueue (curator queue by money: 45-day history and the
--     window's trades), lib/daily/curatorFocus, routes/risk loadDaily, benchmark / academy reports — filter on
--     LEFT(COALESCE(NULLIF(exit_date, ''), date), 10) (lib/tradeMath closeDateSql) together with trader = $1 / ANY($1):
--     213 ms → 8 ms and 70 ms → 0.7 ms on the local desk data (45k trades);
--   • open positions — routes/risk loadPositions (desk snapshot of /curator/today, /risk): 74 ms → 0.02 ms;
--   • the desk by CLOSE day without a trader filter — lib/topDayStore (top of the day: calendar, day lists, trader-day)
--     and the day alias roster (lib/deskDayStore deskRoster).
--
-- Expressions and the partial predicate are written exactly as the queries spell them (the planner matches them
-- literally). CONCURRENTLY + IF NOT EXISTS: no write lock on trades, safe to re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS trades_live_trader_close_day_idx
  ON trades (trader, (LEFT(COALESCE(NULLIF(exit_date, ''), date), 10)))
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS trades_live_open_idx
  ON trades (date, id)
  WHERE deleted_at IS NULL
    AND (LOWER(TRIM(result)) = 'open' OR ((result IS NULL OR TRIM(result) = '') AND NULLIF(exit_date, '') IS NULL AND exit IS NULL));

CREATE INDEX CONCURRENTLY IF NOT EXISTS trades_live_close_day_idx
  ON trades ((LEFT(COALESCE(NULLIF(exit_date, ''), date), 10)))
  WHERE deleted_at IS NULL;
