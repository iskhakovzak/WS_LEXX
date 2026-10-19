-- «Тренажёр» (owner 2026-10-18: one trainer instead of three; lib/trainer/*, routes/trainer.ts, routes/chartDrawings.ts).
--
-- trainer_daily_challenges  «Задача дня»: one ticker-day per NY challenge date, the same for the whole desk, picked
--                           at 08:30 NY (job trainer.daily-pick, or lazily on the first read). The row is the pick:
--                           INSERT … ON CONFLICT DO NOTHING keeps it idempotent across processes. desk_traders = how
--                           many desk traders traded that ticker on bars_day (0 normally; > 0 only when the archive had
--                           no clean day — those traders are left out of the ranking).
-- Daily games are ordinary sim_games rows (mode 'intraday') marked by params.daily = {"date": "YYYY-MM-DD"}; one per
-- user and challenge date (the unique index below; an abandoned one is re-activated, never replaced).
CREATE TABLE IF NOT EXISTS trainer_daily_challenges (
  date text PRIMARY KEY,                    -- NY challenge date (a trading day)
  ticker text NOT NULL,
  bars_day text NOT NULL,                   -- the archived NY trading day whose bars are played
  tf text NOT NULL DEFAULT '1m',
  desk_traders integer NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  picked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trainer_daily_challenges_key_idx ON trainer_daily_challenges (ticker, bars_day);

CREATE UNIQUE INDEX IF NOT EXISTS sim_games_daily_uq ON sim_games (user_id, (params #>> '{daily,date}')) WHERE params ? 'daily';
CREATE INDEX IF NOT EXISTS sim_games_daily_date_idx ON sim_games ((params #>> '{daily,date}')) WHERE params ? 'daily';

-- trainer_drills  «Найди вход»: one drill per source trade (a playbook example of an office setup, or a desk trade
-- linked to the setup with R ≥ 0) that has archived 1-minute bars and timed fills. The reference entry is the real
-- first fill (entry_at / entry_price); bars are read from the permanent candle archive when the drill is served.
-- disabled = the bars turned out unusable (too short / no bar at the fill) — never served again.
CREATE TABLE IF NOT EXISTS trainer_drills (
  id serial PRIMARY KEY,
  setup_id integer NOT NULL,
  source text NOT NULL CHECK (source IN ('playbook_example', 'desk_trade')),
  trade_id integer NOT NULL,
  trader text NOT NULL,                     -- owner of the source trade (never served to him)
  ticker text NOT NULL,
  day text NOT NULL,
  side text NOT NULL CHECK (side IN ('long', 'short')),
  entry_at timestamptz NOT NULL,
  entry_price numeric(16, 4) NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trainer_drills_trade_uq ON trainer_drills (trade_id);
CREATE INDEX IF NOT EXISTS trainer_drills_setup_idx ON trainer_drills (setup_id) WHERE NOT disabled;

-- trainer_drill_attempts  every answer. first = the user's first answer on that drill (only first answers feed setup
-- mastery: lib/trainer/drillStore drillMasteryCounts; passed = score ≥ trainer.drillPassScore at answer time).
CREATE TABLE IF NOT EXISTS trainer_drill_attempts (
  id serial PRIMARY KEY,
  drill_id integer NOT NULL REFERENCES trainer_drills(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trader text NOT NULL,
  setup_id integer NOT NULL,
  bar_index integer NOT NULL,
  price numeric(16, 4) NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  first boolean NOT NULL DEFAULT false,
  passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trainer_drill_attempts_first_uq ON trainer_drill_attempts (user_id, drill_id) WHERE first;
CREATE INDEX IF NOT EXISTS trainer_drill_attempts_user_idx ON trainer_drill_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trainer_drill_attempts_trader_idx ON trainer_drill_attempts (trader, setup_id) WHERE first;

-- chart_drawings  per-user drawings on a ticker-day (replay / analysis): GET/PUT /api/chart/drawings?ticker=&date=.
-- drawings = ChartDrawing[] (lib/trainer/types.ts), validated and capped by the route.
CREATE TABLE IF NOT EXISTS chart_drawings (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  day text NOT NULL,
  drawings jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ticker, day)
);
