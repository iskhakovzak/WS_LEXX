-- Personal boards on /themes («Темы рынка» as an operator workspace, owner 2026-10-20; lib/themes/boards*,
-- routes/themes-boards.ts). Next to the shared board every member keeps up to 8 own boards (tabs), each with its own
-- columns and sort:
--   kind 'themes'   rows are themes: the user's own themes (user_themes.board_id) + shared themes he pinned
--   kind 'tickers'  rows are tickers: a list (≤ 50) or a Finviz screener (f= tokens + o=, top 25 / 50, resolved
--                   through the Finviz export and stored here for about an hour)
-- Archived with active = false, never deleted. The existing personal themes (0225) move into a default themes board
-- per user, named in the user's interface language. user_themes keeps every row.

CREATE TABLE IF NOT EXISTS user_boards (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  kind text NOT NULL CHECK (kind IN ('themes', 'tickers')),
  position integer NOT NULL DEFAULT 0,
  columns text[] NOT NULL DEFAULT '{}',
  sort jsonb,
  pinned integer[] NOT NULL DEFAULT '{}',
  source text CHECK (source IN ('tickers', 'screener')),
  tickers text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tickers) <= 50),
  filters text[] NOT NULL DEFAULT '{}' CHECK (cardinality(filters) <= 15),
  sort_order text,
  top_n integer NOT NULL DEFAULT 25 CHECK (top_n IN (25, 50)),
  resolved_tickers text[] NOT NULL DEFAULT '{}',
  resolved_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'themes' OR source IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS user_boards_user_idx ON user_boards (user_id, active, position, id);

ALTER TABLE user_themes ADD COLUMN IF NOT EXISTS board_id integer;
CREATE INDEX IF NOT EXISTS user_themes_board_idx ON user_themes (board_id) WHERE board_id IS NOT NULL;

-- Existing personal themes → one default themes board per owner (only owners without any themes board yet).
INSERT INTO user_boards (user_id, name, kind, position)
SELECT o.user_id,
       CASE u.locale WHEN 'en' THEN 'My themes' WHEN 'uz' THEN 'Mening mavzularim' ELSE 'Мои темы' END,
       'themes', 0
  FROM (SELECT DISTINCT user_id FROM user_themes) o
  LEFT JOIN users u ON u.id = o.user_id
 WHERE NOT EXISTS (SELECT 1 FROM user_boards b WHERE b.user_id = o.user_id AND b.kind = 'themes');

UPDATE user_themes t
   SET board_id = b.id
  FROM (SELECT DISTINCT ON (user_id) id, user_id FROM user_boards WHERE kind = 'themes' ORDER BY user_id, position, id) b
 WHERE t.board_id IS NULL AND b.user_id = t.user_id;
