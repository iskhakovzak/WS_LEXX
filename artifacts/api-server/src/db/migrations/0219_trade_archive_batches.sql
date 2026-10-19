-- Trade archive batches (db/tools/archive-trades.ts): which trades and rule violations one archive run hid, so the
-- run can be undone exactly (--restore <id>). Archiving sets trades.deleted_at / rule_violations.archived_at; nothing is
-- deleted.
CREATE TABLE IF NOT EXISTS trade_archive_batches (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  trade_ids INTEGER[] NOT NULL DEFAULT '{}',
  violation_ids INTEGER[] NOT NULL DEFAULT '{}',
  reassigned JSONB,
  restored_at TIMESTAMPTZ
);
