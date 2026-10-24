-- Intervention log (roadmap R9a, lib/interventions/log.ts): one row per curator action on a trader, so the desk can
-- later measure what an action changed (R9b: ITS with matched controls; Wave 2). Logging only — nothing reads it for
-- decisions yet except the plateau detector (dip suppression, escalations without a logged intervention).
--
--   kind          what was done (codes, never text): limit_change | size_change | rule_added | rule_removed | rule_trial |
--                 focus_set | one_on_one | pause | quest | fee_plan | concern_note | plateau_review | scaling_decision
--   trigger       why now: scheduled | after_bad_period | plateau | breach | random | trader_request. Writers that do not
--                 know it get curator_intervention_trigger(): a breach alert in the last 5 days → breach; a negative net
--                 over the previous 28 calendar days (≈ 20 trading days) → after_bad_period (the regression-to-the-mean
--                 flag of R9b); else scheduled.
--   target_metric / target_slice   the outcome pre-registered for the effect estimate (daily net by default).
--   source_table / source_id       the row the action wrote (trader_risk_limit_events 17, trading_rules 5 …): UNIQUE, so a
--                 writer called twice and the one-time backfill below never duplicate a row.
--   author        the staff member (users.name); 'system' for detector rows (plateau escalations).
CREATE TABLE IF NOT EXISTS curator_interventions (
  id            bigserial   PRIMARY KEY,
  trader        text        NOT NULL,
  kind          text        NOT NULL CHECK (kind IN ('limit_change', 'size_change', 'rule_added', 'rule_removed', 'rule_trial',
                              'focus_set', 'one_on_one', 'pause', 'quest', 'fee_plan', 'concern_note', 'plateau_review', 'scaling_decision')),
  params        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  target_metric text,
  target_slice  text,
  trigger       text        NOT NULL DEFAULT 'scheduled'
                            CHECK (trigger IN ('scheduled', 'after_bad_period', 'plateau', 'breach', 'random', 'trader_request')),
  started_on    date        NOT NULL,
  ends_on       date,
  author        text,
  source_table  text,
  source_id     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curator_interventions_source_key UNIQUE (source_table, source_id)
);
CREATE INDEX IF NOT EXISTS curator_interventions_trader_idx ON curator_interventions (trader, started_on DESC, id DESC);
CREATE INDEX IF NOT EXISTS curator_interventions_kind_idx ON curator_interventions (kind, started_on);

-- The trigger of an action on `day` for `who` (see above). STABLE: reads risk_alert_log and trades.
CREATE OR REPLACE FUNCTION curator_intervention_trigger(who text, day date) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM risk_alert_log a
       WHERE a.trader = who AND a.level = 'breach'
         AND a.date >= to_char(day - 5, 'YYYY-MM-DD') AND a.date <= to_char(day, 'YYYY-MM-DD')
    ) THEN 'breach'
    WHEN (
      SELECT SUM(t.pnl - ABS(COALESCE(t.fees, 0))) FROM trades t
       WHERE t.trader = who AND t.deleted_at IS NULL AND t.pnl IS NOT NULL AND t.result <> 'open'
         AND LEFT(COALESCE(t.exit_date, t.date), 10) >= to_char(day - 28, 'YYYY-MM-DD')
         AND LEFT(COALESCE(t.exit_date, t.date), 10) < to_char(day, 'YYYY-MM-DD')
    ) < 0 THEN 'after_bad_period'
    ELSE 'scheduled'
  END
$$;

-- ─── one-time backfill from the tables curator actions already wrote (idempotent: ON CONFLICT DO NOTHING) ───────────
-- Only actions of a staff member on someone else count (author <> trader); 'system' rows are not curator actions.

-- Limit changes (manual and tier templates).
INSERT INTO curator_interventions (trader, kind, params, target_metric, trigger, started_on, author, source_table, source_id, created_at)
SELECT e.trader, 'limit_change', jsonb_strip_nulls(jsonb_build_object('backfill', true, 'reason', LEFT(e.reason, 200))), 'net_daily',
       curator_intervention_trigger(e.trader, (e.changed_at AT TIME ZONE 'America/New_York')::date),
       (e.changed_at AT TIME ZONE 'America/New_York')::date, e.changed_by, 'trader_risk_limit_events', e.id::text, e.changed_at
  FROM trader_risk_limit_events e
 WHERE e.changed_by IS NOT NULL AND e.changed_by <> e.trader AND e.changed_by <> 'system'
ON CONFLICT (source_table, source_id) DO NOTHING;

