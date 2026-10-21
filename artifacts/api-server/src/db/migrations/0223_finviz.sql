-- Finviz Elite integration (owner 2026-10-19; lib/finviz/*, routes/finviz.ts). Everything Finviz returns is cached
-- here and every page reads only these tables — the export API is called by the in-process jobs (≤ 1 req / 3 s).
-- Nothing is deleted: screener rows are upserted per (preset, NY day, ticker), a calendar entry that moved is marked
-- superseded_at.

-- One row per fetch (screener preset run, snapshot batch run, earnings calendar run).
CREATE TABLE IF NOT EXISTS finviz_runs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('screener', 'snapshot', 'earnings')),
  preset text,                                  -- screener preset (gappers | relvol | earnings_today), else NULL
  trigger text NOT NULL DEFAULT 'schedule',     -- schedule | manual | startup | event
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  ny_day text NOT NULL,                         -- YYYY-MM-DD, New York
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  row_count integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX IF NOT EXISTS finviz_runs_kind_idx ON finviz_runs (kind, preset, status, finished_at DESC);

-- Screener candidates: the latest values per preset / day / ticker; last_run_id = the run that saw it last
-- (GET /api/finviz/screener shows the rows of the preset's latest ok run). rank = position in that run.
CREATE TABLE IF NOT EXISTS finviz_screener_rows (
  preset text NOT NULL,
  ny_day text NOT NULL,
  ticker text NOT NULL,
  last_run_id bigint NOT NULL REFERENCES finviz_runs(id),
  rank integer NOT NULL DEFAULT 0,
  company text,
  sector text,
  price numeric(14,4),
  change_pct numeric(10,2),
  gap_pct numeric(10,2),
  rel_volume numeric(10,2),
  volume bigint,
  avg_volume bigint,
  float_shares bigint,
  short_float_pct numeric(8,2),
  atr numeric(12,4),
  market_cap numeric(20,0),
  earnings_date text,
  earnings_timing text CHECK (earnings_timing IN ('bmo', 'amc')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preset, ny_day, ticker)
);
CREATE INDEX IF NOT EXISTS finviz_screener_rows_run_idx ON finviz_screener_rows (last_run_id, rank);

-- Per-ticker context (trade sheet, day review, playbook, offerings / watchlist / catalyst fundamentals).
-- as_of NULL = requested (GET /api/finviz/ticker miss) but not fetched yet: the snapshot-pending job fills it.
CREATE TABLE IF NOT EXISTS finviz_ticker_snapshot (
  ticker text PRIMARY KEY,
  company text,
  sector text,
  industry text,
  country text,
  market_cap numeric(20,0),
  shares_outstanding bigint,
  float_shares bigint,
  short_float_pct numeric(8,2),
  short_ratio numeric(10,2),
  avg_volume bigint,
  rel_volume numeric(10,2),
  atr numeric(12,4),
  beta numeric(8,3),
  price numeric(14,4),
  earnings_date text,
  earnings_timing text CHECK (earnings_timing IN ('bmo', 'amc')),
  source text,                                  -- snapshot | screener | earnings
  as_of timestamptz,
  requested_at timestamptz,
  not_found_at timestamptz                      -- Finviz returned no row for it (delisted / OTC): not retried for a day
);
CREATE INDEX IF NOT EXISTS finviz_ticker_snapshot_pending_idx ON finviz_ticker_snapshot (requested_at) WHERE as_of IS NULL;

-- Earnings calendar (events page, «у тикера сегодня отчёт»). A row the calendar no longer lists for its date window
-- gets superseded_at (the report moved); reads skip superseded rows.
CREATE TABLE IF NOT EXISTS finviz_earnings (
  ticker text NOT NULL,
  date text NOT NULL,                           -- YYYY-MM-DD
  timing text CHECK (timing IN ('bmo', 'amc')),
  company text,
  market_cap numeric(20,0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS finviz_earnings_date_idx ON finviz_earnings (date) WHERE superseded_at IS NULL;
