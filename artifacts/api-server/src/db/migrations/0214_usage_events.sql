-- Internal usage tracking for the pilot (owner 2026-10-19: «надо ВИДЕТЬ, чем стажёры реально пользуются»; lib/usage/*,
-- routes/usage.ts, admin console → «Использование»). Staff-only view; never used for rewards, rankings or pay.
--
-- usage_events  one row per screen view or key action of a signed-in member, sent by the web tracker in batches
--               (POST /api/usage/batch). key = a NORMALISED route pattern ("/playbook", "/trades/:id",
--               "/ratings?tab=quests") or an allow-listed action key ("daily.review"); ids, dates, tickers and names
--               never reach this table (the server re-normalises and drops anything that does not fit). meta = a tiny
--               allow-listed object (setup code, trainer mode) or NULL. ny_day = New York calendar day of `at`.
--               Retention: the nightly job usage.prune deletes rows older than the setting usage.retentionDays (120).
CREATE TABLE IF NOT EXISTS usage_events (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trader text NOT NULL,                     -- stored user name at the time of the event (the id everywhere else)
  role text NOT NULL,                       -- trader | curator | admin at the time of the event
  kind text NOT NULL CHECK (kind IN ('view', 'action')),
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 120),
  ny_day text NOT NULL,                     -- YYYY-MM-DD, New York
  at timestamptz NOT NULL DEFAULT now(),
  meta jsonb
);
CREATE INDEX IF NOT EXISTS usage_events_day_idx ON usage_events (ny_day, user_id);
CREATE INDEX IF NOT EXISTS usage_events_user_day_idx ON usage_events (user_id, ny_day);
CREATE INDEX IF NOT EXISTS usage_events_at_idx ON usage_events (at);
