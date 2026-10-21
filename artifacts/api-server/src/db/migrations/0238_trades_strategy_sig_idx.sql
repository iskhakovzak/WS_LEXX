-- no-transaction
-- Performance review 2026-10-21. The job trades.strategy-backfill (lib/tradeStrategyStore backfillTradeStrategies, every
-- 5 minutes) looks for the rows whose strategy signature is NULL (new / edited — the 0237 triggers) or not the current
-- one (rule version / IMX window changed). Written as `strategy_sig IS DISTINCT FROM $1` it read the whole trades table
-- (~3 KB a row: the context snapshot) on every run, although in the steady state no row matches. The query now spells
-- it `strategy_sig IS NULL OR strategy_sig < $1 OR strategy_sig > $1` (same rows for a non-NULL $1), which this index
-- answers with a BitmapOr of three index conditions.
-- Not partial: the backfill derives deleted trades too (a restored trade keeps its strategy).
-- CONCURRENTLY + IF NOT EXISTS: no write lock on trades, safe to re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS trades_strategy_sig_idx ON trades (strategy_sig);
