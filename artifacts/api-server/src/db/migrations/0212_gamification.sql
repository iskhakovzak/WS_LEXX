-- Gamification (owner 2026-10-18: «чтобы интерес был лучше и награды»; lib/gamification/*). Rewards discipline,
-- reviewing, planning and learning — never P&L, trade count or time in the app.
--
-- gamification_season_points: the monthly season score per trader (season = NY calendar month "YYYY-MM"): discipline
-- points of the month's contract days + bonus points of the quests done in the month. Written by every rewards / quests
-- evaluation of the trader (lib/quests/service → lib/gamification/seasonStore), so the ranking is one SELECT.
CREATE TABLE IF NOT EXISTS gamification_season_points (
  season text NOT NULL,                    -- YYYY-MM (New York calendar month)
  trader text NOT NULL,
  discipline_points integer NOT NULL DEFAULT 0,
  quest_points integer NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,       -- max(0, discipline + quests)
  active boolean NOT NULL DEFAULT false,   -- had a contract day, a traded day or a done quest in the month (league)
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, trader)
);
CREATE INDEX IF NOT EXISTS gamification_season_points_rank_idx ON gamification_season_points (season, points DESC);

-- gamification_seasons: a finished season, finalized once (primary key = idempotent): the final ranking that season
-- recognition (top 3) and «season_rank» rewards read.
CREATE TABLE IF NOT EXISTS gamification_seasons (
  season text PRIMARY KEY,
  ranking jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ trader, points, rank }] best first
  finalized_at timestamptz NOT NULL DEFAULT now()
);

-- gamification_profiles: what the trader chose (the title shown next to the name in rankings).
CREATE TABLE IF NOT EXISTS gamification_profiles (
  trader text PRIMARY KEY,
  active_title text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- setup_mastery: the last computed mastery level per trader and playbook setup (0..4) and the NY day it was reached —
-- a level-up is noticed once (recognition), and the «sniper» title carries the day.
CREATE TABLE IF NOT EXISTS setup_mastery (
  trader text NOT NULL,
  setup_id integer NOT NULL,
  level integer NOT NULL DEFAULT 0,
  level_on text NOT NULL,                  -- YYYY-MM-DD, New York
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trader, setup_id)
);

-- recognition_events: achievement tiers, long contract streaks, season top 3, mastery level-ups, rewards granted. One
-- row per (trader, kind, ref) — awarded once. Shown in the desk feed (rendered per reader); posted to the Telegram group
-- only when gamification.telegramGroup is on, in production, and the trader shares achievements (posted_at = sent).
CREATE TABLE IF NOT EXISTS recognition_events (
  id serial PRIMARY KEY,
  trader text NOT NULL,
  kind text NOT NULL,                      -- achievement | streak | season_top | mastery | reward
  ref text NOT NULL,                       -- e.g. 'contract_streak:gold', '75:2026-10-16', '2026-09', '12:3', 'grant:5'
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  day text NOT NULL,                       -- YYYY-MM-DD, New York
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (trader, kind, ref)
);
CREATE INDEX IF NOT EXISTS recognition_events_day_idx ON recognition_events (day);

-- reward_items: the catalog of REAL rewards an admin defines (title / description are the owner's own words, not
-- translated). Not bought with points: a condition makes a trader eligible.
--   achievement  ref = line id, tier = tier or NULL (any tier)
--   level        ref = level number as text ('3')
--   season_rank  ref = 'season', rank = N (top N of a finished season; each season is its own grant)
--   mastery      ref = setup code ('1.3') or '' (any setup), tier = level '1'..'4'
CREATE TABLE IF NOT EXISTS reward_items (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text,
  condition_kind text NOT NULL CHECK (condition_kind IN ('achievement', 'level', 'season_rank', 'mastery')),
  condition_ref text NOT NULL DEFAULT '',
  condition_tier text,
  condition_rank integer,
  active boolean NOT NULL DEFAULT false,
  stock integer,                           -- NULL = unlimited; a grant takes one
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- reward_grants: eligible → requested → granted | declined. One row per (item, trader, ref): ref = the season for
-- season_rank items, '' otherwise — eligibility is inserted once (ON CONFLICT DO NOTHING) and notified once.
CREATE TABLE IF NOT EXISTS reward_grants (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES reward_items (id),
  trader text NOT NULL,
  ref text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible', 'requested', 'granted', 'declined')),
  eligible_at timestamptz NOT NULL DEFAULT now(),
  requested_at timestamptz,
  decided_at timestamptz,
  decided_by text,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, trader, ref)
);
CREATE INDEX IF NOT EXISTS reward_grants_status_idx ON reward_grants (status, updated_at);
CREATE INDEX IF NOT EXISTS reward_grants_trader_idx ON reward_grants (trader);

-- Example catalog (inactive: the owner edits and enables them in the admin editor). Seeded once.
INSERT INTO reward_items (title, description, condition_kind, condition_ref, condition_tier, condition_rank, active, stock, created_by)
SELECT v.title, v.description, v.kind, v.ref, v.tier, v.rank, false, v.stock, 'system'
  FROM (VALUES
    ('Обед с руководителем деска', 'Победитель сезона: обед и разбор месяца с руководителем деска.', 'season_rank', 'season', NULL, 1, NULL::integer),
    ('Книга по трейдингу на выбор', 'За золото в серии контракта: любая книга из списка деска.', 'achievement', 'contract_streak', 'gold', NULL, NULL::integer),
    ('Разбор 1:1 с сеньором', 'Мастер сетапа: час разбора своих сделок с сеньор-трейдером.', 'mastery', '', '4', NULL, NULL::integer),
    ('Худи деска', 'Уровень «Стабильный» по очкам дисциплины.', 'level', '3', NULL, NULL, 20),
    ('Курс или вебинар за счёт деска', 'За золото в разборах дней: обучение на выбор.', 'achievement', 'reviews_total', 'gold', NULL, NULL::integer)
  ) AS v(title, description, kind, ref, tier, rank, stock)
 WHERE NOT EXISTS (SELECT 1 FROM reward_items);
