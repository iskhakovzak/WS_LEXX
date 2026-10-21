-- Owner strategy set (2026-10-21, lib/tradeStrategy): OPG = pre-market round trip (closed before the open print);
-- Print = a pre-market position closed by the opening print — flat in [09:30:00, 09:30:01] (the cross + report lag), or
-- (NYSE-style auctions open at a random time) exited before 09:45:00 at the SAME second as the pre-market positions of
-- >= 3 distinct desk traders in the same ticker on the same NY day; OPGtoDAY = a pre-market entry closed later the same
-- day (close auction and after-market included); Overnight = exit on the next trading day, Swing = 2+ trading days.
-- STRATEGY_VERSION 4 makes every signature stale, so the backfill re-derives every trade once; no row is rewritten here.
--
--   is_imx   IMX is no longer a strategy: any fill inside the IMX window (desk setting trades.imxWindowStart / End),
--            derived in the same pass; the desk tag «IMX» follows it. Nullable, no default: until the backfill reaches a
--            row, readers fall back to strategy = 'MOC' (lib/imx imxSql).
--
-- The Print cluster depends on the OTHER traders' trades of the ticker-day: lib/tradeStrategyStore computes it desk-wide
-- per ticker-day (SQL via trades_ny_wall below) and rewrites the strategy of the ticker-day's other candidates whenever
-- a trade of a pre-market ticker-day is refreshed (insert, edit, fills, soft delete, PropReports sync). The triggers
-- below cover a trade that LEAVES a ticker-day (ticker / date changed, hard delete): that ticker-day's pre-market trades
-- go stale, so the backfill re-derives them (and with them their remaining peers).

ALTER TABLE trades ADD COLUMN IF NOT EXISTS is_imx boolean;

-- A broker wall clock as a New York timestamp: a naive "YYYY-MM-DD[T ]HH:MM[:SS[.fff]]" is NY time as is (lib/tradeStrategy
-- nyParts), a string with a zone is converted; anything else (or unparsable) is NULL.
CREATE OR REPLACE FUNCTION trades_ny_wall(s text) RETURNS timestamp LANGUAGE plpgsql STABLE AS $$
DECLARE v text := btrim(s);
BEGIN
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(:[0-5]\d)?(\.\d+)?$' THEN
    RETURN replace(v, 'T', ' ')::timestamp;
  END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(:[0-5]\d)?(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN
    RETURN v::timestamptz AT TIME ZONE 'America/New_York';
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

-- A trade moved to another ticker / day: the pre-market trades of its OLD ticker-day (entry_sec < 09:30:00, or not
-- derived yet) are re-derived — their Print cluster may have lost a trader.
CREATE OR REPLACE FUNCTION trades_ticker_day_left_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE trades SET strategy_sig = NULL
   WHERE strategy_sig IS NOT NULL AND id <> OLD.id AND deleted_at IS NULL
     AND upper(ticker) = upper(OLD.ticker) AND LEFT(date, 10) = LEFT(OLD.date, 10)
     AND (entry_sec IS NULL OR entry_sec < 34200);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trades_ticker_day_left_trg ON trades;
CREATE TRIGGER trades_ticker_day_left_trg
  AFTER UPDATE OF ticker, date ON trades
  FOR EACH ROW WHEN (OLD.ticker IS NOT NULL AND (OLD.entry_sec IS NULL OR OLD.entry_sec < 34200)
                     AND (upper(OLD.ticker) IS DISTINCT FROM upper(NEW.ticker) OR LEFT(OLD.date, 10) IS DISTINCT FROM LEFT(NEW.date, 10)))
  EXECUTE FUNCTION trades_ticker_day_left_stale();

-- Hard deletes (statement level): the pre-market trades of the deleted pre-market trades' ticker-days are re-derived.
CREATE OR REPLACE FUNCTION trades_ticker_day_deleted_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE trades t SET strategy_sig = NULL
    FROM (SELECT DISTINCT upper(o.ticker) AS tk, LEFT(o.date, 10) AS d FROM old_rows o
           WHERE o.ticker IS NOT NULL AND (o.entry_sec IS NULL OR o.entry_sec < 34200)) g
   WHERE t.strategy_sig IS NOT NULL AND t.deleted_at IS NULL
     AND upper(t.ticker) = g.tk AND LEFT(t.date, 10) = g.d
     AND (t.entry_sec IS NULL OR t.entry_sec < 34200);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trades_ticker_day_deleted_trg ON trades;
CREATE TRIGGER trades_ticker_day_deleted_trg AFTER DELETE ON trades
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trades_ticker_day_deleted_stale();
