-- Волна 1 п. 1.1 «Попросить куратора»: wherever a trader sees «задаёт куратор» (limits, learning group, stage, desk
-- plan) he can ask with one button; the request lands in the curator cabinet («Сегодня» → «Запросы») and the answer
-- comes back as a notification (routes/curator-requests.ts, lib/people/curatorRequests.ts).
--   kind     limits | group | stage | plan | other
--   status   open → done | dismissed (resolved_at / resolved_by_id / note); never deleted
-- One open request per trader and kind (partial unique index) — a second click answers CURATOR_REQUEST_OPEN.

CREATE TABLE IF NOT EXISTS curator_requests (
  id serial PRIMARY KEY,
  trader_id integer NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('limits', 'group', 'stage', 'plan', 'other')),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_id integer REFERENCES users (id),
  CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS curator_requests_open_uniq ON curator_requests (trader_id, kind) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS curator_requests_status_idx ON curator_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS curator_requests_trader_idx ON curator_requests (trader_id, created_at DESC);
