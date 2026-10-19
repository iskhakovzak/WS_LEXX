-- «Тренажёр 2» (owner 2026-10-19: «скипать на следующее и после сразу к следующему»): series of games, skip, prepared
-- next game (lib/sim/series.ts, lib/sim/seriesStore.ts).
--   • sim_series: one row per series (mode / level / timeframe fixed, `size` games). The current and the prepared next
--     game are sim_games rows pointing at it (series_id); results are read from those rows, never duplicated here.
--   • sim_games.status gains 'skipped' (ended by POST /api/sim/games/:id/skip before any order: out of stats,
--     leaderboards, quests and mastery — every reader already filters status = 'finished') and 'prepared' (the next
--     game of a series, built in advance so «next» is instant; becomes 'active' only on «next», so the one-active-game
--     index is untouched).
-- Nothing is deleted or rewritten; existing rows keep their status.
CREATE TABLE IF NOT EXISTS sim_series (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('intraday', 'swing')),
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  tf text CHECK (tf IS NULL OR tf IN ('1m', '2m', '5m')),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 50),
  idx integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'abandoned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS sim_series_user_idx ON sim_series (user_id, id DESC);

ALTER TABLE sim_games ADD COLUMN IF NOT EXISTS series_id integer REFERENCES sim_series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sim_games_series_idx ON sim_games (series_id, id) WHERE series_id IS NOT NULL;

ALTER TABLE sim_games DROP CONSTRAINT IF EXISTS sim_games_status_check;
ALTER TABLE sim_games ADD CONSTRAINT sim_games_status_check
  CHECK (status IN ('active', 'finished', 'abandoned', 'skipped', 'prepared'));
