-- Personal market themes («Мои темы», owner 2026-10-20; lib/themes/personal*, routes/themes.ts): any signed-in member
-- keeps up to 10 own themes, visible only to the owner, merged into his /themes table.
--   kind 'tickers'   name + 1–30 US tickers
--   kind 'screener'  name + Finviz screener filters (f= tokens, strict a-z0-9_) and an optional order (o=); the
--                    tickers are resolved through the Finviz export (top 25), cached here for about an hour.
-- Archived with active = false, never deleted. The per-user column / hidden-theme view of /themes lives in
-- users.settings.themesView (the existing per-user settings JSONB), not here.

CREATE TABLE IF NOT EXISTS user_themes (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('tickers', 'screener')),
  tickers text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tickers) <= 30),
  filters text[] NOT NULL DEFAULT '{}' CHECK (cardinality(filters) <= 15),
  sort_order text,
  resolved_tickers text[] NOT NULL DEFAULT '{}',
  resolved_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'tickers' AND cardinality(tickers) >= 1) OR (kind = 'screener' AND cardinality(filters) >= 1))
);
CREATE INDEX IF NOT EXISTS user_themes_user_idx ON user_themes (user_id, active, id);
