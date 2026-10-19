-- Quests and achievements (owner 2026-10-18: «добавить квесты и ачивки — очень развей эту систему»; lib/quests/*).
-- Reward following the rules, reviewing, planning and learning — never P&L, trade count or time in the app.
--
-- trader_achievements: one row per (trader, line, tier), awarded once (primary key = idempotent awarding:
-- INSERT … ON CONFLICT DO NOTHING). earned_on = the NY trading day it was earned, target = the tier's number at that
-- moment (a later settings change never rewrites history). The 8 discipline badges (trader_badges, 0204) become tiers
-- of these lines; their rows are copied below with the original days (trader_badges stays, read-only).
CREATE TABLE IF NOT EXISTS trader_achievements (
  trader text NOT NULL,
  line text NOT NULL,                      -- lib/quests/achievements.ts LINE ids (contract_streak, reviews_total …)
  tier text NOT NULL,                      -- bronze | silver | gold | platinum
  earned_on text NOT NULL,                 -- YYYY-MM-DD, New York trading day
  target integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trader, line, tier)
);
CREATE INDEX IF NOT EXISTS trader_achievements_earned_idx ON trader_achievements (trader, earned_on);

-- Badge → (line, tier) map (the same map as lib/quests/achievements.ts BADGE_TIER). «reviews» (10 reviewed days in
-- a row) is the silver tier of the review streak; its bronze tier (5 in a row) was necessarily reached by then.
INSERT INTO trader_achievements (trader, line, tier, earned_on, target, created_at)
SELECT b.trader, m.line, m.tier, b.awarded_on, b.target, b.created_at
  FROM trader_badges b
  JOIN (VALUES
    ('streak_1', 'contract_streak', 'bronze'), ('streak_2', 'contract_streak', 'silver'), ('streak_3', 'contract_streak', 'gold'),
    ('reviews', 'review_streak', 'silver'), ('reviews', 'review_streak', 'bronze'),
    ('focus', 'focus_beaten', 'bronze'), ('clean_month', 'clean_month', 'bronze'),
    ('sim_first', 'own_replays', 'bronze'), ('sim_beat', 'beat_yourself', 'bronze')
  ) AS m(badge, line, tier) ON m.badge = b.badge
ON CONFLICT (trader, line, tier) DO NOTHING;

-- quest_instances: one row per quest a trader got. Catalog quests (onboarding / daily / weekly / monthly) are created
-- lazily on read for the current period and are unique per (trader, scope, template, period) — a second process or
-- read creates nothing twice. Curator quests (period 'curator') are free rows: the partial index leaves them out.
-- status: active | done | failed | expired | cancelled (cancelled rows are never shown).
CREATE TABLE IF NOT EXISTS quest_instances (
  id serial PRIMARY KEY,
  trader text NOT NULL,
  scope text NOT NULL,                     -- onboarding | daily | weekly | monthly | curator
  template text NOT NULL,                  -- lib/quests/catalog.ts template key
  period text NOT NULL,                    -- 'once' | YYYY-MM-DD (daily: the day; weekly: its Monday) | YYYY-MM | 'curator'
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress integer NOT NULL DEFAULT 0,
  target integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  reward_points integer NOT NULL DEFAULT 0,
  starts_on text NOT NULL,                 -- YYYY-MM-DD, NY
  ends_on text,                            -- YYYY-MM-DD inclusive; NULL = no deadline (onboarding)
  completed_on text,                       -- NY day it was done (points count from that day)
  assigned_by text,
  note text,
  cancelled_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the trader (and the assigner) were told about the final status — notifications go out once.
  notified_status text
);
CREATE UNIQUE INDEX IF NOT EXISTS quest_instances_catalog_uq ON quest_instances (trader, scope, template, period) WHERE scope <> 'curator';
CREATE INDEX IF NOT EXISTS quest_instances_trader_idx ON quest_instances (trader, status);
CREATE INDEX IF NOT EXISTS quest_instances_assigner_idx ON quest_instances (assigned_by, updated_at) WHERE scope = 'curator';

-- quest_events: actions the site sees but no table stores yet (opening «Деск на тикере» for a ticker-day). One row per
-- (trader, kind, ref) — the first time counts.
CREATE TABLE IF NOT EXISTS quest_events (
  trader text NOT NULL,
  kind text NOT NULL,                      -- desk_day_open
  ref text NOT NULL,                       -- e.g. 'AMD|2026-09-24'
  day text NOT NULL,                       -- NY day of the event
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trader, kind, ref)
);

-- Badge thresholds moved from the rewards group to the achievements group (tier targets of the lines): carry over
-- values an admin already stored.
INSERT INTO app_settings (key, value, updated_by, updated_at)
SELECT m.new_key, s.value, s.updated_by, s.updated_at
  FROM app_settings s
  JOIN (VALUES
    ('rewards.streakBadge1Days', 'achievements.contractStreak1'), ('rewards.streakBadge2Days', 'achievements.contractStreak2'),
    ('rewards.streakBadge3Days', 'achievements.contractStreak3'), ('rewards.reviewStreakDays', 'achievements.reviewStreak2'),
    ('rewards.focusCleanDays', 'achievements.focusBeaten1'), ('rewards.simBeatCount', 'achievements.beatYourself1')
  ) AS m(old_key, new_key) ON m.old_key = s.key
ON CONFLICT (key) DO NOTHING;
