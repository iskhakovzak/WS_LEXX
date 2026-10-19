-- PropReports integration v2, phase 2 (RISK-LIVE): intraday open positions + unrealized P&L in the daily stop.
--
-- 1. propreports_live_positions — the LATEST positions snapshot per PropReports account, written by the positions tick
--    step (lib/propreports/steps/positions.ts) on every tick during RTH. One row per account, overwritten in place
--    (no history): open positions only (Qty 0 = closed rows are ignored), their summed unrealized P&L, and fetched_at.
--    Every active mapped account gets a row on each run (an empty book = 0), so «обновлено N мин назад» is known for
--    flat traders too. The risk desk adds `unrealized` to the realized net of the trading day while the snapshot is
--    fresh (lib/riskMetrics liveRisk).
-- 2. risk_live_alerts — one row per trader per threshold (warn / stop / weekly / drawdown) per trading day: the claim
--    that makes the positions step enqueue a risk alert into the outbox once, plus when it fired.
CREATE TABLE IF NOT EXISTS propreports_live_positions (
  account TEXT PRIMARY KEY,
  trader TEXT,
  trading_date TEXT NOT NULL,
  open_count INTEGER NOT NULL DEFAULT 0,
  unrealized NUMERIC(14,2) NOT NULL DEFAULT 0,
  unrealized_delta NUMERIC(14,2) NOT NULL DEFAULT 0,
  realized NUMERIC(14,2) NOT NULL DEFAULT 0,
  positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS propreports_live_positions_trader_idx ON propreports_live_positions (trader, trading_date);

CREATE TABLE IF NOT EXISTS risk_live_alerts (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  date TEXT NOT NULL,
  threshold TEXT NOT NULL,
  pnl_net NUMERIC(14,2),
  unrealized NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trader, date, threshold)
);
