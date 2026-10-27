-- «Ментор» — the personal AI mentor (lib/mentor/*, routes/mentor.ts).
-- The mentor leads the trader: a profile it remembers (compact notes, never raw chat), a daily rhythm (brief before the
-- session, debrief after it, a weekly review), 1–3 measurable commitments tracked from the trades, and escalation to
-- the trader's curator. Dates are New York trading days as text (like the other AI tables). User content is removed
-- softly (deleted_at / cleared_at, ARCHITECTURE.md §3.7).
-- 0270 leaves room for the branches in flight (capital allocation, leak guard, junior cost). The runner allows gaps.

-- (1) The mentor's memory: short structured notes about the trader. source = who wrote it (the mentor after a talk,
--     the trader himself, the curator); kind 'guidance' = the curator's instruction the mentor follows.
CREATE TABLE IF NOT EXISTS mentor_notes (
  id bigserial PRIMARY KEY,
  trader text NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('goal', 'strength', 'weakness', 'leak', 'discussed', 'preference', 'guidance')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 400),
  source text NOT NULL CHECK (source IN ('mentor', 'trader', 'curator')),
  author text NOT NULL CHECK (char_length(author) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS mentor_notes_trader_idx ON mentor_notes (trader, id DESC) WHERE deleted_at IS NULL;

-- (2) Per-trader mentor state: the data facts (stage, strengths, leaks …) the trader chose to hide from the mentor.
CREATE TABLE IF NOT EXISTS mentor_profile (
  trader text PRIMARY KEY CHECK (char_length(trader) BETWEEN 1 AND 200),
  hidden_facts text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- (3) Commitments: a closed set of measurable kinds (params = numbers / times, validated by lib/mentor/commitments.ts)
--     plus 'custom' (free text, not auto-tracked). Progress is computed from the trades on every read (never stored).
CREATE TABLE IF NOT EXISTS mentor_commitments (
  id bigserial PRIMARY KEY,
  trader text NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('pause_after_loss', 'max_trades', 'max_daily_loss', 'stop_after_losses', 'no_entry_before', 'no_entry_after', 'max_loss_per_trade', 'custom')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  text text CHECK (text IS NULL OR char_length(text) <= 300),
  source text NOT NULL CHECK (source IN ('mentor', 'trader', 'curator')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'dropped', 'replaced')),
  started_on text NOT NULL CHECK (started_on ~ '^\d{4}-\d{2}-\d{2}$'),
  closed_on text CHECK (closed_on IS NULL OR closed_on ~ '^\d{4}-\d{2}-\d{2}$'),
  close_note text CHECK (close_note IS NULL OR char_length(close_note) <= 300),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mentor_commitments_trader_idx ON mentor_commitments (trader, status, id DESC);

-- (4) The mentor conversation (one thread per trader; the daily rhythm posts its opener here too). «Очистить» sets
--     cleared_at; the memory lives in mentor_notes, not here.
CREATE TABLE IF NOT EXISTS mentor_messages (
  id bigserial PRIMARY KEY,
  trader text NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('user', 'mentor')),
  kind text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'brief', 'debrief', 'weekly')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);
CREATE INDEX IF NOT EXISTS mentor_messages_trader_idx ON mentor_messages (trader, id DESC) WHERE cleared_at IS NULL;

-- (5) The daily rhythm, generated on demand (or by the optional scheduled push through Message Batches): one per
--     trader × kind × period × language. period = the NY trading day (brief / debrief) or the week's Monday (weekly).
--     input_hash = the data the text was written from: same inputs → no second model call.
CREATE TABLE IF NOT EXISTS mentor_digests (
  id bigserial PRIMARY KEY,
  trader text NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('brief', 'debrief', 'weekly')),
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}-\d{2}$'),
  lang text NOT NULL CHECK (lang IN ('ru', 'en', 'uz')),
  input_hash text NOT NULL,
  content jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'pending', 'failed')),
  source text NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'batch')),
  batch_id text,
  deep boolean NOT NULL DEFAULT false,
  units bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trader, kind, period, lang)
);
CREATE INDEX IF NOT EXISTS mentor_digests_pending_idx ON mentor_digests (batch_id) WHERE status = 'pending';

-- (6) Escalations to the human: a pattern beyond the mentor (tilt streak, repeated commitment breaks, drawdown near
--     the limit, silence). params = codes and numbers (rendered per reader); notified = the staff who got the notice.
CREATE TABLE IF NOT EXISTS mentor_escalations (
  id bigserial PRIMARY KEY,
  trader text NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  rule text NOT NULL CHECK (rule IN ('tilt_streak', 'rule_breaks', 'drawdown_near_limit', 'silence')),
  day text NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  notified text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  ack_by text CHECK (ack_by IS NULL OR char_length(ack_by) BETWEEN 1 AND 200),
  ack_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trader, rule, day)
);
CREATE INDEX IF NOT EXISTS mentor_escalations_open_idx ON mentor_escalations (trader, created_at DESC) WHERE status = 'open';

-- (7) The assistant audit records the mentor's calls too (mode 'mentor'; 'mentor_batch' = the scheduled push).
ALTER TABLE ai_assistant_audit DROP CONSTRAINT IF EXISTS ai_assistant_audit_mode_check;
ALTER TABLE ai_assistant_audit ADD CONSTRAINT ai_assistant_audit_mode_check CHECK (mode IN ('chat', 'assist', 'review', 'batch', 'mentor', 'mentor_batch'));
