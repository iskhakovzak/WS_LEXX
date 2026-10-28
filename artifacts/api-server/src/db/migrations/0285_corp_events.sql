-- Corporate and index event calendar (lib/corpEvents/*, routes/corp-events.ts) — the «Катализаторы» page (/events).
-- 0285: the first free number at or above 0285 (another branch adds 0277+ in parallel).
--
-- (1) corp_events: desk entries an admin / curator adds by hand (desk data, not per-trade input): lock-up expiries,
--     S&P 500 / 400 / 600 adds and removals, other index rebalances, spin-offs, pricings, offerings, IPOs. The
--     deterministic dates (quad witching, S&P quarterly rebalance, MSCI reviews, Nasdaq-100 reconstitution) are
--     computed by rule and the IPO / pricing / offering / lock-up rows are read from the offerings feed already
--     stored (offering_ticker_cache) — neither is written here. Soft delete (deleted_at) like every user content.
CREATE TABLE IF NOT EXISTS corp_events (
  id          serial      PRIMARY KEY,
  day         text        NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  type        text        NOT NULL CHECK (type IN ('lockup_expiry', 'sp_add', 'sp_remove', 'index_rebalance', 'quad_witching', 'spinoff', 'pricing', 'offering', 'ipo')),
  ticker      text        CHECK (ticker IS NULL OR ticker ~ '^[A-Z0-9][-A-Z0-9.]{0,11}$'),
  index_code  text        CHECK (index_code IN ('sp500', 'sp400', 'sp600', 'msci', 'russell', 'nasdaq100', 'other')),
  note        text        CHECK (note IS NULL OR char_length(note) <= 500),
  created_by  text        NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS corp_events_day_idx ON corp_events (day) WHERE deleted_at IS NULL;

-- (2) Each event type can point at the playbook setup the desk trades it with (one setup per type, desk-wide).
CREATE TABLE IF NOT EXISTS corp_event_type_setups (
  type        text        PRIMARY KEY CHECK (type IN ('lockup_expiry', 'sp_add', 'sp_remove', 'index_rebalance', 'quad_witching', 'spinoff', 'pricing', 'offering', 'ipo')),
  playbook_id integer     NOT NULL REFERENCES playbook(id) ON DELETE CASCADE,
  updated_by  text        NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 200),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
