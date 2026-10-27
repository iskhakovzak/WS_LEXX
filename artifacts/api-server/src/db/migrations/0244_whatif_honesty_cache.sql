-- What-if honest verdicts (lib/whatIfHonesty): walk-forward + Romano–Wolf with re-pick per trader takes from a tenth
-- of a second to a few seconds, so the job whatif.honesty computes it in the background and GET /whatif/suggestions
-- reads it from here (lib/whatIfHonestyStore). One row per (trader, period, data signature, engine version):
-- queued → running → ready | failed. result = HonestyResult (rules and numbers only; labels are rendered per request
-- language). trader = trades.trader; period_from / period_to = the requested period ('' = open end).
-- used_at = last time a request asked for this key (served or queued): the evening precompute and the 14-day prune.
CREATE TABLE IF NOT EXISTS whatif_honesty_cache (
  id             bigserial   PRIMARY KEY,
  trader         text        NOT NULL,
  period_from    text        NOT NULL DEFAULT '',
  period_to      text        NOT NULL DEFAULT '',
  data_sig       text        NOT NULL,
  engine_version integer     NOT NULL,
  state          text        NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'ready', 'failed')),
  result         jsonb,
  error          text,
  attempts       integer     NOT NULL DEFAULT 0,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  used_at        timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  duration_ms    integer,
  CONSTRAINT whatif_honesty_cache_key UNIQUE (trader, period_from, period_to, data_sig, engine_version)
);
CREATE INDEX IF NOT EXISTS whatif_honesty_cache_queue_idx ON whatif_honesty_cache (requested_at, id) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS whatif_honesty_cache_recent_idx ON whatif_honesty_cache (trader, period_from, period_to, used_at DESC);
