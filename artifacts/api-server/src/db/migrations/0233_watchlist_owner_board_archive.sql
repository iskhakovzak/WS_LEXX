-- Волна 1, items 1.18 and 1.15 (owner decisions 2 and 10, 2026-10-20). Idempotent, nothing is deleted.
--
-- 1.18 Two watchlists: watchlist.owner = users.id of a trader's personal list; NULL = the desk list (every existing row
--      stays on the desk list). The desk list is read by everyone and written by seniors and staff; a personal list
--      only by its owner (routes/watchlist.ts, lib/watchlist/scope.ts). list_name (the working list «Сегодня / Свинги /
--      Наблюдаю») moves from a request-time ALTER TABLE into this migration.
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS owner integer;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS list_name text;
CREATE INDEX IF NOT EXISTS watchlist_owner_idx ON watchlist (owner, deleted_at);

-- 1.15 A board archived («Удалить») archives its themes with it: archived_with_board marks the themes that come back
--      when the board is restored (a theme archived on its own stays archived). Themes left active on boards that were
--      archived before this migration stop taking the limit of 10 and return with their board.
ALTER TABLE user_themes ADD COLUMN IF NOT EXISTS archived_with_board boolean NOT NULL DEFAULT false;
UPDATE user_themes t
   SET active = false, archived_with_board = true, updated_at = now()
  FROM user_boards b
 WHERE t.board_id = b.id AND t.active AND NOT b.active;
