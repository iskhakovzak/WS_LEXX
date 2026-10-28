-- «Автоотчёт за сезон» (lib/deskPulse/reportStore.ts, routes/season-report.ts): the report itself is computed from
-- PropReports trades every time and never stored. The trader writes only the conclusions, and they live in his Playbook
-- (a note entry, source_type 'season_report'); this row links a trader's period to that entry so it is updated in
-- place, and lets the curator see whose conclusions are written. A deleted Playbook entry just unlinks.
CREATE TABLE IF NOT EXISTS season_reports (
  id          serial      PRIMARY KEY,
  trader      text        NOT NULL CHECK (char_length(trader) BETWEEN 1 AND 200),
  from_day    text        NOT NULL CHECK (from_day ~ '^\d{4}-\d{2}-\d{2}$'),
  to_day      text        NOT NULL CHECK (to_day ~ '^\d{4}-\d{2}-\d{2}$'),
  playbook_id integer     REFERENCES playbook(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trader, from_day, to_day),
  CHECK (from_day <= to_day)
);
