-- PropReports integration v2, phase 1 (CORE): the HTTP tick (POST /api/cron/tick) replaces the in-process scheduler on
-- Vercel. Everything a tick needs to be resumable lives here; nothing is deleted by the tick (rows are marked done).
--
-- 1. propreports_tick_lease  — one row per lease name ('tick'): holder + expires_at. Not an advisory lock: the pooler
--    shares sessions and a frozen function would hold a session lock forever; an unreleased lease just expires.
-- 2. propreports_tick_steps  — per step (lib/propreports/tick/steps.ts): last run / ok / done flag / note / error / ms.
-- 3. propreports_cursors     — durable step cursors (key → JSON), e.g. "fills:acct:<account>", "tick:last".
-- 4. propreports_outbox      — post-sync side effects (rule scan, idea relink, challenges, structures, notify, risk
--    alerts…) enqueued in the sync transaction, drained by the tick; attempts / backoff (run_after) / claim
--    (locked_until) / done_at / failed_at.
-- 5. propreports_backfills   — resumable history backfill in 7-day windows with progress (curator starts it in
--    Integrations; the tick advances `cursor`).
-- 6. cache_versions          — cross-instance cache stamp: 'trades' is bumped on every applied sync; every API instance
--    compares it (≤ every 15 s) and drops its in-memory trade caches when it moved.
CREATE TABLE IF NOT EXISTS propreports_tick_lease (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS propreports_tick_steps (
  name TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_done BOOLEAN,
  last_note TEXT,
  last_error TEXT,
  last_ms INTEGER,
  runs INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS propreports_cursors (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS propreports_outbox (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);
-- the drainer's claim query: open rows in id order
CREATE INDEX IF NOT EXISTS propreports_outbox_open_idx ON propreports_outbox (id) WHERE done_at IS NULL AND failed_at IS NULL;
-- enqueue de-duplication (same kind + payload still waiting)
CREATE INDEX IF NOT EXISTS propreports_outbox_kind_open_idx ON propreports_outbox (kind) WHERE done_at IS NULL AND failed_at IS NULL;

CREATE TABLE IF NOT EXISTS propreports_backfills (
  id SERIAL PRIMARY KEY,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  cursor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'cancelled', 'error')),
  windows_total INTEGER NOT NULL DEFAULT 0,
  windows_done INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  conflicts INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  fills INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
-- at most one running backfill
CREATE UNIQUE INDEX IF NOT EXISTS propreports_backfills_one_running ON propreports_backfills ((status)) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS cache_versions (
  name TEXT PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cache_versions (name, version) VALUES ('trades', 0) ON CONFLICT (name) DO NOTHING;
