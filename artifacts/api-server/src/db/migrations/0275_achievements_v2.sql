-- Achievements v2 (lib/quests/achievements.ts + lib/achievements/*): many more lines across the day / week / month
-- horizons, the signature ones (a leak closed, setup mastery by a confirmed edge, the comeback after a stop, the path
-- steps), curator kudos, the ceremony for big wins and the link to the capital allocation engine.
--
-- (1) trader_achievements gets:
--     detail   jsonb   what a dynamic line is about: { setupId, name } (setup mastery), { slice } (a closed leak),
--                      { stage, metric } (a path step); null for the static lines
--     lost_on  text    NY day a held tier stopped holding (setup mastery decays when the edge is no longer confirmed;
--                      a closed leak whose new trades are losing again). Cleared when it holds again. The tier stays earned.
--     seen_at  timestamptz  the trader saw the ceremony of a big win (or the award came from a history recount)
ALTER TABLE trader_achievements ADD COLUMN IF NOT EXISTS detail jsonb;
ALTER TABLE trader_achievements ADD COLUMN IF NOT EXISTS lost_on text;
ALTER TABLE trader_achievements ADD COLUMN IF NOT EXISTS seen_at timestamptz;
-- Everything awarded before this release was already announced the old way: no ceremony for it.
UPDATE trader_achievements SET seen_at = created_at WHERE seen_at IS NULL;

-- (2) Curator kudos tied to one trading day (and optionally one trade of it): one per author, trader, day and trade.
CREATE TABLE IF NOT EXISTS achievement_kudos (
  id serial PRIMARY KEY,
  trader text NOT NULL,
  author text NOT NULL,
  day text NOT NULL,
  trade_id integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT achievement_kudos_day_check CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT achievement_kudos_self_check CHECK (trader <> author)
);
CREATE UNIQUE INDEX IF NOT EXISTS achievement_kudos_once ON achievement_kudos (author, trader, day, COALESCE(trade_id, 0));
CREATE INDEX IF NOT EXISTS achievement_kudos_trader_idx ON achievement_kudos (trader, day);
