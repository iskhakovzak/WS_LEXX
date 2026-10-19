-- PropReports integration v2, phase 3 (accuracy): broker adjustments, fill id replacement, nightly reconciliation,
-- account status. Code: lib/propreports/{adjustments*,replacement,reconcile-broker*}.ts, lib/propreports/steps/*.
-- Nothing is ever deleted from these tables: adjustments that vanish upstream are archived (archived_at).

-- Broker cash adjustments (fees outside fills, transfers, corrections). Identity: (account, propreports_id) when the
-- API sends the id; otherwise fingerprint + occurrence within one fetch. A re-imported record (same data, new
-- propreports_id) updates its row and keeps the old id in replaced_ids.
CREATE TABLE IF NOT EXISTS propreports_adjustments (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  account TEXT NOT NULL,
  trader TEXT,
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fee', 'transfer', 'other')),
  amount NUMERIC(14, 4) NOT NULL,
  comment TEXT,
  qty NUMERIC(14, 4),
  symbol TEXT,
  price NUMERIC(14, 4),
  propreports_id TEXT,
  replaced_ids TEXT[] NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL,
  occurrence INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS propreports_adjustments_pr_id_key ON propreports_adjustments (account, propreports_id) WHERE propreports_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS propreports_adjustments_scope_date_idx ON propreports_adjustments (scope, date);
CREATE INDEX IF NOT EXISTS propreports_adjustments_trader_date_idx ON propreports_adjustments (trader, date) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS propreports_adjustments_account_date_idx ON propreports_adjustments (account, date) WHERE archived_at IS NULL;

-- Every fill propReportsId ever seen → the id the fill was first seen with (canonical_id). A re-import (same data,
-- new id) inserts the new id with the old canonical id and marks the old row replaced_by.
CREATE TABLE IF NOT EXISTS propreports_fill_identity (
  propreports_id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  account TEXT NOT NULL,
  trade_date TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_by TEXT,
  replaced_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS propreports_fill_identity_fp_idx ON propreports_fill_identity (fingerprint) WHERE replaced_by IS NULL;

-- Nightly per account per day: our journal net vs the broker's "Summary by Date" Net.
CREATE TABLE IF NOT EXISTS propreports_reconcile_days (
  id SERIAL PRIMARY KEY,
  account TEXT NOT NULL,
  account_id TEXT,
  trader TEXT,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'mismatch', 'missing_ours', 'missing_broker')),
  ours_net NUMERIC(14, 4),
  broker_net NUMERIC(14, 4),
  diff NUMERIC(14, 4) NOT NULL DEFAULT 0,
  ours_trades INTEGER,
  broker_fills INTEGER,
  carry BOOLEAN NOT NULL DEFAULT FALSE,
  adj_diff NUMERIC(14, 4),
  transfer_diff NUMERIC(14, 4),
  details JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  acknowledged_diff NUMERIC(14, 4),
  ack_note TEXT,
  CONSTRAINT propreports_reconcile_days_account_date_key UNIQUE (account, date)
);
CREATE INDEX IF NOT EXISTS propreports_reconcile_days_open_idx ON propreports_reconcile_days (date DESC) WHERE status <> 'ok' AND acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS propreports_reconcile_days_trader_idx ON propreports_reconcile_days (trader, date);

-- Broker account status (accounts step): what PropReports says, and whether WE deactivated the mapping (only those
-- are re-activated automatically when the broker re-opens the account).
ALTER TABLE propreports_accounts ADD COLUMN IF NOT EXISTS broker_status TEXT;
ALTER TABLE propreports_accounts ADD COLUMN IF NOT EXISTS broker_close_date TEXT;
ALTER TABLE propreports_accounts ADD COLUMN IF NOT EXISTS broker_deactivation_date TEXT;
ALTER TABLE propreports_accounts ADD COLUMN IF NOT EXISTS broker_seen_at TIMESTAMPTZ;
ALTER TABLE propreports_accounts ADD COLUMN IF NOT EXISTS auto_deactivated_at TIMESTAMPTZ;
