-- Expected move on earnings (lib/expectedMove/*, routes/expected-move.ts, job «em.snapshot»). The EM a report was
-- expected to make is only known BEFORE it: the job snapshots it so the post-report check («EM broken») compares the
-- reaction-day move with what the market priced in, not with a number recomputed afterwards.
--
--   source       implied     the at-the-money straddle of the free options chain (lib/options: Yahoo / NASDAQ, delayed)
--                historical  the average |reaction move| of the ticker's earlier reports in the candle archive (used
--                            when no chain answered; labelled «historical» on screen)
--   em_pct       the move in %, prior_close the close it applies to (levels = prior_close × (1 ± em_pct / 100))
--   expiration   the option expiration the straddle came from (implied only)
-- A cache-like table keyed by (ticker, report_date): no person column, nothing user-typed.
CREATE TABLE IF NOT EXISTS expected_moves (
  ticker       text        NOT NULL CHECK (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  report_date  text        NOT NULL CHECK (report_date ~ '^\d{4}-\d{2}-\d{2}$'),
  source       text        NOT NULL CHECK (source IN ('implied', 'historical')),
  em_pct       numeric(8,4) NOT NULL CHECK (em_pct > 0 AND em_pct < 1000),
  prior_close  numeric(14,4),
  expiration   text        CHECK (expiration IS NULL OR expiration ~ '^\d{4}-\d{2}-\d{2}$'),
  captured_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, report_date)
);
CREATE INDEX IF NOT EXISTS expected_moves_report_idx ON expected_moves (report_date);
