-- Breakdown panel v3 (2026-10-21): adds / stop / size vs usual (/trades, /stats), plus the new
-- entry kind «aggressive» and exit kind «flip». Derived per-trade values written by the same TypeScript pass as 0241
-- (api lib/tradeStrategyStore + lib/tradeFacetDerive; job trades.strategy-backfill and the PropReports sync). Nullable,
-- no defaults: adding them rewrites nothing. STRATEGY_VERSION 3 makes every signature stale, so the backfill fills
-- every row once.
--   adds_kind   none | pyramid | average | mixed     (entry_kind now also «aggressive», exit_kind also «flip»)
--   size_rel    notional ÷ the trader's median notional of the previous 60 calendar days (≥ 10 trades), a ratio
--   has_stop    a stop price is known (trades.stop, or the structure's stopPrice)
-- size_rel looks back 60 days (SIZE_REL_DAYS in lib/tradeFacetBuckets): a refresh re-derives the following 60 days of
-- every trader-day it touches. The triggers below do the same for a trade that LEAVES a trader-day (trader / date
-- changed, hard delete): the old day and that trader's following 60 days go stale — before, only the old day did.
-- The 0241 stale trigger also watches trades.stop now (has_stop).

ALTER TABLE trades ADD COLUMN IF NOT EXISTS adds_kind text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS size_rel numeric(12, 4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS has_stop boolean;

-- "YYYY-MM-DD" + 60 days (the last day whose size_rel can read `d`); a date that does not parse stays as it is.
CREATE OR REPLACE FUNCTION trades_size_rel_until(d text) RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF d IS NULL OR d !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN d;
  END IF;
  RETURN to_char(d::date + 60, 'YYYY-MM-DD');
EXCEPTION WHEN others THEN
  RETURN d;
END
$$;

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
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.stop IS DISTINCT FROM OLD.stop THEN
    NEW.strategy_sig := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trades_strategy_stale_trg ON trades;
CREATE TRIGGER trades_strategy_stale_trg
  BEFORE UPDATE OF ticker, date, exit_date, horizon, session, qty, entry, context_snapshot,
                   trader, pnl, fees, result, hold_time, structure, reentry_of, deleted_at, stop ON trades
  FOR EACH ROW EXECUTE FUNCTION trades_strategy_stale();

-- A trade moved to another trader / day: its OLD trader-day and that trader's following 60 days are re-derived.
CREATE OR REPLACE FUNCTION trades_day_left_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE trades SET strategy_sig = NULL
   WHERE strategy_sig IS NOT NULL AND id <> OLD.id
     AND COALESCE(trader, '') = COALESCE(OLD.trader, '')
     AND LEFT(date, 10) >= LEFT(OLD.date, 10) AND LEFT(date, 10) <= trades_size_rel_until(LEFT(OLD.date, 10));
  RETURN NULL;
END
$$;

-- Hard deletes (statement level: one UPDATE per statement): the remaining trades of those trader-days and of the
-- following 60 days are re-derived.
CREATE OR REPLACE FUNCTION trades_day_deleted_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE trades t SET strategy_sig = NULL
    FROM (SELECT DISTINCT COALESCE(o.trader, '') AS tr, LEFT(o.date, 10) AS d FROM old_rows o) g
   WHERE t.strategy_sig IS NOT NULL AND COALESCE(t.trader, '') = g.tr
     AND LEFT(t.date, 10) >= g.d AND LEFT(t.date, 10) <= trades_size_rel_until(g.d);
  RETURN NULL;
END
$$;