-- Office rules a staff member set for one trader (desk-wide '*' rules and the trader's own rules are not interventions).
INSERT INTO curator_interventions (trader, kind, params, target_metric, target_slice, trigger, started_on, author, source_table, source_id, created_at)
SELECT r.trader, 'rule_added', jsonb_build_object('backfill', true, 'rule', r.kind, 'ruleId', r.id), 'net_daily', 'rule:' || r.kind,
       curator_intervention_trigger(r.trader, (r.created_at AT TIME ZONE 'America/New_York')::date),
       (r.created_at AT TIME ZONE 'America/New_York')::date, r.created_by, 'trading_rules', r.id::text, r.created_at
  FROM trading_rules r
 WHERE r.origin = 'office' AND r.trader <> '*' AND r.created_by IS NOT NULL AND r.created_by <> r.trader AND r.created_by <> 'system'
ON CONFLICT (source_table, source_id) DO NOTHING;

-- Daily focus a curator set (one row per trader-day-mistake: the table keeps only the last focus of a day).
INSERT INTO curator_interventions (trader, kind, params, target_metric, target_slice, trigger, started_on, author, source_table, source_id, created_at)
SELECT f.trader, 'focus_set', jsonb_build_object('backfill', true, 'mistake', f.mistake, 'date', f.date), 'mistake_cost', 'mistake:' || f.mistake,
       curator_intervention_trigger(f.trader, f.date::date), f.date::date, f.set_by, 'daily_focus', f.trader || ':' || f.date || ':' || f.mistake, f.updated_at
  FROM daily_focus f
 WHERE f.source = 'curator' AND f.mistake IS NOT NULL AND f.set_by IS NOT NULL AND f.set_by <> f.trader AND f.date ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT (source_table, source_id) DO NOTHING;

-- 1:1 meetings (archived ones were still held).
INSERT INTO curator_interventions (trader, kind, params, target_metric, trigger, started_on, author, source_table, source_id, created_at)
SELECT m.student, 'one_on_one', jsonb_build_object('backfill', true, 'format', m.format), 'net_daily',
       curator_intervention_trigger(m.student, (m.met_at AT TIME ZONE 'America/New_York')::date),
       (m.met_at AT TIME ZONE 'America/New_York')::date, COALESCE(m.created_by, m.mentor), 'academy_one_on_ones', m.id::text, m.created_at
  FROM academy_one_on_ones m
 WHERE COALESCE(m.created_by, m.mentor) <> m.student
ON CONFLICT (source_table, source_id) DO NOTHING;

-- Curator quests.
INSERT INTO curator_interventions (trader, kind, params, target_metric, target_slice, trigger, started_on, ends_on, author, source_table, source_id, created_at)
SELECT q.trader, 'quest', jsonb_build_object('backfill', true, 'template', q.template, 'target', q.target), 'quest_progress', 'quest:' || q.template,
       curator_intervention_trigger(q.trader, q.starts_on::date), q.starts_on::date,
       CASE WHEN q.ends_on ~ '^\d{4}-\d{2}-\d{2}$' THEN q.ends_on::date END, q.assigned_by, 'quest_instances', q.id::text, q.created_at
  FROM quest_instances q
 WHERE q.scope = 'curator' AND q.assigned_by IS NOT NULL AND q.assigned_by <> q.trader AND q.starts_on ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT (source_table, source_id) DO NOTHING;

-- Tier decisions (approved proposals, manual assignments). A tier template applied from the risk desk also writes
-- scaling_history, but is already logged above as a limit change (a limit event by the same person, to the same tier,
-- within a minute).
INSERT INTO curator_interventions (trader, kind, params, target_metric, trigger, started_on, author, source_table, source_id, created_at)
SELECT h.trader, 'scaling_decision',
       jsonb_strip_nulls(jsonb_build_object('backfill', true, 'action', h.action, 'fromTier', h.from_tier, 'toTier', h.to_tier, 'proposalId', h.proposal_id)), 'net_daily',
       curator_intervention_trigger(h.trader, (h.created_at AT TIME ZONE 'America/New_York')::date),
       (h.created_at AT TIME ZONE 'America/New_York')::date, h.actor, 'scaling_history', h.id::text, h.created_at
  FROM scaling_history h
 WHERE h.actor <> h.trader AND h.actor <> 'system'
   AND NOT EXISTS (
     SELECT 1 FROM trader_risk_limit_events e
      WHERE e.trader = h.trader AND e.changed_by = h.actor AND e.after ->> 'tier' = h.to_tier
        AND ABS(EXTRACT(EPOCH FROM (e.changed_at - h.created_at))) < 60
   )
ON CONFLICT (source_table, source_id) DO NOTHING;

-- Concern notes.
INSERT INTO curator_interventions (trader, kind, params, target_metric, trigger, started_on, author, source_table, source_id, created_at)
SELECT n.trader, 'concern_note', jsonb_build_object('backfill', true), 'net_daily',
       curator_intervention_trigger(n.trader, (n.created_at AT TIME ZONE 'America/New_York')::date),
       (n.created_at AT TIME ZONE 'America/New_York')::date, n.author, 'curator_notes', n.id::text, n.created_at
  FROM curator_notes n
 WHERE n.kind = 'concern' AND n.author <> n.trader
ON CONFLICT (source_table, source_id) DO NOTHING;
