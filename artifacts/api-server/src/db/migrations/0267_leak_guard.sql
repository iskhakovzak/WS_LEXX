-- Live leak guard (lib/leakGuard/*, routes/leak-guard.ts). 0267: 0263 is the last number on main; 0264–0266 are left
-- free for the branches in flight (capital allocation, junior cost) so the numbers do not collide on merge.

-- (1) One row per guard event: a personal leak pattern fired for a trader (trigger seen at a PropReports sync), the
--     ladder steps taken (acknowledgement, curator escalation, risk manager notice, manual release) and, once the
--     window is over, the outcome in $ (saved = the trader's own expected cost of the trigger when complied, lost = the
--     actual loss of the at-risk trades when ignored). Codes only; texts are i18n.
CREATE TABLE IF NOT EXISTS leak_guard_events (
  id                bigserial   PRIMARY KEY,
  trader            text        NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  day               date        NOT NULL,
  pattern           text        NOT NULL CHECK (pattern IN ('after_loss', 'first_trade', 'rule_violation', 'near_stop')),
  source_key        text        NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 80),
  level             text        NOT NULL CHECK (level IN ('soft', 'firm', 'hard')),
  trigger_trade_id  integer,
  triggered_at      timestamptz NOT NULL,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  pause_until       timestamptz,
  late              boolean     NOT NULL DEFAULT false,
  silent_reason     text        CHECK (silent_reason IS NULL OR silent_reason IN ('quiet', 'cap', 'stale')),
  cost_per_trade    numeric(12,2),
  cost_per_trigger  numeric(12,2),
  stats             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  acked_at          timestamptz,
  escalated_at      timestamptz,
  risk_notified_at  timestamptz,
  released_at       timestamptz,
  released_by       text        CHECK (released_by IS NULL OR char_length(released_by) BETWEEN 1 AND 200),
  outcome           text        CHECK (outcome IS NULL OR outcome IN ('complied', 'ignored', 'late', 'no_trades', 'unknown')),
  outcome_net       numeric(12,2),
  saved_usd         numeric(12,2),
  lost_usd          numeric(12,2),
  at_risk_trade_ids integer[]   NOT NULL DEFAULT '{}',
  settled_at        timestamptz,
  CONSTRAINT leak_guard_events_once UNIQUE (trader, day, pattern, source_key)
);
CREATE INDEX IF NOT EXISTS leak_guard_events_day_idx ON leak_guard_events (day, trader);
CREATE INDEX IF NOT EXISTS leak_guard_events_open_idx ON leak_guard_events (day) WHERE settled_at IS NULL;

-- (2) Per-trader ladder override (risk desk, risk.limits.edit; audited «leakGuard.level»). No row = the stage default
--     from the desk settings (leakGuard.levelJunior / levelTrader / levelSenior).
CREATE TABLE IF NOT EXISTS leak_guard_levels (
  trader     text        PRIMARY KEY CHECK (char_length(trader) BETWEEN 1 AND 200),
  level      text        NOT NULL CHECK (level IN ('off', 'soft', 'firm', 'hard')),
  set_by     text        NOT NULL CHECK (char_length(set_by) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
