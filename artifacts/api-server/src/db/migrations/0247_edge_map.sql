-- Edge map with desk shrinkage (roadmap R4, lib/edgeMap.ts + lib/edgeMapStore.ts, job edgemap.nightly 18:40 NY).
-- One row per trader × pre-trade slice × as-of date. Money of the slice: n trades on `days` days, Σ net $; per-trade
-- mean in bps of notional (xbar_bps, its day-clustered bootstrap se), the shrunk θ with its 80% interval (lo80 / hi80,
-- bps), the BH q value across the trader's slices, how many of the last three 60-day blocks share θ's sign, and θ in
-- $ per active day (cost_per_day, cost_lo / cost_hi = its 80% interval). prior_mu / prior_tau = the desk prior used.
-- verdict LEAK / STRENGTH passes every gate; NONE is never shown to anyone. The latest run keeps every row; older
-- runs keep only their verdicts (monthly precision: was a LEAK still negative 60 days later?).
CREATE TABLE IF NOT EXISTS edge_map (
  id             bigserial     PRIMARY KEY,
  trader         text          NOT NULL,
  as_of          date          NOT NULL,
  slice_key      text          NOT NULL,
  family         text          NOT NULL,
  n              integer       NOT NULL,
  days           integer       NOT NULL,
  net            numeric(14,2) NOT NULL,
  xbar_bps       numeric(12,4) NOT NULL,
  se_bps         numeric(12,4) NOT NULL,
  theta_bps      numeric(12,4) NOT NULL,
  lo80           numeric(12,4) NOT NULL,
  hi80           numeric(12,4) NOT NULL,
  q              numeric(10,6),
  persist_blocks smallint      NOT NULL DEFAULT 0,
  verdict        text          NOT NULL CHECK (verdict IN ('LEAK', 'STRENGTH', 'NONE')),
  cost_per_day   numeric(12,2) NOT NULL,
  cost_lo        numeric(12,2) NOT NULL,
  cost_hi        numeric(12,2) NOT NULL,
  prior_mu       numeric(12,4) NOT NULL,
  prior_tau      numeric(12,4) NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT edge_map_key UNIQUE (trader, as_of, slice_key)
);
CREATE INDEX IF NOT EXISTS edge_map_latest_idx ON edge_map (trader, as_of DESC);
CREATE INDEX IF NOT EXISTS edge_map_verdict_idx ON edge_map (as_of, verdict) WHERE verdict <> 'NONE';
