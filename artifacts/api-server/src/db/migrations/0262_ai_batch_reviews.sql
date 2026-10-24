-- Nightly AI reviews through the Message Batches API (lib/assistant/batch/*, job ai.batch-reviews, docs/AI_ASSISTANT.md).
-- When the desk's day closes (every EOD of the day closed, at the latest aiBatch.time, default 21:00 NY) one batch
-- carries an «AI-разбор дня» for every trader who traded that day; Fridays optionally a weekly summary per trader,
-- the 1st of the month optionally a monthly one (settings aiBatch.*, all off by default). Results land in ai_reviews
-- with the same cache key as a live review, so the day report shows them without a model call.
-- 0262 is the next free number on main (0261 = ai_v2).

-- (1) ai_reviews: period reviews (kind week / month: `day` = the period's first day) and where a review came from.
ALTER TABLE ai_reviews DROP CONSTRAINT IF EXISTS ai_reviews_kind_check;
ALTER TABLE ai_reviews ADD CONSTRAINT ai_reviews_kind_check CHECK (kind IN ('trade', 'day', 'week', 'month'));
ALTER TABLE ai_reviews DROP CONSTRAINT IF EXISTS ai_reviews_check;
ALTER TABLE ai_reviews ADD CONSTRAINT ai_reviews_check CHECK ((kind = 'trade' AND trade_id IS NOT NULL) OR (kind <> 'trade' AND day IS NOT NULL));
ALTER TABLE ai_reviews ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'batch'));
CREATE INDEX IF NOT EXISTS ai_reviews_period_idx ON ai_reviews (trader, kind, day, created_at DESC) WHERE kind IN ('week', 'month');

-- (2) The assistant audit also records the batch reviews (mode 'batch': one row per stored review).
ALTER TABLE ai_assistant_audit DROP CONSTRAINT IF EXISTS ai_assistant_audit_mode_check;
ALTER TABLE ai_assistant_audit ADD CONSTRAINT ai_assistant_audit_mode_check CHECK (mode IN ('chat', 'assist', 'review', 'batch'));

-- (3) One row per submitted batch. provider_id = the Anthropic batch id (persisted before polling: a restart resumes
--     polling). night = the NY date the batch belongs to (the nightly desk budget aiBatch.nightlyUnits counts per night).
CREATE TABLE IF NOT EXISTS ai_batches (
  id bigserial PRIMARY KEY,
  night text NOT NULL CHECK (night ~ '^\d{4}-\d{2}-\d{2}$'),
  provider_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('submitting', 'in_progress', 'ended', 'failed', 'expired', 'canceled')),
  model text NOT NULL,
  advisor text,
  kinds text[] NOT NULL DEFAULT '{}',
  requests integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  invalid integer NOT NULL DEFAULT 0,
  errored integer NOT NULL DEFAULT 0,
  expired integer NOT NULL DEFAULT 0,
  canceled integer NOT NULL DEFAULT 0,
  skipped_budget integer NOT NULL DEFAULT 0,
  est_units bigint NOT NULL DEFAULT 0,
  units bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  poll_count integer NOT NULL DEFAULT 0,
  next_poll_at timestamptz,
  error text,
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_batches_open_idx ON ai_batches (next_poll_at) WHERE status IN ('submitting', 'in_progress');
CREATE INDEX IF NOT EXISTS ai_batches_night_idx ON ai_batches (night, created_at DESC);

-- (4) One row per review request. UNIQUE (kind, trader, period): the same day / week / month of a trader is never
--     submitted twice (an expired or invalid one is not resubmitted: the trader can still run the review by hand).
--     input_hash = the ai_reviews cache key of the gathered inputs; facts = the day's state machine, stored with the review.
CREATE TABLE IF NOT EXISTS ai_batch_items (
  id bigserial PRIMARY KEY,
  batch_id bigint NOT NULL REFERENCES ai_batches(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('day', 'week', 'month')),
  trader text NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}-\d{2}$'),
  lang text NOT NULL CHECK (lang IN ('ru', 'en', 'uz')),
  input_hash text NOT NULL CHECK (char_length(input_hash) = 64),
  facts jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stored', 'invalid', 'errored', 'expired', 'canceled', 'refused')),
  error text,
  est_units bigint NOT NULL DEFAULT 0,
  units bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  review_id bigint,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (kind, trader, period)
);
CREATE INDEX IF NOT EXISTS ai_batch_items_batch_idx ON ai_batch_items (batch_id);
CREATE INDEX IF NOT EXISTS ai_batch_items_notify_idx ON ai_batch_items (finished_at) WHERE status = 'stored' AND notified_at IS NULL;
