-- Capital allocation engine (lib/capital/*, routes/capital.ts, job capital.weekly): per trader raise / keep / cut of the
-- daily loss limit (buying power in the same ratio) from the shrunk edge, the edge in the current desk regime and
-- discipline. Its proposals go into the EXISTING scaling queue (scaling_proposals) — one pending decision per trader stays
-- (scaling_proposals_pending_uniq); a tier proposal withdraws a pending capital one (the ladder goes first).
-- Applied changes are recorded in scaling_history (action 'raise' / 'cut' / 'revert', from_tier = to_tier,
-- limits = { kind: 'capital', before, after, eventId, revertOf? }) and trader_risk_limit_events, audited in audit_log.
-- 0270 leaves room for parallel branches after 0263 (market_regime).

-- (1) What a proposal changes: 'tier' (the ladder, as before) or 'limits' (capital allocation).
ALTER TABLE scaling_proposals ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'tier';
ALTER TABLE scaling_proposals DROP CONSTRAINT IF EXISTS scaling_proposals_kind_check;
ALTER TABLE scaling_proposals ADD CONSTRAINT scaling_proposals_kind_check CHECK (kind IN ('tier', 'limits'));

-- (2) The limits a capital proposal moves: { week, direction, stepPct, before: {dailyLossLimit, buyingPower},
--     after: {…}, expected: {perDay, sdPerDay}, composite, withdrawn? }. Required for kind 'limits'.
ALTER TABLE scaling_proposals ADD COLUMN IF NOT EXISTS limits jsonb;
ALTER TABLE scaling_proposals DROP CONSTRAINT IF EXISTS scaling_proposals_limits_check;
ALTER TABLE scaling_proposals ADD CONSTRAINT scaling_proposals_limits_check CHECK (kind = 'tier' OR limits IS NOT NULL);

-- (3) «Decided this week» lookups of the weekly job (idempotent re-runs) and the «Откатить» list.
CREATE INDEX IF NOT EXISTS scaling_proposals_limits_week_idx ON scaling_proposals ((limits ->> 'week')) WHERE kind = 'limits';
CREATE INDEX IF NOT EXISTS scaling_history_capital_idx ON scaling_history (created_at DESC) WHERE limits ->> 'kind' = 'capital';
