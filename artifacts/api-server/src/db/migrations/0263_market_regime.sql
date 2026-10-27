-- Market regime layer (lib/marketRegime/*, routes/market-regime.ts; Lance Breitstein / SMB Capital: a different
-- playbook and a different amount of risk per market regime). Regimes are stored as keys; names and hints are i18n.
-- 0263 is the next free number on main (0262 = ai_batch_reviews).

-- (1) The desk regime of a NY trading day. Set / changed by regime.set (curators, admins); the web engine's suggestion
--     (components/shared/market/regime-suggest) is stored with the reason codes it gave, auto_suggested = the person
--     confirmed exactly that regime. Changes are audited (audit_log regime.set {from, to, auto}).
CREATE TABLE IF NOT EXISTS desk_regime_days (
  day            date        PRIMARY KEY,
  regime         text        NOT NULL CHECK (regime IN ('theme_bull', 'macro', 'range', 'panic', 'idiosyncratic', 'euphoria')),
  note           text        CHECK (note IS NULL OR char_length(note) <= 500),
  set_by         text        NOT NULL CHECK (char_length(set_by) BETWEEN 1 AND 200),
  auto_suggested boolean     NOT NULL DEFAULT false,
  suggestion     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- (2) Playbook: the regimes a setup works best in («Подходит сегодня» = contains today's desk regime).
ALTER TABLE playbook ADD COLUMN IF NOT EXISTS regimes text[] NOT NULL DEFAULT '{}';
ALTER TABLE playbook DROP CONSTRAINT IF EXISTS playbook_regimes_check;
ALTER TABLE playbook ADD CONSTRAINT playbook_regimes_check
  CHECK (regimes <@ ARRAY['theme_bull', 'macro', 'range', 'panic', 'idiosyncratic', 'euphoria']::text[]);

-- (3) Weekly reflection per regime (how I recognise it, my playbooks in it, how much risk it deserves): one row per
--     trader × ISO week; answers = { <regime>: { recognize?, playbooks?, risk? } } (free text, ≤ 1000 chars each).
CREATE TABLE IF NOT EXISTS regime_reflections (
  trader     text        NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  week       text        NOT NULL CHECK (week ~ '^\d{4}-W\d{2}$'),
  answers    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trader, week)
);
