-- Library of analogues (lib/analogues/*, routes/analogues.ts). 0286: next free number of this branch (0285 = corp_events).
--
-- playbook_cases: example CASES of a playbook setup that are not a trade of ours — a ticker and a NY trading day with
-- an optional entry / exit time (NY wall clock HH:MM), side and note. Playbook input (manual by design: the owner's data
-- rule allows manual entry in the playbook). The chart is drawn from the candle archive / market data of that day; the
-- trade-based examples stay in playbook_examples. Soft delete (deleted_at).
CREATE TABLE IF NOT EXISTS playbook_cases (
  id          serial      PRIMARY KEY,
  playbook_id integer     NOT NULL REFERENCES playbook(id) ON DELETE CASCADE,
  ticker      text        NOT NULL CHECK (ticker ~ '^[A-Z0-9][-A-Z0-9.]{0,11}$'),
  day         text        NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  entry_time  text        CHECK (entry_time IS NULL OR entry_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  exit_time   text        CHECK (exit_time IS NULL OR exit_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  side        text        CHECK (side IN ('long', 'short')),
  note        text        CHECK (note IS NULL OR char_length(note) <= 2000),
  added_by    text        NOT NULL CHECK (char_length(added_by) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS playbook_cases_setup_idx ON playbook_cases (playbook_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS playbook_cases_ticker_day_idx ON playbook_cases (ticker, day) WHERE deleted_at IS NULL;
