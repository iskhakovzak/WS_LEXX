-- Волна 1 п. 1.19 (owner decision 3): the desk is split into groups, each with its curator. A curator sees his group
-- by default («Моя группа / Все») in the queue, the cabinet and the Academy; the matrix scope `assigned` reads the group
-- (lib/permissions resolveActor). Groups are edited on one admin screen («Группы», routes/desk-groups.ts).
--   desk_groups   name, curator_id (users.id, NULL = no curator yet), sort_order, archived_at (never deleted)
--   users.group_id  the trader's group (NULL = «Без группы»)
-- The curator is stored by id (a rename keeps the link). Moving a trader into a group with a curator also sets
-- users.assigned_curator, so notifications keep reaching the right person.
-- Seed: one group per curator who already has assigned traders («Группа <имя куратора>»), its traders moved in —
-- only on a database without any group yet, so a re-run never duplicates.

CREATE TABLE IF NOT EXISTS desk_groups (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  curator_id integer REFERENCES users (id),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS desk_groups_name_active_uniq ON desk_groups (lower(name)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS desk_groups_curator_idx ON desk_groups (curator_id) WHERE archived_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS group_id integer REFERENCES desk_groups (id);
CREATE INDEX IF NOT EXISTS users_group_idx ON users (group_id) WHERE group_id IS NOT NULL;

DO $$
DECLARE n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM desk_groups) THEN
    INSERT INTO desk_groups (name, curator_id, sort_order)
    SELECT left(CASE c.locale WHEN 'en' THEN 'Group ' WHEN 'uz' THEN 'Guruh ' ELSE 'Группа ' END || c.name, 60),
           c.id, (row_number() OVER (ORDER BY c.name))::int
      FROM users c
     WHERE c.role IN ('curator', 'admin') AND c.active
       AND EXISTS (SELECT 1 FROM users t WHERE t.assigned_curator = c.name AND t.role = 'trader');
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE users t SET group_id = g.id
      FROM desk_groups g JOIN users c ON c.id = g.curator_id
     WHERE t.assigned_curator = c.name AND t.role = 'trader' AND t.group_id IS NULL;
  END IF;
  RAISE NOTICE 'desk_groups seeded from assigned curators: % groups', n;
END $$;
