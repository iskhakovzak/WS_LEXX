-- Roadmap R3 «consistency, alert budget, curator digest».
-- (1) telegram_push_log: every Telegram push to a person (lib/notificationCore pushVerdict, lib/pushBudget claimPush),
--     one row per push and New York day. The budget (alerts.budget.dailyPush, alerts.budget.coachingPush) counts the
--     non-risk rows of the day; risk pushes are never capped but deduplicated by dedup_key; a daily-loop contract alert
--     is held back while a risk push to the same person is fresher than alerts.budget.riskQuietMinutes.
-- (2) notification_batch_items: quest_done / achievement_earned waiting for the nightly in-app batch
--     (job notifications.rewards-batch, lib/notificationBatch): one notification per person instead of a ping each.
-- (3) eod_days.full_review_at: the day was closed through the full EOD form (POST /eod/day/:date/close) with at least
--     one trade review or mistake verdict. Rewards (reviews_total, review_streak, full_loop) count only these; the one-tap
--     «Разобрал» is «seen». Backfilled for journal-closed days that have a trade review.

CREATE TABLE IF NOT EXISTS telegram_push_log (
  id bigserial PRIMARY KEY,
  user_name text NOT NULL,
  ny_date date NOT NULL,
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 60),
  category text NOT NULL CHECK (category IN ('risk', 'coaching', 'standard')),
  dedup_key text CHECK (dedup_key IS NULL OR char_length(dedup_key) <= 200),
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_push_log_user_day_idx ON telegram_push_log (user_name, ny_date);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_push_log_dedup_idx ON telegram_push_log (user_name, ny_date, dedup_key) WHERE dedup_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_batch_items (
  id bigserial PRIMARY KEY,
  user_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('quest_done', 'achievement_earned')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  flushed_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_batch_items_pending_idx ON notification_batch_items (user_name) WHERE flushed_at IS NULL;

ALTER TABLE eod_days ADD COLUMN IF NOT EXISTS full_review_at timestamptz;

UPDATE eod_days d SET full_review_at = d.closed_at
 WHERE d.closed_at IS NOT NULL AND d.full_review_at IS NULL
   AND COALESCE(d.summary ->> 'via', '') <> 'daily'
   AND EXISTS (
     SELECT 1 FROM eod_trade_reviews r JOIN trades t ON t.id = r.trade_id
      WHERE r.trader = d.trader AND t.deleted_at IS NULL
        AND (LEFT(t.date, 10) = d.date::text OR LEFT(NULLIF(t.exit_date, ''), 10) = d.date::text)
        AND (r.followed_plan IS NOT NULL OR cardinality(r.mistakes) > 0 OR btrim(COALESCE(r.lesson, '')) <> ''));
