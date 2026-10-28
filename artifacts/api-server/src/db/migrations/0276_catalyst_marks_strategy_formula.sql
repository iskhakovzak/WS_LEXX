-- «A strategy is three lines: catalyst → setup → trade» (SMB Capital). lib/catalyst/*, routes/catalysts.ts,
-- lib/strategyFormula.ts. 0276 is the next free number on main (0275 = achievements_v2).
--
-- (1) catalyst_marks: the two quick taps of the morning plan / the watchlist — the catalyst's direction (bull / bear)
--     and strength (weak / strong) — per trader × NY trading day × ticker. PropReports trades link to a mark by
--     (trades.trader, LEFT(trades.date, 10), UPPER(trades.ticker)) when they are read: nothing is written on a trade.
--     kind = the catalyst type when the mark started from an event / earnings suggestion (a code, never a label);
--     suggested = the direction was a suggestion (event, earnings or gap) the trader confirmed with a tap.
--     A cleared mark keeps its row with both taps null (a tap is user input: no hard delete) and counts as unmarked.
CREATE TABLE IF NOT EXISTS catalyst_marks (
  trader     text        NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  day        text        NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  ticker     text        NOT NULL CHECK (ticker ~ '^[A-Z0-9][-A-Z0-9.]{0,11}$'),
  direction  text        CHECK (direction IN ('bull', 'bear')),
  strength   text        CHECK (strength IN ('weak', 'strong')),
  kind       text        CHECK (kind IN ('earnings', 'news', 'fda', 'offering', 'corporate', 'macro', 'other')),
  source     text        NOT NULL DEFAULT 'plan' CHECK (source IN ('plan', 'watchlist')),
  suggested  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trader, day, ticker)
);
CREATE INDEX IF NOT EXISTS catalyst_marks_day_idx ON catalyst_marks (day) WHERE strength IS NOT NULL;

-- (2) The strategy formula of a playbook setup: three structured lines, a document (never filtered in SQL):
--     { catalyst: { kind, strength, direction }, setup, trade } — kind / strength / direction are codes or null
--     (= any), setup and trade are the author's own text. Validated on write by lib/strategyFormula.ts.
ALTER TABLE playbook ADD COLUMN IF NOT EXISTS formula jsonb;
ALTER TABLE playbook DROP CONSTRAINT IF EXISTS playbook_formula_check;
ALTER TABLE playbook ADD CONSTRAINT playbook_formula_check CHECK (formula IS NULL OR jsonb_typeof(formula) = 'object');
