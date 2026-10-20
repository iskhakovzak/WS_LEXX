-- «Улучшенный поиск» + IMX (2026-10-21). The PropReports-style strategy of every trade is stored next to it:
--   strategy      lib/tradeStrategy deriveTradeStrategy (Overnight, OPG, OPGtoDAY, Day, MOC, AfterMarket, Print, Adjust, OPT);
--                 MOC = any fill in the IMX window (desk settings trades.imxWindowStart / End) = an IMX trade, which
--                 also carries the desk tag «IMX» in trades.tags;
--   entry_sec     New York seconds of the first entry (the «Время» facet of /trades and /stats);
--   strategy_sig  the rule version + IMX window the row was derived with; NULL = re-derive.
-- The derivation is TypeScript (one pure function), so this file only adds the columns: the backfill of every trade is
-- the job trades.strategy-backfill (2 min after boot, then every 5 minutes — rows whose signature is NULL or stale),
-- and a PropReports sync derives the trades it writes in its own transaction.
-- The trigger below marks a row stale when an input of the derivation changes (manual edits, imports, tools), and
-- the execution triggers do the same for a trade whose fills change. Idempotent, no row is rewritten here.

ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_sec integer;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_sig text;

CREATE INDEX IF NOT EXISTS trades_live_strategy_idx ON trades (strategy) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION trades_strategy_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticker IS DISTINCT FROM OLD.ticker OR NEW.date IS DISTINCT FROM OLD.date OR NEW.exit_date IS DISTINCT FROM OLD.exit_date
     OR NEW.horizon IS DISTINCT FROM OLD.horizon OR NEW.session IS DISTINCT FROM OLD.session
     OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.entry IS DISTINCT FROM OLD.entry
     OR (NEW.context_snapshot ->> 'openedAt') IS DISTINCT FROM (OLD.context_snapshot ->> 'openedAt')
     OR (NEW.context_snapshot ->> 'closedAt') IS DISTINCT FROM (OLD.context_snapshot ->> 'closedAt') THEN
    NEW.strategy_sig := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trades_strategy_stale_trg ON trades;
CREATE TRIGGER trades_strategy_stale_trg
  BEFORE UPDATE OF ticker, date, exit_date, horizon, session, qty, entry, context_snapshot ON trades
  FOR EACH ROW EXECUTE FUNCTION trades_strategy_stale();

-- Fills changed → the parent trade is stale (statement level: one UPDATE per statement, not per fill).
CREATE OR REPLACE FUNCTION trade_executions_strategy_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE trades SET strategy_sig = NULL WHERE strategy_sig IS NOT NULL AND id IN (SELECT trade_id FROM old_rows);
  ELSE
    UPDATE trades SET strategy_sig = NULL WHERE strategy_sig IS NOT NULL AND id IN (SELECT trade_id FROM new_rows);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trade_executions_strategy_ins_trg ON trade_executions;
CREATE TRIGGER trade_executions_strategy_ins_trg AFTER INSERT ON trade_executions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trade_executions_strategy_stale();
DROP TRIGGER IF EXISTS trade_executions_strategy_upd_trg ON trade_executions;
CREATE TRIGGER trade_executions_strategy_upd_trg AFTER UPDATE ON trade_executions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trade_executions_strategy_stale();
DROP TRIGGER IF EXISTS trade_executions_strategy_del_trg ON trade_executions;
CREATE TRIGGER trade_executions_strategy_del_trg AFTER DELETE ON trade_executions
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trade_executions_strategy_stale();
