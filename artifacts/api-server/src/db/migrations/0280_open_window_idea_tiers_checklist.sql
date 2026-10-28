-- Features 7–9 of the session flow (lib/sessionFlow/openWindow.ts, ideas.ts, checklist.ts; routes/ideas.ts).
--
-- (1) The opening window 09:30–10:00 has its own loss limit on the risk desk. NULL = the stage share of the daily limit
--     (desk settings flow.openShareJunior / Trader / Senior); it lifts by itself once the trader's edge in the window is
--     proven (flow.openLiftMinTrades trades, positive P&L without the three best). Written by PUT /risk/limits/:trader
--     (risk.limits.edit, the limit change log keeps before / after).
ALTER TABLE trader_risk_limits ADD COLUMN IF NOT EXISTS open_window_loss_limit numeric(12,2);
ALTER TABLE trader_risk_limits DROP CONSTRAINT IF EXISTS trader_risk_limits_open_window_check;
ALTER TABLE trader_risk_limits ADD CONSTRAINT trader_risk_limits_open_window_check CHECK (open_window_loss_limit IS NULL OR open_window_loss_limit >= 0);

-- (2) Setup checklists with scoring: playbook.checklist_items keeps its {id, text} items and gains an optional weight
--     (1–5) and an auto-prefill code per item (gap / rvol / catalyst / analyst — a document, validated on write);
--     the threshold is the score the setup needs (e.g. «second day: 5 factors, 4 required»).
ALTER TABLE playbook ADD COLUMN IF NOT EXISTS checklist_threshold numeric(6,2);
ALTER TABLE playbook DROP CONSTRAINT IF EXISTS playbook_checklist_threshold_check;
ALTER TABLE playbook ADD CONSTRAINT playbook_checklist_threshold_check CHECK (checklist_threshold IS NULL OR (checklist_threshold > 0 AND checklist_threshold <= 100));

-- (3) The idea of a planned ticker (the morning plan / the watchlist — plans are where manual input belongs): its tier
--     (1 best … 3), «authored» (the trader's own idea, not the desk plan's), the playbook setup it is played as, the
--     checklist ticks of that setup and the score they make. PropReports trades link to it by (trader, NY entry day,
--     ticker, side) when they are read — nothing is written on a trade. side NULL = either side.
CREATE TABLE IF NOT EXISTS plan_idea_marks (
  trader      text        NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  day         text        NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  ticker      text        NOT NULL CHECK (ticker ~ '^[A-Z0-9][-A-Z0-9.]{0,11}$'),
  side        text        CHECK (side IN ('long', 'short')),
  tier        smallint    CHECK (tier BETWEEN 1 AND 3),
  authored    boolean     NOT NULL DEFAULT false,
  setup_id    integer,
  checks      jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checks) = 'object'),
  score       numeric(6,2),
  max_score   numeric(6,2),
  threshold   numeric(6,2),
  source      text        NOT NULL DEFAULT 'plan' CHECK (source IN ('plan', 'watchlist')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trader, day, ticker)
);
CREATE INDEX IF NOT EXISTS plan_idea_marks_trader_day_idx ON plan_idea_marks (trader, day);
-- trader follows a rename through lib/people/renameUserColumns.ts (like catalyst_marks.trader).
