-- Live in-session risk signals (lib/riskSignals/*, routes/risk-signals.ts). One row per alert: a signal fired for a
-- trader on a trading day at a level (stop 70 / 90 %, a 3-loss streak, revenge size / pace, an off-plan ticker, a
-- restricted window HH:MM). UNIQUE (trader, day, signal, level) = each alert fires once a day. Codes and numbers only;
-- texts are i18n. After the session the row is settled with the «desk saved» estimate (lib/riskSignals/saved.ts):
--   rest_net       the rest of the session after the alert (final realized net − realized net at the trigger)
--   baseline_rest  mean of the same «rest» on the trader's own past days with the same situation and no alert
--   baseline_n     how many such past days (the sample size)
--   saved_usd      rest_net − baseline_rest; NULL when baseline_n is below the desk minimum (riskSignals.savedMinSample)
CREATE TABLE IF NOT EXISTS risk_signal_alerts (
  id                bigserial   PRIMARY KEY,
  trader            text        NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  day               text        NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  signal            text        NOT NULL CHECK (signal IN ('stop_proximity', 'loss_streak', 'revenge', 'off_plan', 'banned_window')),
  level             text        NOT NULL CHECK (char_length(level) BETWEEN 1 AND 40),
  severity          text        NOT NULL CHECK (severity IN ('warn', 'critical')),
  trade_id          integer,
  triggered_at      timestamptz NOT NULL,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  pnl_at            numeric(12,2),
  stats             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  staff_notified_at timestamptz,
  seen_at           timestamptz,
  rest_net          numeric(12,2),
  baseline_rest     numeric(12,2),
  baseline_n        integer     CHECK (baseline_n IS NULL OR baseline_n >= 0),
  saved_usd         numeric(12,2),
  settled_at        timestamptz,
  CONSTRAINT risk_signal_alerts_once UNIQUE (trader, day, signal, level)
);
CREATE INDEX IF NOT EXISTS risk_signal_alerts_day_idx ON risk_signal_alerts (day, trader);
CREATE INDEX IF NOT EXISTS risk_signal_alerts_open_idx ON risk_signal_alerts (day) WHERE settled_at IS NULL;
