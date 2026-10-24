-- Progress snapshots of the plateau detector (roadmap R6, lib/plateau.ts + lib/plateauStore.ts, job
-- academy.plateau-monthly: the 1st trading day of a month 07:00 NY = monthly run, Mondays = weekly refresh).
-- One row per trader × run date × run kind. tenure_active_days = traded days at the current stage; pace_target = the
-- stage's net_pnl threshold ÷ window ($ / day); mean_lb = mean daily net over the lookback (≤ 250 active days),
-- shrunk toward peers at the same stage and tenure bucket when ≥ 10 exist (shrunk = true); lo80 / hi80 its 80%
-- interval; p_impr = P(this window beats the previous one). plateau ⇔ hi80 < pace_target and p_impr < 0.9 (or
-- unknown). escalated = 2nd consecutive monthly plateau (≤ once per 30 trading days, never while suppressed_until
-- is ahead — dip suppression after a method change); admin_escalated = stuck_long with 3 escalations and no curator
-- intervention. diagnosis = the pack attached to an escalation (codes and numbers: edge-map slices, fee share; the
-- R1 binding criterion, R12 drift and R7 actions plug in when those land). Staff-only data.
CREATE TABLE IF NOT EXISTS trader_progress_snapshots (
  id                 bigserial     PRIMARY KEY,
  trader             text          NOT NULL,
  as_of              date          NOT NULL,
  run_kind           text          NOT NULL CHECK (run_kind IN ('monthly', 'weekly')),
  tenure_active_days integer       NOT NULL,
  stage              text,
  pace_target        numeric(12,2),
  n_days             integer       NOT NULL DEFAULT 0,
  mean_raw           numeric(12,2),
  mean_lb            numeric(12,2),
  lo80               numeric(12,2),
  hi80               numeric(12,2),
  p_impr             numeric(6,4),
  shrunk             boolean       NOT NULL DEFAULT false,
  plateau            boolean       NOT NULL DEFAULT false,
  severity           text          CHECK (severity IN ('slow', 'stuck', 'stuck_long')),
  escalated          boolean       NOT NULL DEFAULT false,
  admin_escalated    boolean       NOT NULL DEFAULT false,
  suppressed_until   date,
  diagnosis          jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT trader_progress_snapshots_key UNIQUE (trader, as_of, run_kind)
);
CREATE INDEX IF NOT EXISTS trader_progress_snapshots_latest_idx ON trader_progress_snapshots (trader, as_of DESC);
