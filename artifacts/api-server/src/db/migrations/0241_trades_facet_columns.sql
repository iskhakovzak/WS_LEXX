-- no-transaction
-- Filters panel v2 (2026-10-21): more columns in «Фильтры» (/trades, /stats). Derived per-trade values, written by the
-- same TypeScript pass as the strategy (api lib/tradeStrategyStore + lib/tradeFacetDerive; job trades.strategy-backfill
-- and the PropReports sync). Nullable, no defaults: adding them rewrites nothing. The backfill fills every row once
-- (STRATEGY_VERSION 2 makes every signature stale).
--   hold_sec    seconds held (structure firstAt → lastAt, else the broker's openedAt → closedAt, else hold_time)
--   overnight   closed on a later New York date than opened
--   entry_kind  single | scaled | reentry           exit_kind  whole | partials | stopped
--   notional    max position × average entry, $     day_seq    order of the trade in the trader's NY day (entry_sec, id)
--   prev_kind   first | after-win | after-loss | after-be (net result of the previous trade of that trader-day)
-- day_seq / prev_kind depend on the neighbours: a refresh re-derives whole trader-days, found by trades_trader_day_idx.
-- The 0237 stale trigger now also watches the new inputs (trader, pnl, fees, result, hold_time, structure, reentry_of,
-- deleted_at); a trade that leaves a trader-day (trader / date changed, hard delete) marks its old neighbours stale.
-- Every statement is idempotent (the file runs outside a transaction for CREATE INDEX CONCURRENTLY).

ALTER TABLE trades ADD COLUMN IF NOT EXISTS hold_sec integer;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS overnight boolean;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_kind text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_kind text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS day_seq integer;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS prev_kind text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS notional numeric(14, 2);

CREATE INDEX CONCURRENTLY IF NOT EXISTS trades_trader_day_idx ON trades ((COALESCE(trader, '')), (LEFT(date, 10)));

CREATE OR REPLACE FUNCTION trades_strategy_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticker IS DISTINCT FROM OLD.ticker OR NEW.date IS DISTINCT FROM OLD.date OR NEW.exit_date IS DISTINCT FROM OLD.exit_date
     OR NEW.horizon IS DISTINCT FROM OLD.horizon OR NEW.session IS DISTINCT FROM OLD.session
     OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.entry IS DISTINCT FROM OLD.entry
     OR (NEW.context_snapshot ->> 'openedAt') IS DISTINCT FROM (OLD.context_snapshot ->> 'openedAt')
     OR (NEW.context_snapshot ->> 'closedAt') IS DISTINCT FROM (OLD.context_snapshot ->> 'closedAt')
     OR NEW.trader IS DISTINCT FROM OLD.trader OR NEW.pnl IS DISTINCT FROM OLD.pnl OR NEW.fees IS DISTINCT FROM OLD.fees
     OR NEW.result IS DISTINCT FROM OLD.result OR NEW.hold_time IS DISTINCT FROM OLD.hold_time
     OR NEW.structure IS DISTINCT FROM OLD.structure OR NEW.reentry_of IS DISTINCT FROM OLD.reentry_of
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    NEW.strategy_sig := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trades_strategy_stale_trg ON trades;
CREATE TRIGGER trades_strategy_stale_trg
  BEFORE UPDATE OF ticker, date, exit_date, horizon, session, qty, entry, context_snapshot,
                   trader, pnl, fees, result, hold_time, structure, reentry_of, deleted_at ON trades
  FOR EACH ROW EXECUTE FUNCTION trades_strategy_stale();

-- A trade moved to another trader / day: its OLD neighbours are re-derived too (the moved row itself is stale above).
CREATE OR REPLACE FUNCTION trades_day_left_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE trades SET strategy_sig = NULL
   WHERE strategy_sig IS NOT NULL AND id <> OLD.id
     AND (COALESCE(trader, ''), LEFT(date, 10)) = (COALESCE(OLD.trader, ''), LEFT(OLD.date, 10));
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trades_day_left_trg ON trades;
CREATE TRIGGER trades_day_left_trg
  AFTER UPDATE OF trader, date ON trades
  FOR EACH ROW WHEN (OLD.trader IS DISTINCT FROM NEW.trader OR LEFT(OLD.date, 10) IS DISTINCT FROM LEFT(NEW.date, 10))
  EXECUTE FUNCTION trades_day_left_stale();

-- Hard deletes (statement level: one UPDATE per statement): the remaining trades of those trader-days are re-derived.
CREATE OR REPLACE FUNCTION trades_day_deleted_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE trades t SET strategy_sig = NULL
    FROM (SELECT DISTINCT COALESCE(o.trader, '') AS tr, LEFT(o.date, 10) AS d FROM old_rows o) g
   WHERE t.strategy_sig IS NOT NULL AND (COALESCE(t.trader, ''), LEFT(t.date, 10)) = (g.tr, g.d);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trades_day_deleted_trg ON trades;
CREATE TRIGGER trades_day_deleted_trg AFTER DELETE ON trades
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trades_day_deleted_stale();
