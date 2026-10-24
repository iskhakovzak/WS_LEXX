-- «Ассистент WS» (lib/assistant/*, routes/ai-assistant.ts, docs/AI_ASSISTANT.md).
-- (1) ai_assistant_messages: the per-user conversation (one thread per user). role = 'user' | 'assistant'; content is the
--     visible text; drafts = the structured drafts shown with an answer (never saved anywhere by the assistant itself);
--     tools = names of the read tools the answer used; model = the model that wrote the answer. «Очистить» sets
--     cleared_at (user content is removed softly, ARCHITECTURE.md §3.7); cleared rows are never read back.
-- (2) ai_assistant_usage: tokens per user × New York day × model — the daily budgets (desk settings assistant.*Tokens).
-- (3) ai_assistant_audit: one row per assistant call (who, models, tokens, tools, outcome, cost). Message bodies are
--     stored only while the desk setting assistant.auditBodies is on (off by default).
-- 0246–0250 are taken by branches in flight (coach, dashboard, analytics); 0260 leaves room. The runner orders by number and allows gaps.

CREATE TABLE IF NOT EXISTS ai_assistant_messages (
  id bigserial PRIMARY KEY,
  user_name text NOT NULL CHECK (char_length(user_name) BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '' CHECK (char_length(content) <= 40000),
  model text,
  drafts jsonb,
  tools text[] NOT NULL DEFAULT '{}',
  page text CHECK (page IS NULL OR char_length(page) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_assistant_messages_user_idx ON ai_assistant_messages (user_name, id DESC) WHERE cleared_at IS NULL;

CREATE TABLE IF NOT EXISTS ai_assistant_usage (
  user_name text NOT NULL CHECK (char_length(user_name) BETWEEN 1 AND 200),
  day text NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 80),
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  requests integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_name, day, model)
);

CREATE TABLE IF NOT EXISTS ai_assistant_audit (
  id bigserial PRIMARY KEY,
  user_name text NOT NULL CHECK (char_length(user_name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL CHECK (mode IN ('chat', 'assist')),
  models text[] NOT NULL DEFAULT '{}',
  route_reason text,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  tools text[] NOT NULL DEFAULT '{}',
  drafts integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('ok', 'error', 'aborted', 'refused')),
  error_code text,
  page text,
  duration_ms integer,
  user_message text,
  assistant_message text
);
CREATE INDEX IF NOT EXISTS ai_assistant_audit_user_idx ON ai_assistant_audit (user_name, created_at DESC);
