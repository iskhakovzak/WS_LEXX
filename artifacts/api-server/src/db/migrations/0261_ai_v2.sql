-- Assistant v2 (lib/assistant/*, routes/ai-assistant.ts, routes/aireview.ts, docs/AI_ASSISTANT.md).
-- (1) Unified daily budget: the per-model budgets assistant.dailyTokensDefault / assistant.dailyTokensSmart are replaced
--     by one budget in units (assistant.dailyUnits, default 1,000,000; default-model tokens 1x, boosted / escalated /
--     advisor tokens assistant.boostMultiplier x). The old rows are dropped: their numbers meant tokens of one model
--     class, the new budget counts both, so carrying them over would mis-size it. Usage rows stay per model
--     (ai_assistant_usage), units are derived on read.
-- (2) ai_reviews: structured AI reviews of a trade or a day (lib/assistant/review). One row per generation; the cache
--     key is (kind, trader, subject, version, input_hash, lang): the same inputs under the same review version are
--     served from here at no cost. review = the validated JSON; units = budget units it cost the requester.
-- 0261 is the next free number on main (0260 = ai_assistant). The runner orders by number and allows gaps.

DELETE FROM app_settings WHERE key IN ('assistant.dailyTokensDefault', 'assistant.dailyTokensSmart');

-- (3) What members see about an answer is its tier (standard / boost / deep), never the model: the history row keeps
--     the tier next to the model (the model column stays for the audit trail and is never sent to the web).
ALTER TABLE ai_assistant_messages ADD COLUMN IF NOT EXISTS tier text CHECK (tier IS NULL OR tier IN ('standard', 'boost', 'deep'));

-- (4) The audit also records AI reviews (mode 'review').
ALTER TABLE ai_assistant_audit DROP CONSTRAINT IF EXISTS ai_assistant_audit_mode_check;
ALTER TABLE ai_assistant_audit ADD CONSTRAINT ai_assistant_audit_mode_check CHECK (mode IN ('chat', 'assist', 'review'));

CREATE TABLE IF NOT EXISTS ai_reviews (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('trade', 'day')),
  trader text NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  trade_id integer,
  day text CHECK (day IS NULL OR day ~ '^\d{4}-\d{2}-\d{2}$'),
  version integer NOT NULL,
  input_hash text NOT NULL CHECK (char_length(input_hash) = 64),
  lang text NOT NULL CHECK (lang IN ('ru', 'en', 'uz')),
  review jsonb NOT NULL,
  facts jsonb,
  deep boolean NOT NULL DEFAULT false,
  units bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'trade' AND trade_id IS NOT NULL) OR (kind = 'day' AND day IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ai_reviews_trade_idx ON ai_reviews (trade_id, created_at DESC) WHERE kind = 'trade';
CREATE INDEX IF NOT EXISTS ai_reviews_day_idx ON ai_reviews (trader, day, created_at DESC) WHERE kind = 'day';
