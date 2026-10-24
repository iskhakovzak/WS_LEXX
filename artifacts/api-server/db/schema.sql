-- Schema built from src/db/migrations (db:snapshot). Do not edit: change a migration and re-run the script.

CREATE OR REPLACE FUNCTION public.curator_intervention_trigger(who text, day date)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.trade_executions_strategy_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE trades SET strategy_sig = NULL WHERE strategy_sig IS NOT NULL AND id IN (SELECT trade_id FROM old_rows);
  ELSE
    UPDATE trades SET strategy_sig = NULL WHERE strategy_sig IS NOT NULL AND id IN (SELECT trade_id FROM new_rows);
  END IF;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.trades_day_deleted_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE trades t SET strategy_sig = NULL
    FROM (SELECT DISTINCT COALESCE(o.trader, '') AS tr, LEFT(o.date, 10) AS d FROM old_rows o) g
   WHERE t.strategy_sig IS NOT NULL AND COALESCE(t.trader, '') = g.tr
     AND LEFT(t.date, 10) >= g.d AND LEFT(t.date, 10) <= trades_size_rel_until(g.d);
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.trades_day_left_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE trades SET strategy_sig = NULL
   WHERE strategy_sig IS NOT NULL AND id <> OLD.id
     AND COALESCE(trader, '') = COALESCE(OLD.trader, '')
     AND LEFT(date, 10) >= LEFT(OLD.date, 10) AND LEFT(date, 10) <= trades_size_rel_until(LEFT(OLD.date, 10));
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.trades_ny_wall(s text)
 RETURNS timestamp without time zone
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v text := btrim(s);
BEGIN
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(:[0-5]\d)?(\.\d+)?$' THEN
    RETURN replace(v, 'T', ' ')::timestamp;
  END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(:[0-5]\d)?(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN
    RETURN v::timestamptz AT TIME ZONE 'America/New_York';
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.trades_size_rel_until(d text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF d IS NULL OR d !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN d;
  END IF;
  RETURN to_char(d::date + 60, 'YYYY-MM-DD');
EXCEPTION WHEN others THEN
  RETURN d;
END
$function$;

CREATE OR REPLACE FUNCTION public.trades_strategy_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.ticker IS DISTINCT FROM OLD.ticker OR NEW.date IS DISTINCT FROM OLD.date OR NEW.exit_date IS DISTINCT FROM OLD.exit_date
     OR NEW.horizon IS DISTINCT FROM OLD.horizon OR NEW.session IS DISTINCT FROM OLD.session
     OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.entry IS DISTINCT FROM OLD.entry
     OR (NEW.context_snapshot ->> 'openedAt') IS DISTINCT FROM (OLD.context_snapshot ->> 'openedAt')
     OR (NEW.context_snapshot ->> 'closedAt') IS DISTINCT FROM (OLD.context_snapshot ->> 'closedAt')
     OR NEW.trader IS DISTINCT FROM OLD.trader OR NEW.pnl IS DISTINCT FROM OLD.pnl OR NEW.fees IS DISTINCT FROM OLD.fees
     OR NEW.result IS DISTINCT FROM OLD.result OR NEW.hold_time IS DISTINCT FROM OLD.hold_time
     OR NEW.structure IS DISTINCT FROM OLD.structure OR NEW.reentry_of IS DISTINCT FROM OLD.reentry_of
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.stop IS DISTINCT FROM OLD.stop THEN
    NEW.strategy_sig := NULL;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.trades_ticker_day_deleted_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE trades t SET strategy_sig = NULL
    FROM (SELECT DISTINCT upper(o.ticker) AS tk, LEFT(o.date, 10) AS d FROM old_rows o
           WHERE o.ticker IS NOT NULL AND (o.entry_sec IS NULL OR o.entry_sec < 34200)) g
   WHERE t.strategy_sig IS NOT NULL AND t.deleted_at IS NULL
     AND upper(t.ticker) = g.tk AND LEFT(t.date, 10) = g.d
     AND (t.entry_sec IS NULL OR t.entry_sec < 34200);
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.trades_ticker_day_left_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE trades SET strategy_sig = NULL
   WHERE strategy_sig IS NOT NULL AND id <> OLD.id AND deleted_at IS NULL
     AND upper(ticker) = upper(OLD.ticker) AND LEFT(date, 10) = LEFT(OLD.date, 10)
     AND (entry_sec IS NULL OR entry_sec < 34200);
  RETURN NULL;
END
$function$;

CREATE SEQUENCE public.academy_action_items_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_assignments_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_attendance_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_challenges_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_cohorts_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_enrollment_history_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_enrollments_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_idp_goals_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_lessons_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_modules_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_one_on_ones_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_programs_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_promotion_requests_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_quiz_attempts_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_quizzes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_sessions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_stage_criteria_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_stage_history_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.academy_submissions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.activity_log_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.ai_review_rate_limit_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.ai_trade_reviews_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.analyst_actions_cache_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.app_error_occurrences_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.app_errors_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.audit_log_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.author_notes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.author_weekly_summaries_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.behavior_triggers_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.big7_catalysts_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.big7_levels_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.big7_tickers_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.candles_cache_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.comments_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.content_reports_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.curator_interventions_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.curator_notes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.curator_requests_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.daily_feed_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.daily_quotes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.desk_groups_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.digest_subscriptions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.discussion_votes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.discussions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.edge_map_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.emotional_state_log_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.eod_days_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.finviz_runs_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.game_plans_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.holiday_calendar_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.journal_days_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.junior_note_reminders_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.junior_notes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.market_events_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.market_open_brief_cache_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.market_themes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.news_cache_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.notifications_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.plan_media_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.plan_templates_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.playbook_checklist_runs_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.playbook_examples_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.playbook_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.playbook_media_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.playbook_reviews_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.playbook_revisions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.pre_trade_checklist_responses_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.pre_trade_checklist_template_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.propreports_accounts_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.propreports_adjustments_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.propreports_backfills_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.propreports_outbox_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.propreports_pending_trades_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.propreports_performance_reports_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.propreports_reconcile_days_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.propreports_sync_runs_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.quest_instances_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.recognition_events_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.research_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.reward_grants_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.reward_items_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.risk_alert_log_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.risk_breach_reviews_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.risk_live_alerts_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.rule_self_checks_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.rule_violations_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.scaling_history_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.scaling_proposals_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.scaling_rules_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.telegram_link_tokens_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.telegram_pending_actions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_archive_batches_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_executions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_idea_comments_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_idea_reactions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_ideas_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_reactions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_reviews_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trade_setup_suggestions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trader_plans_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trader_progress_snapshots_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.trader_ratings_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trader_risk_limit_events_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trades_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trading_errors_archive_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trading_errors_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trading_rules_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trainer_drill_attempts_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.trainer_drills_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.usage_events_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.user_boards_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.user_themes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.users_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.voice_notes_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.war_room_levels_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.war_room_sessions_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.watchlist_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.weekly_psychology_reports_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.weekly_reviews_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE public.whatif_honesty_cache_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854776000 CACHE 1;
CREATE SEQUENCE public.whatif_scenarios_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;

CREATE TABLE public.academy_action_items (
  id integer DEFAULT nextval('public.academy_action_items_id_seq'::regclass) NOT NULL,
  meeting_id integer,
  student text NOT NULL,
  owner text DEFAULT 'student'::text NOT NULL,
  title text NOT NULL,
  due_on date,
  status text DEFAULT 'open'::text NOT NULL,
  done_at timestamp with time zone,
  overdue_notified_at timestamp with time zone,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_action_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_assignments (
  id integer DEFAULT nextval('public.academy_assignments_id_seq'::regclass) NOT NULL,
  module_id integer NOT NULL,
  title text NOT NULL,
  body_md text DEFAULT ''::text NOT NULL,
  rubric jsonb DEFAULT '[]'::jsonb NOT NULL,
  pass_pct integer DEFAULT 70 NOT NULL,
  min_trades integer DEFAULT 0 NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  draft boolean DEFAULT false NOT NULL,
  seed_key text,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_assignments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_attendance (
  id integer DEFAULT nextval('public.academy_attendance_id_seq'::regclass) NOT NULL,
  session_id integer NOT NULL,
  occurrence_date date NOT NULL,
  user_name text NOT NULL,
  status text NOT NULL,
  source text DEFAULT 'mentor'::text NOT NULL,
  checked_in_at timestamp with time zone,
  marked_by text,
  note text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_attendance_pkey PRIMARY KEY (id),
  CONSTRAINT academy_attendance_session_id_occurrence_date_user_name_key UNIQUE (session_id, occurrence_date, user_name)
);

CREATE TABLE public.academy_challenges (
  id integer DEFAULT nextval('public.academy_challenges_id_seq'::regclass) NOT NULL,
  user_name text NOT NULL,
  template_key text,
  "name" text NOT NULL,
  rules jsonb NOT NULL,
  starts_on text NOT NULL,
  ends_on text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  summary jsonb,
  notified_status text,
  comment text,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  archived_by text,
  CONSTRAINT academy_challenges_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_cohorts (
  id integer DEFAULT nextval('public.academy_cohorts_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  format text DEFAULT 'office'::text NOT NULL,
  mentor text,
  starts_on date,
  ends_on date,
  timezone text DEFAULT 'America/New_York'::text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  room text,
  meeting_url text,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_cohorts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_enrollment_history (
  id integer DEFAULT nextval('public.academy_enrollment_history_id_seq'::regclass) NOT NULL,
  enrollment_id integer NOT NULL,
  cohort_id integer,
  user_name text NOT NULL,
  from_stage text,
  to_stage text,
  from_status text,
  to_status text,
  changed_by text,
  note text DEFAULT ''::text NOT NULL,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_enrollment_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_enrollments (
  id integer DEFAULT nextval('public.academy_enrollments_id_seq'::regclass) NOT NULL,
  cohort_id integer NOT NULL,
  user_name text NOT NULL,
  stage text DEFAULT 'junior'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  joined_on date DEFAULT ((now() AT TIME ZONE 'America/New_York'::text))::date NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_enrollments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_idp_goals (
  id integer DEFAULT nextval('public.academy_idp_goals_id_seq'::regclass) NOT NULL,
  student text NOT NULL,
  title text NOT NULL,
  metric text NOT NULL,
  comparator text NOT NULL,
  target numeric NOT NULL,
  window_n integer,
  start_date date NOT NULL,
  due_on date,
  status text DEFAULT 'active'::text NOT NULL,
  manual_progress numeric,
  note text DEFAULT ''::text NOT NULL,
  last_value numeric,
  last_progress numeric,
  last_evaluated_at timestamp with time zone,
  achieved_at timestamp with time zone,
  missed_at timestamp with time zone,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_idp_goals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_lesson_progress (
  user_name text NOT NULL,
  lesson_id integer NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_lesson_progress_pkey PRIMARY KEY (user_name, lesson_id)
);

CREATE TABLE public.academy_lessons (
  id integer DEFAULT nextval('public.academy_lessons_id_seq'::regclass) NOT NULL,
  module_id integer NOT NULL,
  title text NOT NULL,
  summary text,
  body_md text DEFAULT ''::text NOT NULL,
  video_url text,
  attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
  duration_min integer,
  playbook_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
  setup_names text[] DEFAULT '{}'::text[] NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  draft boolean DEFAULT false NOT NULL,
  seed_key text,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_lessons_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_modules (
  id integer DEFAULT nextval('public.academy_modules_id_seq'::regclass) NOT NULL,
  program_id integer NOT NULL,
  title text NOT NULL,
  description text,
  "position" integer DEFAULT 0 NOT NULL,
  seed_key text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_modules_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_one_on_ones (
  id integer DEFAULT nextval('public.academy_one_on_ones_id_seq'::regclass) NOT NULL,
  student text NOT NULL,
  mentor text NOT NULL,
  cohort_id integer,
  met_at timestamp with time zone NOT NULL,
  duration_min integer,
  format text DEFAULT 'office'::text NOT NULL,
  agenda text DEFAULT ''::text NOT NULL,
  notes text DEFAULT ''::text NOT NULL,
  private_notes text DEFAULT ''::text NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_one_on_ones_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_programs (
  id integer DEFAULT nextval('public.academy_programs_id_seq'::regclass) NOT NULL,
  slug text,
  title text NOT NULL,
  description text,
  "level" text,
  stage text,
  published boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_programs_pkey PRIMARY KEY (id),
  CONSTRAINT academy_programs_slug_key UNIQUE (slug)
);

CREATE TABLE public.academy_promotion_requests (
  id integer DEFAULT nextval('public.academy_promotion_requests_id_seq'::regclass) NOT NULL,
  user_name text NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  passed integer DEFAULT 0 NOT NULL,
  total integer DEFAULT 0 NOT NULL,
  ready boolean DEFAULT false NOT NULL,
  report jsonb,
  comment text,
  requested_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  decided_by text,
  decided_at timestamp with time zone,
  decision_comment text,
  archived_at timestamp with time zone,
  CONSTRAINT academy_promotion_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_quiz_attempts (
  id integer DEFAULT nextval('public.academy_quiz_attempts_id_seq'::regclass) NOT NULL,
  quiz_id integer NOT NULL,
  user_name text NOT NULL,
  answers jsonb DEFAULT '{}'::jsonb NOT NULL,
  results jsonb DEFAULT '[]'::jsonb NOT NULL,
  score numeric(10,2) DEFAULT 0 NOT NULL,
  max_score numeric(10,2) DEFAULT 0 NOT NULL,
  pct numeric(6,2) DEFAULT 0 NOT NULL,
  passed boolean DEFAULT false NOT NULL,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_quiz_attempts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_quizzes (
  id integer DEFAULT nextval('public.academy_quizzes_id_seq'::regclass) NOT NULL,
  module_id integer NOT NULL,
  title text NOT NULL,
  description text,
  questions jsonb DEFAULT '[]'::jsonb NOT NULL,
  pass_pct integer DEFAULT 80 NOT NULL,
  max_attempts integer,
  "position" integer DEFAULT 0 NOT NULL,
  draft boolean DEFAULT false NOT NULL,
  seed_key text,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_quizzes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_readiness_notices (
  user_name text NOT NULL,
  stage text NOT NULL,
  notified_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_readiness_notices_pkey PRIMARY KEY (user_name, stage)
);

CREATE TABLE public.academy_sessions (
  id integer DEFAULT nextval('public.academy_sessions_id_seq'::regclass) NOT NULL,
  cohort_id integer NOT NULL,
  title text NOT NULL,
  kind text DEFAULT 'lecture'::text NOT NULL,
  recurrence text DEFAULT 'none'::text NOT NULL,
  weekdays smallint[] DEFAULT '{}'::smallint[] NOT NULL,
  start_date date NOT NULL,
  end_date date,
  start_time text NOT NULL,
  duration_min integer DEFAULT 60 NOT NULL,
  timezone text DEFAULT 'America/New_York'::text NOT NULL,
  mode text DEFAULT 'office'::text NOT NULL,
  room text,
  meeting_url text,
  host text,
  description text DEFAULT ''::text NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_sessions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_stage_criteria (
  id integer DEFAULT nextval('public.academy_stage_criteria_id_seq'::regclass) NOT NULL,
  from_stage text NOT NULL,
  metric text NOT NULL,
  op text NOT NULL,
  "value" numeric(14,4) NOT NULL,
  window_days integer,
  label text,
  enabled boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_stage_criteria_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_stage_history (
  id integer DEFAULT nextval('public.academy_stage_history_id_seq'::regclass) NOT NULL,
  user_name text NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  action text NOT NULL,
  request_id integer,
  actor text NOT NULL,
  comment text,
  report jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_stage_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_stages (
  "key" text NOT NULL,
  "name" text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  description text,
  scaling_tier text,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_stages_pkey PRIMARY KEY (key)
);

CREATE TABLE public.academy_submissions (
  id integer DEFAULT nextval('public.academy_submissions_id_seq'::regclass) NOT NULL,
  assignment_id integer NOT NULL,
  user_name text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  url text,
  trade_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
  status text DEFAULT 'submitted'::text NOT NULL,
  scores jsonb,
  total numeric(10,2),
  max_total numeric(10,2),
  pct numeric(6,2),
  passed boolean,
  mentor_comment text,
  graded_by text,
  graded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT academy_submissions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.academy_trader_stage (
  user_name text NOT NULL,
  stage text NOT NULL,
  since text NOT NULL,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT academy_trader_stage_pkey PRIMARY KEY (user_name)
);

CREATE TABLE public.activity_log (
  id integer DEFAULT nextval('public.activity_log_id_seq'::regclass) NOT NULL,
  action text NOT NULL,
  section text NOT NULL,
  entity_id text,
  entity_title text,
  trader text,
  details text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  params jsonb,
  CONSTRAINT activity_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ai_review_rate_limit (
  id integer DEFAULT nextval('public.ai_review_rate_limit_id_seq'::regclass) NOT NULL,
  user_key text NOT NULL,
  trade_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_review_rate_limit_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ai_trade_reviews (
  id integer DEFAULT nextval('public.ai_trade_reviews_id_seq'::regclass) NOT NULL,
  trade_id integer NOT NULL,
  model text NOT NULL,
  prompt_hash text NOT NULL,
  review_text text NOT NULL,
  sections jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,6),
  generated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_trade_reviews_pkey PRIMARY KEY (id)
);

CREATE TABLE public.analyst_actions_cache (
  id integer DEFAULT nextval('public.analyst_actions_cache_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  graded_at timestamp with time zone NOT NULL,
  firm text NOT NULL,
  action text NOT NULL,
  to_grade text,
  from_grade text,
  source text DEFAULT 'yahoo'::text NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  source_url text,
  price_target text,
  price_target_from text,
  CONSTRAINT analyst_actions_cache_pkey PRIMARY KEY (id)
);

CREATE TABLE public.analyst_bars_cache (
  ticker text NOT NULL,
  bars jsonb DEFAULT '[]'::jsonb NOT NULL,
  from_date text,
  to_date text,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT analyst_bars_cache_pkey PRIMARY KEY (ticker)
);

CREATE TABLE public.app_error_occurrences (
  id bigint DEFAULT nextval('public.app_error_occurrences_id_seq'::regclass) NOT NULL,
  error_id bigint NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  request_id text,
  user_id integer,
  route text,
  status integer,
  context jsonb,
  CONSTRAINT app_error_occurrences_pkey PRIMARY KEY (id)
);

CREATE TABLE public.app_errors (
  id bigint DEFAULT nextval('public.app_errors_id_seq'::regclass) NOT NULL,
  fingerprint text NOT NULL,
  source text NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  route text,
  status integer,
  stack text,
  count integer DEFAULT 1 NOT NULL,
  first_seen timestamp with time zone DEFAULT now() NOT NULL,
  last_seen timestamp with time zone DEFAULT now() NOT NULL,
  last_request_id text,
  last_user_id integer,
  user_agent text,
  release text,
  resolved_at timestamp with time zone,
  resolved_by text,
  alerted_at timestamp with time zone,
  CONSTRAINT app_errors_pkey PRIMARY KEY (id),
  CONSTRAINT app_errors_fingerprint_key UNIQUE (fingerprint),
  CONSTRAINT app_errors_source_check CHECK (source = ANY (ARRAY['server'::text, 'client'::text, 'csp'::text]))
);

CREATE TABLE public.app_settings (
  "key" text NOT NULL,
  "value" jsonb,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT app_settings_pkey PRIMARY KEY (key)
);

CREATE TABLE public.audit_log (
  id integer DEFAULT nextval('public.audit_log_id_seq'::regclass) NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.auth_revoked_sessions (
  sid text NOT NULL,
  user_id integer NOT NULL,
  revoked_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT auth_revoked_sessions_pkey PRIMARY KEY (sid),
  CONSTRAINT auth_revoked_sessions_sid_check CHECK (char_length(sid) >= 1 AND char_length(sid) <= 64)
);

CREATE TABLE public.auth_session_locks (
  sid text NOT NULL,
  user_id integer NOT NULL,
  locked_at timestamp with time zone DEFAULT now() NOT NULL,
  failures integer DEFAULT 0 NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT auth_session_locks_pkey PRIMARY KEY (sid),
  CONSTRAINT auth_session_locks_sid_check CHECK (char_length(sid) >= 1 AND char_length(sid) <= 64)
);

CREATE TABLE public.author_note_reads (
  note_id integer NOT NULL,
  reader text NOT NULL,
  read_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT author_note_reads_pkey PRIMARY KEY (note_id, reader)
);

CREATE TABLE public.author_notes (
  id integer DEFAULT nextval('public.author_notes_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  note_date date DEFAULT ((now() AT TIME ZONE 'America/New_York'::text))::date NOT NULL,
  raw_text text DEFAULT ''::text NOT NULL,
  refined_text text,
  mood text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT author_notes_pkey PRIMARY KEY (id),
  CONSTRAINT author_notes_trader_note_date_key UNIQUE (trader, note_date)
);

CREATE TABLE public.author_weekly_summaries (
  id integer DEFAULT nextval('public.author_weekly_summaries_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  summary text NOT NULL,
  quote_of_week text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT author_weekly_summaries_pkey PRIMARY KEY (id),
  CONSTRAINT author_weekly_summaries_trader_week_start_key UNIQUE (trader, week_start)
);

CREATE TABLE public.behavior_triggers (
  id integer DEFAULT nextval('public.behavior_triggers_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  kind text NOT NULL,
  "name" text NOT NULL,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  note text,
  source_pattern text,
  enabled boolean DEFAULT true NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT behavior_triggers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.big7_catalysts (
  id integer DEFAULT nextval('public.big7_catalysts_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  "date" text NOT NULL,
  "type" text NOT NULL,
  description text,
  impact text DEFAULT 'medium'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text,
  CONSTRAINT big7_catalysts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.big7_levels (
  id integer DEFAULT nextval('public.big7_levels_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  label text NOT NULL,
  price numeric(12,4) NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text,
  CONSTRAINT big7_levels_pkey PRIMARY KEY (id)
);

CREATE TABLE public.big7_tickers (
  id integer DEFAULT nextval('public.big7_tickers_id_seq'::regclass) NOT NULL,
  symbol text NOT NULL,
  exchange text DEFAULT 'NASDAQ'::text NOT NULL,
  "name" text NOT NULL,
  group_name text DEFAULT 'core'::text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text,
  CONSTRAINT big7_tickers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.cache_versions (
  "name" text NOT NULL,
  version bigint DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cache_versions_pkey PRIMARY KEY (name)
);

CREATE TABLE public.candle_archive (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  symbol text NOT NULL,
  day date NOT NULL,
  tf text NOT NULL,
  enc smallint NOT NULL,
  extended boolean NOT NULL,
  bar_count integer NOT NULL,
  payload bytea NOT NULL,
  source text NOT NULL,
  fetched_at timestamp with time zone NOT NULL,
  rth_open numeric(16,4),
  rth_high numeric(16,4),
  rth_low numeric(16,4),
  rth_close numeric(16,4),
  volume bigint DEFAULT 0 NOT NULL,
  prev_close numeric(16,4),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT candle_archive_pkey PRIMARY KEY (id),
  CONSTRAINT candle_archive_bar_count_check CHECK (bar_count > 0),
  CONSTRAINT candle_archive_enc_check CHECK (enc > 0),
  CONSTRAINT candle_archive_source_check CHECK (source = ANY (ARRAY['yahoo'::text, 'cache'::text])),
  CONSTRAINT candle_archive_symbol_check CHECK (symbol ~ '^[A-Z][-A-Z0-9.]{0,10}$'::text),
  CONSTRAINT candle_archive_tf_check CHECK (tf = ANY (ARRAY['1m'::text, '5m'::text, '15m'::text, '30m'::text, '60m'::text]))
);

CREATE TABLE public.candle_archive_misses (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  symbol text NOT NULL,
  day date NOT NULL,
  reason text NOT NULL,
  attempts integer DEFAULT 1 NOT NULL,
  retry_after timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT candle_archive_misses_pkey PRIMARY KEY (id),
  CONSTRAINT candle_archive_misses_reason_check CHECK (reason = ANY (ARRAY['empty'::text, 'too_old'::text]))
);

CREATE TABLE public.candles_cache (
  id integer DEFAULT nextval('public.candles_cache_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  "date" text NOT NULL,
  "interval" text NOT NULL,
  extended boolean DEFAULT false NOT NULL,
  ohlcv jsonb NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT candles_cache_pkey PRIMARY KEY (id)
);

CREATE TABLE public.chart_drawings (
  user_id integer NOT NULL,
  ticker text NOT NULL,
  day text NOT NULL,
  drawings jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT chart_drawings_pkey PRIMARY KEY (user_id, ticker, day)
);

CREATE TABLE public.comments (
  id integer DEFAULT nextval('public.comments_id_seq'::regclass) NOT NULL,
  discussion_id integer NOT NULL,
  trader text,
  "text" text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT comments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.content_reports (
  id integer DEFAULT nextval('public.content_reports_id_seq'::regclass) NOT NULL,
  reporter text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  resolved_by text,
  resolved_at timestamp with time zone,
  resolution text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT content_reports_pkey PRIMARY KEY (id)
);

CREATE TABLE public.curator_interventions (
  id bigint DEFAULT nextval('public.curator_interventions_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  kind text NOT NULL,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  target_metric text,
  target_slice text,
  trigger text DEFAULT 'scheduled'::text NOT NULL,
  started_on date NOT NULL,
  ends_on date,
  author text,
  source_table text,
  source_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT curator_interventions_pkey PRIMARY KEY (id),
  CONSTRAINT curator_interventions_source_key UNIQUE (source_table, source_id),
  CONSTRAINT curator_interventions_kind_check CHECK (kind = ANY (ARRAY['limit_change'::text, 'size_change'::text, 'rule_added'::text, 'rule_removed'::text, 'rule_trial'::text, 'focus_set'::text, 'one_on_one'::text, 'pause'::text, 'quest'::text, 'fee_plan'::text, 'concern_note'::text, 'plateau_review'::text, 'scaling_decision'::text])),
  CONSTRAINT curator_interventions_trigger_check CHECK (trigger = ANY (ARRAY['scheduled'::text, 'after_bad_period'::text, 'plateau'::text, 'breach'::text, 'random'::text, 'trader_request'::text]))
);

CREATE TABLE public.curator_notes (
  id integer DEFAULT nextval('public.curator_notes_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  author text NOT NULL,
  body text NOT NULL,
  kind text DEFAULT 'note'::text NOT NULL,
  pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  archived_by text,
  day text,
  CONSTRAINT curator_notes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.curator_queue_acks (
  item_id text NOT NULL,
  trader text NOT NULL,
  kind text NOT NULL,
  acked_by text NOT NULL,
  acked_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone,
  CONSTRAINT curator_queue_acks_pkey PRIMARY KEY (item_id)
);

CREATE TABLE public.curator_requests (
  id integer DEFAULT nextval('public.curator_requests_id_seq'::regclass) NOT NULL,
  trader_id integer NOT NULL,
  kind text NOT NULL,
  message text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  resolved_by_id integer,
  link text,
  CONSTRAINT curator_requests_pkey PRIMARY KEY (id),
  CONSTRAINT curator_requests_check CHECK ((status = 'open'::text) = (resolved_at IS NULL)),
  CONSTRAINT curator_requests_kind_check CHECK (kind = ANY (ARRAY['limits'::text, 'group'::text, 'stage'::text, 'plan'::text, 'other'::text, 'review'::text])),
  CONSTRAINT curator_requests_link_check CHECK (link IS NULL OR char_length(link) <= 120),
  CONSTRAINT curator_requests_message_check CHECK (char_length(message) <= 500),
  CONSTRAINT curator_requests_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT curator_requests_status_check CHECK (status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text]))
);

CREATE TABLE public.daily_feed (
  id integer DEFAULT nextval('public.daily_feed_id_seq'::regclass) NOT NULL,
  "date" text NOT NULL,
  what_works_now text,
  what_doesnt_work text,
  best_tickers text,
  market_theme text,
  notes text,
  tags text,
  screenshot_url text,
  screenshot_notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  created_by text,
  CONSTRAINT daily_feed_pkey PRIMARY KEY (id)
);

CREATE TABLE public.daily_focus (
  trader text NOT NULL,
  "date" text NOT NULL,
  mistake text,
  cost_net numeric(12,2),
  count integer DEFAULT 0 NOT NULL,
  days integer DEFAULT 0 NOT NULL,
  window_from text NOT NULL,
  window_to text NOT NULL,
  source text NOT NULL,
  set_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT daily_focus_pkey PRIMARY KEY (trader, date),
  CONSTRAINT daily_focus_source_check CHECK (source = ANY (ARRAY['auto'::text, 'curator'::text, 'none'::text]))
);

CREATE TABLE public.daily_quotes (
  id integer DEFAULT nextval('public.daily_quotes_id_seq'::regclass) NOT NULL,
  "date" text NOT NULL,
  trading_ru text NOT NULL,
  trading_uz text NOT NULL,
  trading_uk text NOT NULL,
  trading_author text,
  psychology_ru text NOT NULL,
  psychology_uz text NOT NULL,
  psychology_uk text NOT NULL,
  psychology_author text,
  source text DEFAULT 'ai'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  trading_en text,
  psychology_en text,
  CONSTRAINT daily_quotes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.daily_reviews (
  trader text NOT NULL,
  "date" text NOT NULL,
  reviewed_at timestamp with time zone,
  note text,
  disputed boolean DEFAULT false NOT NULL,
  disputed_mistake text,
  verdict jsonb,
  verdict_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT daily_reviews_pkey PRIMARY KEY (trader, date)
);

CREATE TABLE public.desk_groups (
  id integer DEFAULT nextval('public.desk_groups_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  curator_id integer,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT desk_groups_pkey PRIMARY KEY (id),
  CONSTRAINT desk_groups_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 60)
);

CREATE TABLE public.digest_subscriptions (
  id integer DEFAULT nextval('public.digest_subscriptions_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  channel text DEFAULT 'none'::text NOT NULL,
  telegram_chat_id text,
  email text,
  send_morning boolean DEFAULT true NOT NULL,
  send_evening boolean DEFAULT true NOT NULL,
  trades_window_hours integer DEFAULT 24 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT digest_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT digest_subscriptions_trader_key UNIQUE (trader)
);

CREATE TABLE public.discussion_reads (
  user_name text NOT NULL,
  thread_id integer NOT NULL,
  read_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT discussion_reads_pkey PRIMARY KEY (user_name, thread_id)
);

CREATE TABLE public.discussion_votes (
  id integer DEFAULT nextval('public.discussion_votes_id_seq'::regclass) NOT NULL,
  discussion_id integer NOT NULL,
  trader text NOT NULL,
  "value" integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT discussion_votes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.discussions (
  id integer DEFAULT nextval('public.discussions_id_seq'::regclass) NOT NULL,
  topic text NOT NULL,
  "type" text,
  trader text,
  notes text,
  tags text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  ticker text,
  deleted_at timestamp with time zone,
  audience text[],
  trade_id integer,
  idea_id integer,
  playbook_id integer,
  event_id integer,
  journal_date text,
  accepted_comment_id integer,
  CONSTRAINT discussions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.edge_map (
  id bigint DEFAULT nextval('public.edge_map_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  as_of date NOT NULL,
  slice_key text NOT NULL,
  family text NOT NULL,
  n integer NOT NULL,
  days integer NOT NULL,
  net numeric(14,2) NOT NULL,
  xbar_bps numeric(12,4) NOT NULL,
  se_bps numeric(12,4) NOT NULL,
  theta_bps numeric(12,4) NOT NULL,
  lo80 numeric(12,4) NOT NULL,
  hi80 numeric(12,4) NOT NULL,
  q numeric(10,6),
  persist_blocks smallint DEFAULT 0 NOT NULL,
  verdict text NOT NULL,
  cost_per_day numeric(12,2) NOT NULL,
  cost_lo numeric(12,2) NOT NULL,
  cost_hi numeric(12,2) NOT NULL,
  prior_mu numeric(12,4) NOT NULL,
  prior_tau numeric(12,4) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT edge_map_pkey PRIMARY KEY (id),
  CONSTRAINT edge_map_key UNIQUE (trader, as_of, slice_key),
  CONSTRAINT edge_map_verdict_check CHECK (verdict = ANY (ARRAY['LEAK'::text, 'STRENGTH'::text, 'NONE'::text]))
);

CREATE TABLE public.emotional_state_log (
  id integer DEFAULT nextval('public.emotional_state_log_id_seq'::regclass) NOT NULL,
  user_id text NOT NULL,
  "date" text NOT NULL,
  sleep_well boolean DEFAULT false NOT NULL,
  stressed boolean DEFAULT false NOT NULL,
  tilted boolean DEFAULT false NOT NULL,
  focused boolean DEFAULT false NOT NULL,
  anxious boolean DEFAULT false NOT NULL,
  revenge boolean DEFAULT false NOT NULL,
  free_text text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT emotional_state_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.eod_days (
  id integer DEFAULT nextval('public.eod_days_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  "date" text NOT NULL,
  closed_at timestamp with time zone,
  discipline smallint,
  summary jsonb DEFAULT '{}'::jsonb NOT NULL,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  curator_comment text,
  curator_score smallint,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT eod_days_pkey PRIMARY KEY (id),
  CONSTRAINT eod_days_trader_date_key UNIQUE (trader, date)
);

CREATE TABLE public.eod_trade_reviews (
  trade_id integer NOT NULL,
  trader text NOT NULL,
  followed_plan boolean,
  mistakes text[] DEFAULT '{}'::text[] NOT NULL,
  lesson text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT eod_trade_reviews_pkey PRIMARY KEY (trade_id)
);

CREATE TABLE public.feed_acks (
  entry_id integer NOT NULL,
  user_name text NOT NULL,
  kind text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT feed_acks_pkey PRIMARY KEY (entry_id, user_name, kind)
);

CREATE TABLE public.feed_visits (
  user_name text NOT NULL,
  seen_at timestamp with time zone DEFAULT now() NOT NULL,
  prev_seen_at timestamp with time zone,
  CONSTRAINT feed_visits_pkey PRIMARY KEY (user_name)
);

CREATE TABLE public.finviz_earnings (
  ticker text NOT NULL,
  "date" text NOT NULL,
  timing text,
  company text,
  market_cap numeric(20,0),
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  superseded_at timestamp with time zone,
  CONSTRAINT finviz_earnings_pkey PRIMARY KEY (ticker, date),
  CONSTRAINT finviz_earnings_timing_check CHECK (timing = ANY (ARRAY['bmo'::text, 'amc'::text]))
);

CREATE TABLE public.finviz_runs (
  id bigint DEFAULT nextval('public.finviz_runs_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  preset text,
  trigger text DEFAULT 'schedule'::text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  ny_day text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  row_count integer DEFAULT 0 NOT NULL,
  error text,
  CONSTRAINT finviz_runs_pkey PRIMARY KEY (id),
  CONSTRAINT finviz_runs_kind_check CHECK (kind = ANY (ARRAY['screener'::text, 'snapshot'::text, 'earnings'::text])),
  CONSTRAINT finviz_runs_status_check CHECK (status = ANY (ARRAY['running'::text, 'ok'::text, 'error'::text]))
);

CREATE TABLE public.finviz_screener_rows (
  preset text NOT NULL,
  ny_day text NOT NULL,
  ticker text NOT NULL,
  last_run_id bigint NOT NULL,
  rank integer DEFAULT 0 NOT NULL,
  company text,
  sector text,
  price numeric(14,4),
  change_pct numeric(10,2),
  gap_pct numeric(10,2),
  rel_volume numeric(10,2),
  volume bigint,
  avg_volume bigint,
  float_shares bigint,
  short_float_pct numeric(8,2),
  atr numeric(12,4),
  market_cap numeric(20,0),
  earnings_date text,
  earnings_timing text,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT finviz_screener_rows_pkey PRIMARY KEY (preset, ny_day, ticker),
  CONSTRAINT finviz_screener_rows_earnings_timing_check CHECK (earnings_timing = ANY (ARRAY['bmo'::text, 'amc'::text]))
);

CREATE TABLE public.finviz_ticker_snapshot (
  ticker text NOT NULL,
  company text,
  sector text,
  industry text,
  country text,
  market_cap numeric(20,0),
  shares_outstanding bigint,
  float_shares bigint,
  short_float_pct numeric(8,2),
  short_ratio numeric(10,2),
  avg_volume bigint,
  rel_volume numeric(10,2),
  atr numeric(12,4),
  beta numeric(8,3),
  price numeric(14,4),
  earnings_date text,
  earnings_timing text,
  source text,
  as_of timestamp with time zone,
  requested_at timestamp with time zone,
  not_found_at timestamp with time zone,
  CONSTRAINT finviz_ticker_snapshot_pkey PRIMARY KEY (ticker),
  CONSTRAINT finviz_ticker_snapshot_earnings_timing_check CHECK (earnings_timing = ANY (ARRAY['bmo'::text, 'amc'::text]))
);

CREATE TABLE public.game_plan_reads (
  plan_id integer NOT NULL,
  trader text NOT NULL,
  read_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT game_plan_reads_pkey PRIMARY KEY (plan_id, trader)
);

CREATE TABLE public.game_plans (
  id integer DEFAULT nextval('public.game_plans_id_seq'::regclass) NOT NULL,
  "date" text NOT NULL,
  author text NOT NULL,
  updated_by text,
  market_view text DEFAULT ''::text NOT NULL,
  bias text DEFAULT 'neutral'::text NOT NULL,
  risk_mode text DEFAULT 'normal'::text NOT NULL,
  key_levels jsonb DEFAULT '{}'::jsonb NOT NULL,
  in_play jsonb DEFAULT '[]'::jsonb NOT NULL,
  risk_notes text DEFAULT ''::text NOT NULL,
  macro jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  focus text DEFAULT ''::text NOT NULL,
  media jsonb DEFAULT '[]'::jsonb NOT NULL,
  tv_links jsonb DEFAULT '[]'::jsonb NOT NULL,
  max_loss_usd numeric,
  max_trades integer,
  CONSTRAINT game_plans_pkey PRIMARY KEY (id),
  CONSTRAINT game_plans_date_key UNIQUE (date)
);

CREATE TABLE public.gamification_profiles (
  trader text NOT NULL,
  active_title text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gamification_profiles_pkey PRIMARY KEY (trader)
);

CREATE TABLE public.gamification_season_points (
  season text NOT NULL,
  trader text NOT NULL,
  discipline_points integer DEFAULT 0 NOT NULL,
  quest_points integer DEFAULT 0 NOT NULL,
  points integer DEFAULT 0 NOT NULL,
  active boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gamification_season_points_pkey PRIMARY KEY (season, trader)
);

CREATE TABLE public.gamification_seasons (
  season text NOT NULL,
  ranking jsonb DEFAULT '[]'::jsonb NOT NULL,
  finalized_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gamification_seasons_pkey PRIMARY KEY (season)
);

CREATE TABLE public.holiday_calendar (
  id integer DEFAULT nextval('public.holiday_calendar_id_seq'::regclass) NOT NULL,
  "date" text NOT NULL,
  "type" text NOT NULL,
  "name" text NOT NULL,
  description text,
  importance text DEFAULT 'medium'::text NOT NULL,
  CONSTRAINT holiday_calendar_pkey PRIMARY KEY (id)
);

CREATE TABLE public.indicator_notes (
  user_name text NOT NULL,
  "key" text NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  favorite boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT indicator_notes_pkey PRIMARY KEY (user_name, key)
);

CREATE TABLE public.job_runs (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  job text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  duration_ms integer,
  error text,
  details jsonb,
  host text,
  CONSTRAINT job_runs_pkey PRIMARY KEY (id),
  CONSTRAINT job_runs_status_check CHECK (status = ANY (ARRAY['running'::text, 'ok'::text, 'error'::text, 'timeout'::text, 'skipped'::text])),
  CONSTRAINT job_runs_trigger_check CHECK (trigger = ANY (ARRAY['schedule'::text, 'startup'::text, 'manual'::text, 'event'::text]))
);

CREATE TABLE public.journal_days (
  id integer DEFAULT nextval('public.journal_days_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  day date NOT NULL,
  plan text DEFAULT ''::text NOT NULL,
  well text DEFAULT ''::text NOT NULL,
  mistakes text DEFAULT ''::text NOT NULL,
  lessons text DEFAULT ''::text NOT NULL,
  mood smallint,
  discipline smallint,
  followed_plan boolean,
  tags jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT journal_days_pkey PRIMARY KEY (id),
  CONSTRAINT journal_days_trader_day_key UNIQUE (trader, day)
);

CREATE TABLE public.junior_note_reminders (
  id integer DEFAULT nextval('public.junior_note_reminders_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  note_date date NOT NULL,
  curator text NOT NULL,
  message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  dismissed_at timestamp with time zone,
  CONSTRAINT junior_note_reminders_pkey PRIMARY KEY (id),
  CONSTRAINT junior_note_reminders_trader_note_date_key UNIQUE (trader, note_date)
);

CREATE TABLE public.junior_notes (
  id integer DEFAULT nextval('public.junior_notes_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  note_date date DEFAULT ((now() AT TIME ZONE 'America/New_York'::text))::date NOT NULL,
  raw_text text DEFAULT ''::text NOT NULL,
  refined_text text,
  mood text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  sections jsonb,
  curator_feedback text,
  curator_score smallint,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  feedback_seen_at timestamp with time zone,
  CONSTRAINT junior_notes_pkey PRIMARY KEY (id),
  CONSTRAINT junior_notes_trader_note_date_key UNIQUE (trader, note_date)
);

CREATE TABLE public.login_lockouts (
  "key" text NOT NULL,
  user_id integer,
  failures integer DEFAULT 0 NOT NULL,
  lock_level integer DEFAULT 0 NOT NULL,
  locked_until timestamp with time zone,
  last_failure_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT login_lockouts_pkey PRIMARY KEY (key)
);

CREATE TABLE public.market_events (
  id integer DEFAULT nextval('public.market_events_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  "date" text NOT NULL,
  event_type text NOT NULL,
  headline text NOT NULL,
  reaction text,
  percent_move numeric(8,2),
  volume text,
  summary text,
  screenshot_url text,
  screenshot_notes text,
  tags text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  market_cap text,
  "float" text,
  adv text,
  atr numeric(12,4),
  relative_volume numeric(8,2),
  beta numeric(8,4),
  short_interest numeric(8,4),
  sector text,
  long_name text,
  created_by text,
  session text,
  pattern_id integer,
  CONSTRAINT market_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.market_open_brief_cache (
  id integer DEFAULT nextval('public.market_open_brief_cache_id_seq'::regclass) NOT NULL,
  "date" text NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT market_open_brief_cache_pkey PRIMARY KEY (id),
  CONSTRAINT market_open_brief_cache_date_key UNIQUE (date)
);

CREATE TABLE public.market_themes (
  id integer DEFAULT nextval('public.market_themes_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  tickers text[] NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT market_themes_pkey PRIMARY KEY (id),
  CONSTRAINT market_themes_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 60),
  CONSTRAINT market_themes_tickers_check CHECK (cardinality(tickers) >= 1 AND cardinality(tickers) <= 30)
);

CREATE TABLE public.news_cache (
  id integer DEFAULT nextval('public.news_cache_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  guid text,
  title text NOT NULL,
  source text,
  url text,
  category text,
  summary text,
  published_at timestamp with time zone,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  is_ticker_specific boolean DEFAULT false,
  CONSTRAINT news_cache_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notification_dedup (
  "key" text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notification_dedup_pkey PRIMARY KEY (key)
);

CREATE TABLE public.notification_prefs (
  user_name text NOT NULL,
  "type" text NOT NULL,
  in_app boolean DEFAULT true NOT NULL,
  mute_until timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notification_prefs_pkey PRIMARY KEY (user_name, type)
);

CREATE TABLE public.notifications (
  id integer DEFAULT nextval('public.notifications_id_seq'::regclass) NOT NULL,
  user_name text NOT NULL,
  "type" text NOT NULL,
  idea_id integer,
  message text NOT NULL,
  is_read boolean DEFAULT false NOT NULL,
  source text DEFAULT 'system'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  severity text DEFAULT 'info'::text NOT NULL,
  title text,
  link text,
  entity_type text,
  entity_id text,
  actor text,
  read_at timestamp with time zone,
  archived_at timestamp with time zone,
  params jsonb,
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

CREATE TABLE public.offering_ticker_cache (
  ticker text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT offering_ticker_cache_pkey PRIMARY KEY (ticker, kind)
);

CREATE TABLE public.office_capital (
  year integer NOT NULL,
  capital numeric(16,2),
  goal_pct numeric(7,2) DEFAULT 40 NOT NULL,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT office_capital_pkey PRIMARY KEY (year)
);

CREATE TABLE public.plan_media (
  id integer DEFAULT nextval('public.plan_media_id_seq'::regclass) NOT NULL,
  context text NOT NULL,
  owner text NOT NULL,
  plan_date text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  size_bytes integer NOT NULL,
  width integer,
  height integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT plan_media_pkey PRIMARY KEY (id)
);

CREATE TABLE public.plan_templates (
  id integer DEFAULT nextval('public.plan_templates_id_seq'::regclass) NOT NULL,
  author text NOT NULL,
  kind text DEFAULT 'personal'::text NOT NULL,
  "name" text NOT NULL,
  doc jsonb DEFAULT '{}'::jsonb NOT NULL,
  shared boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT plan_templates_pkey PRIMARY KEY (id)
);

CREATE TABLE public.playbook (
  id integer DEFAULT nextval('public.playbook_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  setup_type text,
  conditions text,
  checklist text,
  notes text,
  confidence_level integer,
  screenshot_url text,
  screenshot_notes text,
  tags text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  folder text,
  source_type text,
  source_id integer,
  deleted_at timestamp with time zone,
  parent_id integer,
  ticker text,
  market_cap text,
  "float" text,
  adv text,
  atr numeric(12,4),
  relative_volume numeric(8,2),
  beta numeric(8,4),
  short_interest numeric(8,4),
  sector text,
  long_name text,
  checklist_items jsonb,
  screenshots jsonb,
  trader text,
  reviewed boolean DEFAULT false NOT NULL,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  space text,
  visibility text,
  shared_with jsonb,
  shared_at timestamp with time zone,
  shared_by text,
  created_by text,
  copied_from_id integer,
  copied_from_author text,
  promoted_from_id integer,
  office_proposed_at timestamp with time zone,
  office_proposed_by text,
  office_proposed_note text,
  context_text text,
  trigger_text text,
  entry_text text,
  stop_text text,
  targets_text text,
  management_text text,
  invalidation_text text,
  ideal_conditions text,
  time_of_day text,
  horizon text,
  media jsonb,
  updated_at timestamp with time zone,
  min_tier text,
  schema_key text,
  CONSTRAINT playbook_pkey PRIMARY KEY (id)
);

CREATE TABLE public.playbook_checklist_marks (
  playbook_id integer NOT NULL,
  item_id text NOT NULL,
  scope text NOT NULL,
  trader text DEFAULT ''::text NOT NULL,
  done boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT playbook_checklist_marks_pkey PRIMARY KEY (playbook_id, item_id, scope, trader)
);

CREATE TABLE public.playbook_checklist_runs (
  id integer DEFAULT nextval('public.playbook_checklist_runs_id_seq'::regclass) NOT NULL,
  playbook_id integer NOT NULL,
  trade_id integer,
  trader text,
  checked_items jsonb NOT NULL,
  score numeric(5,2) NOT NULL,
  total integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT playbook_checklist_runs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.playbook_examples (
  id integer DEFAULT nextval('public.playbook_examples_id_seq'::regclass) NOT NULL,
  playbook_id integer NOT NULL,
  trade_id integer NOT NULL,
  tier smallint DEFAULT 2 NOT NULL,
  note text,
  checklist_marks jsonb,
  media_id integer,
  sort_order integer DEFAULT 0 NOT NULL,
  added_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT playbook_examples_pkey PRIMARY KEY (id),
  CONSTRAINT playbook_examples_tier_check CHECK (tier >= 1 AND tier <= 3)
);

CREATE TABLE public.playbook_folder_settings (
  folder_name text NOT NULL,
  color_index integer,
  sort_order integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT playbook_folder_settings_pkey PRIMARY KEY (folder_name)
);

CREATE TABLE public.playbook_inbox_dismissed (
  trade_id integer NOT NULL,
  dismissed_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT playbook_inbox_dismissed_pkey PRIMARY KEY (trade_id)
);

CREATE TABLE public.playbook_media (
  id integer DEFAULT nextval('public.playbook_media_id_seq'::regclass) NOT NULL,
  playbook_id integer NOT NULL,
  owner text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  size_bytes integer NOT NULL,
  width integer,
  height integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT playbook_media_pkey PRIMARY KEY (id)
);

CREATE TABLE public.playbook_reviews (
  id integer DEFAULT nextval('public.playbook_reviews_id_seq'::regclass) NOT NULL,
  playbook_id integer NOT NULL,
  reviewer text NOT NULL,
  verdict text NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT playbook_reviews_pkey PRIMARY KEY (id)
);

CREATE TABLE public.playbook_revisions (
  id integer DEFAULT nextval('public.playbook_revisions_id_seq'::regclass) NOT NULL,
  playbook_id integer NOT NULL,
  trader text,
  snapshot jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT playbook_revisions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.pre_trade_checklist_responses (
  id integer DEFAULT nextval('public.pre_trade_checklist_responses_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  trade_date text NOT NULL,
  trader text,
  trade_id integer,
  responses text NOT NULL,
  passed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pre_trade_checklist_responses_pkey PRIMARY KEY (id)
);

CREATE TABLE public.pre_trade_checklist_template (
  id integer DEFAULT nextval('public.pre_trade_checklist_template_id_seq'::regclass) NOT NULL,
  label text NOT NULL,
  description text,
  required boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pre_trade_checklist_template_pkey PRIMARY KEY (id)
);

CREATE TABLE public.propreports_accounts (
  id integer DEFAULT nextval('public.propreports_accounts_id_seq'::regclass) NOT NULL,
  account text NOT NULL,
  account_id text,
  account_name text,
  trader text,
  active boolean DEFAULT true NOT NULL,
  notes text,
  last_synced_at timestamp with time zone,
  last_fill_at text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  aliases text[] DEFAULT '{}'::text[] NOT NULL,
  broker_status text,
  broker_close_date text,
  broker_deactivation_date text,
  broker_seen_at timestamp with time zone,
  auto_deactivated_at timestamp with time zone,
  CONSTRAINT propreports_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT propreports_accounts_account_key UNIQUE (account)
);

CREATE TABLE public.propreports_adjustments (
  id integer DEFAULT nextval('public.propreports_adjustments_id_seq'::regclass) NOT NULL,
  "date" text NOT NULL,
  account text NOT NULL,
  trader text,
  category text NOT NULL,
  kind text NOT NULL,
  amount numeric(14,4) NOT NULL,
  comment text,
  qty numeric(14,4),
  symbol text,
  price numeric(14,4),
  propreports_id text,
  replaced_ids text[] DEFAULT '{}'::text[] NOT NULL,
  fingerprint text NOT NULL,
  occurrence integer DEFAULT 1 NOT NULL,
  scope text NOT NULL,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT propreports_adjustments_pkey PRIMARY KEY (id),
  CONSTRAINT propreports_adjustments_kind_check CHECK (kind = ANY (ARRAY['fee'::text, 'transfer'::text, 'other'::text]))
);

CREATE TABLE public.propreports_backfills (
  id integer DEFAULT nextval('public.propreports_backfills_id_seq'::regclass) NOT NULL,
  date_from text NOT NULL,
  date_to text NOT NULL,
  cursor text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  windows_total integer DEFAULT 0 NOT NULL,
  windows_done integer DEFAULT 0 NOT NULL,
  inserted integer DEFAULT 0 NOT NULL,
  updated integer DEFAULT 0 NOT NULL,
  conflicts integer DEFAULT 0 NOT NULL,
  errors integer DEFAULT 0 NOT NULL,
  fills integer DEFAULT 0 NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  actor text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  CONSTRAINT propreports_backfills_pkey PRIMARY KEY (id),
  CONSTRAINT propreports_backfills_status_check CHECK (status = ANY (ARRAY['running'::text, 'done'::text, 'cancelled'::text, 'error'::text]))
);

CREATE TABLE public.propreports_cursors (
  "key" text NOT NULL,
  "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT propreports_cursors_pkey PRIMARY KEY (key)
);

CREATE TABLE public.propreports_fill_identity (
  propreports_id text NOT NULL,
  canonical_id text NOT NULL,
  fingerprint text NOT NULL,
  account text NOT NULL,
  trade_date text,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  replaced_by text,
  replaced_at timestamp with time zone,
  CONSTRAINT propreports_fill_identity_pkey PRIMARY KEY (propreports_id)
);

CREATE TABLE public.propreports_live_positions (
  account text NOT NULL,
  trader text,
  trading_date text NOT NULL,
  open_count integer DEFAULT 0 NOT NULL,
  unrealized numeric(14,2) DEFAULT 0 NOT NULL,
  unrealized_delta numeric(14,2) DEFAULT 0 NOT NULL,
  realized numeric(14,2) DEFAULT 0 NOT NULL,
  positions jsonb DEFAULT '[]'::jsonb NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT propreports_live_positions_pkey PRIMARY KEY (account)
);

CREATE TABLE public.propreports_outbox (
  id bigint DEFAULT nextval('public.propreports_outbox_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  payload jsonb,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  run_after timestamp with time zone DEFAULT now() NOT NULL,
  locked_until timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  done_at timestamp with time zone,
  failed_at timestamp with time zone,
  CONSTRAINT propreports_outbox_pkey PRIMARY KEY (id)
);

CREATE TABLE public.propreports_pending_trades (
  id integer DEFAULT nextval('public.propreports_pending_trades_id_seq'::regclass) NOT NULL,
  external_id text NOT NULL,
  account text,
  trader text NOT NULL,
  ticker text NOT NULL,
  "date" text NOT NULL,
  side text,
  payload jsonb NOT NULL,
  candidate_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT propreports_pending_trades_pkey PRIMARY KEY (id),
  CONSTRAINT propreports_pending_trades_external_id_key UNIQUE (external_id)
);

CREATE TABLE public.propreports_performance_reports (
  id integer DEFAULT nextval('public.propreports_performance_reports_id_seq'::regclass) NOT NULL,
  account text NOT NULL,
  trader_name text,
  period_from text NOT NULL,
  period_to text NOT NULL,
  file_name text,
  data jsonb NOT NULL,
  uploaded_by text,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT propreports_performance_reports_pkey PRIMARY KEY (id),
  CONSTRAINT propreports_performance_repor_account_period_from_period_to_key UNIQUE (account, period_from, period_to)
);

CREATE TABLE public.propreports_reconcile_days (
  id integer DEFAULT nextval('public.propreports_reconcile_days_id_seq'::regclass) NOT NULL,
  account text NOT NULL,
  account_id text,
  trader text,
  "date" text NOT NULL,
  status text NOT NULL,
  ours_net numeric(14,4),
  broker_net numeric(14,4),
  diff numeric(14,4) DEFAULT 0 NOT NULL,
  ours_trades integer,
  broker_fills integer,
  carry boolean DEFAULT false NOT NULL,
  adj_diff numeric(14,4),
  transfer_diff numeric(14,4),
  details jsonb,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  acknowledged_at timestamp with time zone,
  acknowledged_by text,
  acknowledged_diff numeric(14,4),
  ack_note text,
  CONSTRAINT propreports_reconcile_days_pkey PRIMARY KEY (id),
  CONSTRAINT propreports_reconcile_days_account_date_key UNIQUE (account, date),
  CONSTRAINT propreports_reconcile_days_status_check CHECK (status = ANY (ARRAY['ok'::text, 'mismatch'::text, 'missing_ours'::text, 'missing_broker'::text]))
);

CREATE TABLE public.propreports_settings (
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT propreports_settings_pkey PRIMARY KEY (key)
);

CREATE TABLE public.propreports_sync_runs (
  id integer DEFAULT nextval('public.propreports_sync_runs_id_seq'::regclass) NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  source text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  file_name text,
  date_from text,
  date_to text,
  inserted integer DEFAULT 0 NOT NULL,
  updated integer DEFAULT 0 NOT NULL,
  unchanged integer DEFAULT 0 NOT NULL,
  skipped integer DEFAULT 0 NOT NULL,
  conflicts integer DEFAULT 0 NOT NULL,
  errors integer DEFAULT 0 NOT NULL,
  error_text text,
  actor text,
  details jsonb,
  CONSTRAINT propreports_sync_runs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.propreports_tick_lease (
  "name" text NOT NULL,
  holder text NOT NULL,
  acquired_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT propreports_tick_lease_pkey PRIMARY KEY (name)
);

CREATE TABLE public.propreports_tick_steps (
  "name" text NOT NULL,
  last_run_at timestamp with time zone,
  last_ok_at timestamp with time zone,
  last_done boolean,
  last_note text,
  last_error text,
  last_ms integer,
  runs integer DEFAULT 0 NOT NULL,
  CONSTRAINT propreports_tick_steps_pkey PRIMARY KEY (name)
);

CREATE TABLE public.quest_events (
  trader text NOT NULL,
  kind text NOT NULL,
  ref text NOT NULL,
  day text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT quest_events_pkey PRIMARY KEY (trader, kind, ref)
);

CREATE TABLE public.quest_instances (
  id integer DEFAULT nextval('public.quest_instances_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  scope text NOT NULL,
  template text NOT NULL,
  period text NOT NULL,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  progress integer DEFAULT 0 NOT NULL,
  target integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  reward_points integer DEFAULT 0 NOT NULL,
  starts_on text NOT NULL,
  ends_on text,
  completed_on text,
  assigned_by text,
  note text,
  cancelled_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  notified_status text,
  CONSTRAINT quest_instances_pkey PRIMARY KEY (id)
);

CREATE TABLE public.recognition_events (
  id integer DEFAULT nextval('public.recognition_events_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  kind text NOT NULL,
  ref text NOT NULL,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  day text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  posted_at timestamp with time zone,
  CONSTRAINT recognition_events_pkey PRIMARY KEY (id),
  CONSTRAINT recognition_events_trader_kind_ref_key UNIQUE (trader, kind, ref)
);

CREATE TABLE public.research (
  id integer DEFAULT nextval('public.research_id_seq'::regclass) NOT NULL,
  pattern_name text NOT NULL,
  ticker text,
  context text,
  market_condition text,
  what_worked text,
  what_failed text,
  repeat_count integer DEFAULT 1,
  confidence_level integer DEFAULT 50,
  screenshot_url text,
  screenshot_notes text,
  tags text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text,
  "date" text,
  playbook_id integer,
  deleted_at timestamp with time zone,
  market_cap text,
  "float" text,
  adv text,
  atr numeric(12,4),
  relative_volume numeric(8,2),
  beta numeric(8,4),
  short_interest numeric(8,4),
  sector text,
  long_name text,
  CONSTRAINT research_pkey PRIMARY KEY (id)
);

CREATE TABLE public.research_pins (
  user_name text NOT NULL,
  research_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT research_pins_pkey PRIMARY KEY (user_name, research_id)
);

CREATE TABLE public.reward_grants (
  id integer DEFAULT nextval('public.reward_grants_id_seq'::regclass) NOT NULL,
  item_id integer NOT NULL,
  trader text NOT NULL,
  ref text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'eligible'::text NOT NULL,
  eligible_at timestamp with time zone DEFAULT now() NOT NULL,
  requested_at timestamp with time zone,
  decided_at timestamp with time zone,
  decided_by text,
  note text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT reward_grants_pkey PRIMARY KEY (id),
  CONSTRAINT reward_grants_item_id_trader_ref_key UNIQUE (item_id, trader, ref),
  CONSTRAINT reward_grants_status_check CHECK (status = ANY (ARRAY['eligible'::text, 'requested'::text, 'granted'::text, 'declined'::text, 'revoked'::text]))
);

CREATE TABLE public.reward_items (
  id integer DEFAULT nextval('public.reward_items_id_seq'::regclass) NOT NULL,
  title text NOT NULL,
  description text,
  condition_kind text NOT NULL,
  condition_ref text DEFAULT ''::text NOT NULL,
  condition_tier text,
  condition_rank integer,
  active boolean DEFAULT false NOT NULL,
  stock integer,
  created_by text,
  updated_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT reward_items_pkey PRIMARY KEY (id),
  CONSTRAINT reward_items_condition_kind_check CHECK (condition_kind = ANY (ARRAY['achievement'::text, 'level'::text, 'season_rank'::text, 'mastery'::text]))
);

CREATE TABLE public.risk_alert_log (
  id integer DEFAULT nextval('public.risk_alert_log_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  "date" text NOT NULL,
  kind text NOT NULL,
  "level" text NOT NULL,
  used numeric(14,2),
  "limit" numeric(14,2),
  message text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT risk_alert_log_pkey PRIMARY KEY (id),
  CONSTRAINT risk_alert_log_trader_date_kind_key UNIQUE (trader, date, kind)
);

CREATE TABLE public.risk_breach_reviews (
  id integer DEFAULT nextval('public.risk_breach_reviews_id_seq'::regclass) NOT NULL,
  alert_id integer NOT NULL,
  trader text NOT NULL,
  "date" text NOT NULL,
  kind text NOT NULL,
  reason text NOT NULL,
  comment text,
  actions jsonb DEFAULT '[]'::jsonb NOT NULL,
  consequence text DEFAULT 'none'::text NOT NULL,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  archived_by text,
  CONSTRAINT risk_breach_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT risk_breach_reviews_alert_id_key UNIQUE (alert_id)
);

CREATE TABLE public.risk_live_alerts (
  id integer DEFAULT nextval('public.risk_live_alerts_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  "date" text NOT NULL,
  threshold text NOT NULL,
  pnl_net numeric(14,2),
  unrealized numeric(14,2),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT risk_live_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT risk_live_alerts_trader_date_threshold_key UNIQUE (trader, date, threshold)
);

CREATE TABLE public.role_permissions (
  role text NOT NULL,
  capability text NOT NULL,
  allowed boolean DEFAULT true NOT NULL,
  scope text,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role, capability)
);

CREATE TABLE public.rule_self_checks (
  id integer DEFAULT nextval('public.rule_self_checks_id_seq'::regclass) NOT NULL,
  rule_id integer NOT NULL,
  trader text NOT NULL,
  day text NOT NULL,
  ok boolean,
  note text,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT rule_self_checks_pkey PRIMARY KEY (id),
  CONSTRAINT rule_self_checks_rule_id_trader_day_key UNIQUE (rule_id, trader, day)
);

CREATE TABLE public.rule_violations (
  id integer DEFAULT nextval('public.rule_violations_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  rule_id integer NOT NULL,
  trade_id integer,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  severity text DEFAULT 'medium'::text NOT NULL,
  message text NOT NULL,
  details jsonb,
  archived_at timestamp with time zone,
  archived_reason text,
  dedup_key text,
  day text,
  cost_net numeric(12,2),
  acknowledged_by text,
  acknowledged_at timestamp with time zone,
  comment text,
  resolution text,
  consequence text,
  resolved_by text,
  resolved_at timestamp with time zone,
  CONSTRAINT rule_violations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.scaling_history (
  id integer DEFAULT nextval('public.scaling_history_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  action text NOT NULL,
  from_tier text,
  to_tier text NOT NULL,
  proposal_id integer,
  actor text NOT NULL,
  comment text,
  limits jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT scaling_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.scaling_proposals (
  id integer DEFAULT nextval('public.scaling_proposals_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  action text NOT NULL,
  from_tier text,
  to_tier text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  source text DEFAULT 'auto'::text NOT NULL,
  reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
  snapshot jsonb,
  comment text,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  decided_by text,
  decided_at timestamp with time zone,
  decision_comment text,
  CONSTRAINT scaling_proposals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.scaling_rules (
  id integer DEFAULT nextval('public.scaling_rules_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  metric text NOT NULL,
  op text NOT NULL,
  "value" numeric(14,4) NOT NULL,
  unit text DEFAULT 'abs'::text NOT NULL,
  window_days integer DEFAULT 20 NOT NULL,
  tier_key text,
  label text,
  enabled boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT scaling_rules_pkey PRIMARY KEY (id)
);

CREATE TABLE public.scaling_tiers (
  "key" text NOT NULL,
  "name" text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  account_size numeric(14,2),
  daily_loss_limit numeric(12,2),
  weekly_loss_limit numeric(12,2),
  max_drawdown numeric(12,2),
  max_risk_per_trade numeric(12,2),
  max_position_usd numeric(14,2),
  max_overnight_exposure numeric(14,2),
  max_open_positions integer,
  allow_overnight boolean DEFAULT false NOT NULL,
  allow_swing boolean DEFAULT false NOT NULL,
  description text,
  active boolean DEFAULT true NOT NULL,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT scaling_tiers_pkey PRIMARY KEY (key)
);

CREATE TABLE public.schema_migrations (
  version text NOT NULL,
  "name" text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamp with time zone DEFAULT now() NOT NULL,
  execution_ms integer,
  baseline boolean DEFAULT false NOT NULL,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);

CREATE TABLE public.sector_strength_cache (
  symbol text NOT NULL,
  "name" text,
  price numeric(12,4),
  change_pct numeric(8,4),
  prev_close numeric(12,4),
  trend_5d numeric(8,4),
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT sector_strength_cache_pkey PRIMARY KEY (symbol)
);

CREATE TABLE public.setup_mastery (
  trader text NOT NULL,
  setup_id integer NOT NULL,
  "level" integer DEFAULT 0 NOT NULL,
  level_on text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT setup_mastery_pkey PRIMARY KEY (trader, setup_id)
);

CREATE TABLE public.sim_games (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id integer NOT NULL,
  mode text NOT NULL,
  difficulty text NOT NULL,
  ticker text NOT NULL,
  day text NOT NULL,
  day_to text,
  tf text NOT NULL,
  bars jsonb NOT NULL,
  start_idx integer NOT NULL,
  end_idx integer NOT NULL,
  cursor_idx integer NOT NULL,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  events jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  result jsonb,
  net_pnl numeric(14,2),
  r_total numeric(10,2),
  pct numeric(10,2),
  bh_pct numeric(10,2),
  beat_bh boolean,
  trades_count integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  series_id integer,
  CONSTRAINT sim_games_pkey PRIMARY KEY (id),
  CONSTRAINT sim_games_difficulty_check CHECK (difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])),
  CONSTRAINT sim_games_mode_check CHECK (mode = ANY (ARRAY['intraday'::text, 'swing'::text])),
  CONSTRAINT sim_games_status_check CHECK (status = ANY (ARRAY['active'::text, 'finished'::text, 'abandoned'::text, 'skipped'::text, 'prepared'::text])),
  CONSTRAINT sim_games_tf_check CHECK (tf = ANY (ARRAY['1m'::text, '2m'::text, '5m'::text, '1d'::text]))
);

CREATE TABLE public.sim_prefs (
  user_id integer NOT NULL,
  leaderboard_visible boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT sim_prefs_pkey PRIMARY KEY (user_id)
);

CREATE TABLE public.sim_series (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id integer NOT NULL,
  mode text NOT NULL,
  difficulty text NOT NULL,
  tf text,
  size integer NOT NULL,
  idx integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  CONSTRAINT sim_series_pkey PRIMARY KEY (id),
  CONSTRAINT sim_series_difficulty_check CHECK (difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])),
  CONSTRAINT sim_series_mode_check CHECK (mode = ANY (ARRAY['intraday'::text, 'swing'::text])),
  CONSTRAINT sim_series_size_check CHECK (size >= 1 AND size <= 50),
  CONSTRAINT sim_series_status_check CHECK (status = ANY (ARRAY['active'::text, 'finished'::text, 'abandoned'::text])),
  CONSTRAINT sim_series_tf_check CHECK (tf IS NULL OR (tf = ANY (ARRAY['1m'::text, '2m'::text, '5m'::text])))
);

CREATE TABLE public.telegram_link_tokens (
  id integer DEFAULT nextval('public.telegram_link_tokens_id_seq'::regclass) NOT NULL,
  token text NOT NULL,
  user_name text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT telegram_link_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT telegram_link_tokens_token_key UNIQUE (token)
);

CREATE TABLE public.telegram_pending_actions (
  id integer DEFAULT nextval('public.telegram_pending_actions_id_seq'::regclass) NOT NULL,
  telegram_chat_id text NOT NULL,
  action text NOT NULL,
  idea_id integer NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT telegram_pending_actions_pkey PRIMARY KEY (id),
  CONSTRAINT telegram_pending_actions_telegram_chat_id_key UNIQUE (telegram_chat_id)
);

CREATE TABLE public.ticker_data_cache (
  ticker text NOT NULL,
  market_cap text,
  "float" text,
  shares_outstanding text,
  short_interest numeric(8,2),
  atr numeric(12,4),
  relative_volume numeric(8,2),
  beta numeric(8,4),
  average_daily_volume text,
  sector text,
  industry text,
  long_name text,
  raw jsonb,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ticker_data_cache_pkey PRIMARY KEY (ticker)
);

CREATE TABLE public.trade_archive_batches (
  id integer DEFAULT nextval('public.trade_archive_batches_id_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  note text,
  trade_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
  violation_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
  reassigned jsonb,
  restored_at timestamp with time zone,
  CONSTRAINT trade_archive_batches_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trade_executions (
  id integer DEFAULT nextval('public.trade_executions_id_seq'::regclass) NOT NULL,
  trade_id integer NOT NULL,
  kind text NOT NULL,
  price numeric(12,4) NOT NULL,
  qty numeric(12,2),
  executed_at timestamp with time zone,
  note text,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  role text,
  role_inferred boolean DEFAULT false NOT NULL,
  leg_index integer,
  order_id text,
  CONSTRAINT trade_executions_pkey PRIMARY KEY (id),
  CONSTRAINT trade_executions_kind_enum CHECK (kind = ANY (ARRAY['entry'::text, 'add'::text, 'trim'::text, 'exit'::text, 'stop'::text]))
);

CREATE TABLE public.trade_idea_comments (
  id integer DEFAULT nextval('public.trade_idea_comments_id_seq'::regclass) NOT NULL,
  idea_id integer NOT NULL,
  author_name text NOT NULL,
  "text" text NOT NULL,
  is_private boolean DEFAULT false NOT NULL,
  source text DEFAULT 'website'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trade_idea_comments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trade_idea_reactions (
  id integer DEFAULT nextval('public.trade_idea_reactions_id_seq'::regclass) NOT NULL,
  trade_idea_id integer NOT NULL,
  trader text NOT NULL,
  reaction text NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trade_idea_reactions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trade_ideas (
  id integer DEFAULT nextval('public.trade_ideas_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  side text,
  setup text,
  entry_zone text,
  target text,
  stop text,
  thesis text,
  score integer,
  score_breakdown text,
  status text DEFAULT 'draft'::text NOT NULL,
  trader text,
  playbook_id integer,
  watchlist_id integer,
  screenshot_url text,
  tags text,
  published_at timestamp with time zone,
  converted_trade_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  review_status text,
  review_reason text,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  market_cap text,
  "float" text,
  adv text,
  atr numeric(12,4),
  relative_volume numeric(8,2),
  beta numeric(8,4),
  short_interest numeric(8,4),
  sector text,
  long_name text,
  notes text,
  idea_date text,
  risk_amount numeric(12,2),
  setup_quality text,
  horizon text,
  valid_until text,
  trade_link_source text,
  trade_linked_at timestamp with time zone,
  CONSTRAINT trade_ideas_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trade_quality (
  trade_id integer NOT NULL,
  inputs_hash text NOT NULL,
  after_exit_min integer DEFAULT 30 NOT NULL,
  payload jsonb NOT NULL,
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trade_quality_pkey PRIMARY KEY (trade_id)
);

CREATE TABLE public.trade_reactions (
  id integer DEFAULT nextval('public.trade_reactions_id_seq'::regclass) NOT NULL,
  trade_id integer NOT NULL,
  trader text NOT NULL,
  reaction_type text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trade_reactions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trade_reviews (
  id integer DEFAULT nextval('public.trade_reviews_id_seq'::regclass) NOT NULL,
  trade_id integer NOT NULL,
  curator text NOT NULL,
  comment text NOT NULL,
  rating text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trade_reviews_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trade_setup_suggestions (
  id integer DEFAULT nextval('public.trade_setup_suggestions_id_seq'::regclass) NOT NULL,
  trade_id integer NOT NULL,
  inputs_hash text NOT NULL,
  setup text NOT NULL,
  confidence numeric(4,2) DEFAULT 0 NOT NULL,
  explanation jsonb DEFAULT '{}'::jsonb NOT NULL,
  features jsonb DEFAULT '{}'::jsonb NOT NULL,
  candles_available boolean DEFAULT false NOT NULL,
  "interval" text,
  version text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'suggested'::text NOT NULL,
  decided_by text,
  decided_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trade_setup_suggestions_pkey PRIMARY KEY (id),
  CONSTRAINT trade_setup_suggestions_trade_id_inputs_hash_key UNIQUE (trade_id, inputs_hash)
);

CREATE TABLE public.trader_achievements (
  trader text NOT NULL,
  line text NOT NULL,
  tier text NOT NULL,
  earned_on text NOT NULL,
  target integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trader_achievements_pkey PRIMARY KEY (trader, line, tier)
);

CREATE TABLE public.trader_badges (
  trader text NOT NULL,
  badge text NOT NULL,
  awarded_on text NOT NULL,
  target integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trader_badges_pkey PRIMARY KEY (trader, badge)
);

CREATE TABLE public.trader_plans (
  id integer DEFAULT nextval('public.trader_plans_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  "date" text NOT NULL,
  doc jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT trader_plans_pkey PRIMARY KEY (id),
  CONSTRAINT trader_plans_trader_date_key UNIQUE (trader, date)
);

CREATE TABLE public.trader_progress_snapshots (
  id bigint DEFAULT nextval('public.trader_progress_snapshots_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  as_of date NOT NULL,
  run_kind text NOT NULL,
  tenure_active_days integer NOT NULL,
  stage text,
  pace_target numeric(12,2),
  n_days integer DEFAULT 0 NOT NULL,
  mean_raw numeric(12,2),
  mean_lb numeric(12,2),
  lo80 numeric(12,2),
  hi80 numeric(12,2),
  p_impr numeric(6,4),
  shrunk boolean DEFAULT false NOT NULL,
  plateau boolean DEFAULT false NOT NULL,
  severity text,
  escalated boolean DEFAULT false NOT NULL,
  admin_escalated boolean DEFAULT false NOT NULL,
  suppressed_until date,
  diagnosis jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trader_progress_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT trader_progress_snapshots_key UNIQUE (trader, as_of, run_kind),
  CONSTRAINT trader_progress_snapshots_run_kind_check CHECK (run_kind = ANY (ARRAY['monthly'::text, 'weekly'::text])),
  CONSTRAINT trader_progress_snapshots_severity_check CHECK (severity = ANY (ARRAY['slow'::text, 'stuck'::text, 'stuck_long'::text]))
);

CREATE TABLE public.trader_ratings (
  id integer DEFAULT nextval('public.trader_ratings_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  curator text NOT NULL,
  week text NOT NULL,
  discipline integer DEFAULT 5,
  risk_management integer DEFAULT 5,
  execution integer DEFAULT 5,
  journaling integer DEFAULT 5,
  improvement integer DEFAULT 5,
  overall integer DEFAULT 5,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  focus text,
  evidence jsonb,
  tier text,
  acknowledged_at timestamp with time zone,
  updated_at timestamp with time zone,
  CONSTRAINT trader_ratings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trader_risk_limit_events (
  id integer DEFAULT nextval('public.trader_risk_limit_events_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  before jsonb,
  after jsonb NOT NULL,
  reason text,
  changed_by text,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trader_risk_limit_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trader_risk_limits (
  trader text NOT NULL,
  account_size numeric(14,2),
  daily_loss_limit numeric(12,2),
  weekly_loss_limit numeric(12,2),
  max_drawdown numeric(12,2),
  max_risk_per_trade numeric(12,2),
  max_position_usd numeric(14,2),
  max_overnight_exposure numeric(14,2),
  max_open_positions integer,
  allow_overnight boolean DEFAULT true NOT NULL,
  allow_swing boolean DEFAULT true NOT NULL,
  tier text,
  notes text,
  updated_by text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  buying_power numeric,
  CONSTRAINT trader_risk_limits_pkey PRIMARY KEY (trader),
  CONSTRAINT trader_risk_limits_buying_power_check CHECK (buying_power IS NULL OR buying_power >= 0::numeric)
);

CREATE TABLE public.trades (
  id integer DEFAULT nextval('public.trades_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  "date" text NOT NULL,
  setup text,
  side text,
  event_type text,
  entry numeric(12,4),
  exit numeric(12,4),
  stop numeric(12,4),
  result text NOT NULL,
  pnl numeric(14,4),
  r_multiple numeric(8,2),
  hold_time text,
  slippage numeric(8,2),
  market_cap text,
  "float" text,
  relative_volume numeric(8,2),
  session text,
  screenshot_url text,
  notes text,
  what_worked text,
  what_failed text,
  conclusion text,
  trader text,
  tags text,
  event_id integer,
  pattern_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  screenshot_notes text,
  deleted_at timestamp with time zone,
  playbook_id integer,
  atr numeric(12,4),
  sector text,
  context_snapshot jsonb,
  conviction integer,
  confidence_grade text,
  beta numeric(8,4),
  short_interest numeric(8,4),
  adv text,
  long_name text,
  setup_score numeric(5,2),
  horizon text,
  exit_date text,
  qty numeric(14,2),
  fees numeric(14,4),
  risk_usd numeric(12,2),
  source text,
  external_id text,
  broker_account text,
  synced_at timestamp with time zone,
  structure jsonb,
  reentry_of integer,
  strategy text,
  entry_sec integer,
  strategy_sig text,
  hold_sec integer,
  overnight boolean,
  entry_kind text,
  exit_kind text,
  day_seq integer,
  prev_kind text,
  notional numeric(14,2),
  adds_kind text,
  size_rel numeric(12,4),
  has_stop boolean,
  is_imx boolean,
  CONSTRAINT trades_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trading_errors (
  id integer DEFAULT nextval('public.trading_errors_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  error_type text NOT NULL,
  description text NOT NULL,
  ticker text,
  trade_id integer,
  severity text DEFAULT 'medium'::text NOT NULL,
  lesson text,
  resolved text DEFAULT 'no'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  code text,
  source text DEFAULT 'manual'::text NOT NULL,
  CONSTRAINT trading_errors_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trading_errors_archive (
  id integer DEFAULT nextval('public.trading_errors_archive_id_seq'::regclass) NOT NULL,
  original_id integer NOT NULL,
  trader text NOT NULL,
  payload jsonb NOT NULL,
  archived_by text,
  archived_at timestamp with time zone DEFAULT now() NOT NULL,
  restored_at timestamp with time zone,
  CONSTRAINT trading_errors_archive_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trading_rules (
  id integer DEFAULT nextval('public.trading_rules_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  "name" text NOT NULL,
  kind text NOT NULL,
  threshold jsonb NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  origin text DEFAULT 'personal'::text NOT NULL,
  created_by text,
  note text,
  deleted_at timestamp with time zone,
  stage text,
  template_key text,
  CONSTRAINT trading_rules_pkey PRIMARY KEY (id)
);

CREATE TABLE public.trainer_daily_challenges (
  "date" text NOT NULL,
  ticker text NOT NULL,
  bars_day text NOT NULL,
  tf text DEFAULT '1m'::text NOT NULL,
  desk_traders integer DEFAULT 0 NOT NULL,
  features jsonb DEFAULT '{}'::jsonb NOT NULL,
  picked_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trainer_daily_challenges_pkey PRIMARY KEY (date)
);

CREATE TABLE public.trainer_drill_attempts (
  id integer DEFAULT nextval('public.trainer_drill_attempts_id_seq'::regclass) NOT NULL,
  drill_id integer NOT NULL,
  user_id integer NOT NULL,
  trader text NOT NULL,
  setup_id integer NOT NULL,
  bar_index integer NOT NULL,
  price numeric(16,4) NOT NULL,
  score integer NOT NULL,
  first boolean DEFAULT false NOT NULL,
  passed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trainer_drill_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT trainer_drill_attempts_score_check CHECK (score >= 0 AND score <= 100)
);

CREATE TABLE public.trainer_drills (
  id integer DEFAULT nextval('public.trainer_drills_id_seq'::regclass) NOT NULL,
  setup_id integer NOT NULL,
  source text NOT NULL,
  trade_id integer NOT NULL,
  trader text NOT NULL,
  ticker text NOT NULL,
  day text NOT NULL,
  side text NOT NULL,
  entry_at timestamp with time zone NOT NULL,
  entry_price numeric(16,4) NOT NULL,
  disabled boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trainer_drills_pkey PRIMARY KEY (id),
  CONSTRAINT trainer_drills_side_check CHECK (side = ANY (ARRAY['long'::text, 'short'::text])),
  CONSTRAINT trainer_drills_source_check CHECK (source = ANY (ARRAY['playbook_example'::text, 'desk_trade'::text]))
);

CREATE TABLE public.usage_events (
  id bigint DEFAULT nextval('public.usage_events_id_seq'::regclass) NOT NULL,
  user_id integer NOT NULL,
  trader text NOT NULL,
  role text NOT NULL,
  kind text NOT NULL,
  "key" text NOT NULL,
  ny_day text NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  meta jsonb,
  CONSTRAINT usage_events_pkey PRIMARY KEY (id),
  CONSTRAINT usage_events_key_check CHECK (char_length(key) >= 1 AND char_length(key) <= 120),
  CONSTRAINT usage_events_kind_check CHECK (kind = ANY (ARRAY['view'::text, 'action'::text]))
);

CREATE TABLE public.user_boards (
  id integer DEFAULT nextval('public.user_boards_id_seq'::regclass) NOT NULL,
  user_id integer NOT NULL,
  "name" text NOT NULL,
  kind text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  columns text[] DEFAULT '{}'::text[] NOT NULL,
  sort jsonb,
  pinned integer[] DEFAULT '{}'::integer[] NOT NULL,
  source text,
  tickers text[] DEFAULT '{}'::text[] NOT NULL,
  filters text[] DEFAULT '{}'::text[] NOT NULL,
  sort_order text,
  top_n integer DEFAULT 25 NOT NULL,
  resolved_tickers text[] DEFAULT '{}'::text[] NOT NULL,
  resolved_at timestamp with time zone,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_boards_pkey PRIMARY KEY (id),
  CONSTRAINT user_boards_check CHECK (kind = 'themes'::text OR source IS NOT NULL),
  CONSTRAINT user_boards_filters_check CHECK (cardinality(filters) <= 15),
  CONSTRAINT user_boards_kind_check CHECK (kind = ANY (ARRAY['themes'::text, 'tickers'::text])),
  CONSTRAINT user_boards_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 40),
  CONSTRAINT user_boards_source_check CHECK (source = ANY (ARRAY['tickers'::text, 'screener'::text])),
  CONSTRAINT user_boards_tickers_check CHECK (cardinality(tickers) <= 50),
  CONSTRAINT user_boards_top_n_check CHECK (top_n = ANY (ARRAY[25, 50]))
);

CREATE TABLE public.user_themes (
  id integer DEFAULT nextval('public.user_themes_id_seq'::regclass) NOT NULL,
  user_id integer NOT NULL,
  "name" text NOT NULL,
  kind text NOT NULL,
  tickers text[] DEFAULT '{}'::text[] NOT NULL,
  filters text[] DEFAULT '{}'::text[] NOT NULL,
  sort_order text,
  resolved_tickers text[] DEFAULT '{}'::text[] NOT NULL,
  resolved_at timestamp with time zone,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  board_id integer,
  archived_with_board boolean DEFAULT false NOT NULL,
  CONSTRAINT user_themes_pkey PRIMARY KEY (id),
  CONSTRAINT user_themes_check CHECK (kind = 'tickers'::text AND cardinality(tickers) >= 1 OR kind = 'screener'::text AND cardinality(filters) >= 1),
  CONSTRAINT user_themes_filters_check CHECK (cardinality(filters) <= 15),
  CONSTRAINT user_themes_kind_check CHECK (kind = ANY (ARRAY['tickers'::text, 'screener'::text])),
  CONSTRAINT user_themes_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 60),
  CONSTRAINT user_themes_tickers_check CHECK (cardinality(tickers) <= 30)
);

CREATE TABLE public.users (
  id integer DEFAULT nextval('public.users_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  role text DEFAULT 'trader'::text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  banned boolean DEFAULT false NOT NULL,
  banned_at timestamp with time zone,
  banned_reason text,
  password_hash text,
  token_version integer DEFAULT 0 NOT NULL,
  telegram_chat_id text,
  telegram_linked_at timestamp with time zone,
  assigned_curator text,
  assigned_risk_manager text,
  assigned_mentor text,
  tg_notifications_enabled boolean DEFAULT true NOT NULL,
  theme text DEFAULT 'dark'::text,
  locale text DEFAULT 'ru'::text NOT NULL,
  name_latin text,
  settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  must_change_secret boolean DEFAULT false NOT NULL,
  group_id integer,
  quick_code_hash text,
  quick_code_kind text,
  quick_code_set_at timestamp with time zone,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_name_key UNIQUE (name),
  CONSTRAINT users_quick_code_kind_check CHECK (quick_code_kind = ANY (ARRAY['digits'::text, 'phrase'::text]))
);

CREATE TABLE public.voice_notes (
  id integer DEFAULT nextval('public.voice_notes_id_seq'::regclass) NOT NULL,
  user_id text NOT NULL,
  trade_id integer,
  daily_feed_id integer,
  audio_url text NOT NULL,
  transcript text,
  duration_sec integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT voice_notes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.war_room_levels (
  id integer DEFAULT nextval('public.war_room_levels_id_seq'::regclass) NOT NULL,
  session_id integer NOT NULL,
  ticker text NOT NULL,
  price numeric(12,4) NOT NULL,
  label text NOT NULL,
  "type" text NOT NULL,
  CONSTRAINT war_room_levels_pkey PRIMARY KEY (id)
);

CREATE TABLE public.war_room_sessions (
  id integer DEFAULT nextval('public.war_room_sessions_id_seq'::regclass) NOT NULL,
  trader text,
  event_name text NOT NULL,
  event_time timestamp with time zone NOT NULL,
  notes text,
  checklist jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  CONSTRAINT war_room_sessions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.watchlist (
  id integer DEFAULT nextval('public.watchlist_id_seq'::regclass) NOT NULL,
  ticker text NOT NULL,
  catalyst text,
  target_price numeric(12,4),
  stop_price numeric(12,4),
  status text DEFAULT 'watching'::text NOT NULL,
  notes text,
  sector text,
  tags text,
  screenshot_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  score integer,
  score_breakdown text,
  scored_at timestamp with time zone,
  market_cap text,
  "float" text,
  adv text,
  atr numeric(12,4),
  relative_volume numeric(8,2),
  beta numeric(8,4),
  short_interest numeric(8,4),
  long_name text,
  in_play boolean DEFAULT false NOT NULL,
  in_play_at timestamp with time zone,
  created_by text,
  owner integer,
  list_name text,
  CONSTRAINT watchlist_pkey PRIMARY KEY (id)
);

CREATE TABLE public.weekly_psychology_reports (
  id integer DEFAULT nextval('public.weekly_psychology_reports_id_seq'::regclass) NOT NULL,
  user_id text NOT NULL,
  week_start text NOT NULL,
  week_end text NOT NULL,
  total_trades integer DEFAULT 0 NOT NULL,
  total_checkins integer DEFAULT 0 NOT NULL,
  emotional_breakdown jsonb,
  best_state text,
  worst_state text,
  total_pnl text DEFAULT '0'::text NOT NULL,
  avg_pnl_per_trade text DEFAULT '0'::text NOT NULL,
  win_rate text DEFAULT '0'::text NOT NULL,
  key_insights jsonb,
  raw_stats jsonb,
  generated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT weekly_psychology_reports_pkey PRIMARY KEY (id)
);

CREATE TABLE public.weekly_reviews (
  id integer DEFAULT nextval('public.weekly_reviews_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  week text NOT NULL,
  week_start date NOT NULL,
  self_review jsonb DEFAULT '{}'::jsonb NOT NULL,
  curator_review jsonb DEFAULT '{}'::jsonb NOT NULL,
  goals jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT weekly_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT weekly_reviews_trader_week_key UNIQUE (trader, week)
);

CREATE TABLE public.whatif_honesty_cache (
  id bigint DEFAULT nextval('public.whatif_honesty_cache_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  period_from text DEFAULT ''::text NOT NULL,
  period_to text DEFAULT ''::text NOT NULL,
  data_sig text NOT NULL,
  engine_version integer NOT NULL,
  state text DEFAULT 'queued'::text NOT NULL,
  result jsonb,
  error text,
  attempts integer DEFAULT 0 NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  used_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  duration_ms integer,
  CONSTRAINT whatif_honesty_cache_pkey PRIMARY KEY (id),
  CONSTRAINT whatif_honesty_cache_key UNIQUE (trader, period_from, period_to, data_sig, engine_version),
  CONSTRAINT whatif_honesty_cache_state_check CHECK (state = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text]))
);

CREATE TABLE public.whatif_scenarios (
  id integer DEFAULT nextval('public.whatif_scenarios_id_seq'::regclass) NOT NULL,
  trader text NOT NULL,
  "name" text NOT NULL,
  rules jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT whatif_scenarios_pkey PRIMARY KEY (id)
);

ALTER SEQUENCE public.academy_action_items_id_seq OWNED BY public.academy_action_items.id;
ALTER SEQUENCE public.academy_assignments_id_seq OWNED BY public.academy_assignments.id;
ALTER SEQUENCE public.academy_attendance_id_seq OWNED BY public.academy_attendance.id;
ALTER SEQUENCE public.academy_challenges_id_seq OWNED BY public.academy_challenges.id;
ALTER SEQUENCE public.academy_cohorts_id_seq OWNED BY public.academy_cohorts.id;
ALTER SEQUENCE public.academy_enrollment_history_id_seq OWNED BY public.academy_enrollment_history.id;
ALTER SEQUENCE public.academy_enrollments_id_seq OWNED BY public.academy_enrollments.id;
ALTER SEQUENCE public.academy_idp_goals_id_seq OWNED BY public.academy_idp_goals.id;
ALTER SEQUENCE public.academy_lessons_id_seq OWNED BY public.academy_lessons.id;
ALTER SEQUENCE public.academy_modules_id_seq OWNED BY public.academy_modules.id;
ALTER SEQUENCE public.academy_one_on_ones_id_seq OWNED BY public.academy_one_on_ones.id;
ALTER SEQUENCE public.academy_programs_id_seq OWNED BY public.academy_programs.id;
ALTER SEQUENCE public.academy_promotion_requests_id_seq OWNED BY public.academy_promotion_requests.id;
ALTER SEQUENCE public.academy_quiz_attempts_id_seq OWNED BY public.academy_quiz_attempts.id;
ALTER SEQUENCE public.academy_quizzes_id_seq OWNED BY public.academy_quizzes.id;
ALTER SEQUENCE public.academy_sessions_id_seq OWNED BY public.academy_sessions.id;
ALTER SEQUENCE public.academy_stage_criteria_id_seq OWNED BY public.academy_stage_criteria.id;
ALTER SEQUENCE public.academy_stage_history_id_seq OWNED BY public.academy_stage_history.id;
ALTER SEQUENCE public.academy_submissions_id_seq OWNED BY public.academy_submissions.id;
ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;
ALTER SEQUENCE public.ai_review_rate_limit_id_seq OWNED BY public.ai_review_rate_limit.id;
ALTER SEQUENCE public.ai_trade_reviews_id_seq OWNED BY public.ai_trade_reviews.id;
ALTER SEQUENCE public.analyst_actions_cache_id_seq OWNED BY public.analyst_actions_cache.id;
ALTER SEQUENCE public.app_error_occurrences_id_seq OWNED BY public.app_error_occurrences.id;
ALTER SEQUENCE public.app_errors_id_seq OWNED BY public.app_errors.id;
ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;
ALTER SEQUENCE public.author_notes_id_seq OWNED BY public.author_notes.id;
ALTER SEQUENCE public.author_weekly_summaries_id_seq OWNED BY public.author_weekly_summaries.id;
ALTER SEQUENCE public.behavior_triggers_id_seq OWNED BY public.behavior_triggers.id;
ALTER SEQUENCE public.big7_catalysts_id_seq OWNED BY public.big7_catalysts.id;
ALTER SEQUENCE public.big7_levels_id_seq OWNED BY public.big7_levels.id;
ALTER SEQUENCE public.big7_tickers_id_seq OWNED BY public.big7_tickers.id;
ALTER SEQUENCE public.candles_cache_id_seq OWNED BY public.candles_cache.id;
ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;
ALTER SEQUENCE public.content_reports_id_seq OWNED BY public.content_reports.id;
ALTER SEQUENCE public.curator_interventions_id_seq OWNED BY public.curator_interventions.id;
ALTER SEQUENCE public.curator_notes_id_seq OWNED BY public.curator_notes.id;
ALTER SEQUENCE public.curator_requests_id_seq OWNED BY public.curator_requests.id;
ALTER SEQUENCE public.daily_feed_id_seq OWNED BY public.daily_feed.id;
ALTER SEQUENCE public.daily_quotes_id_seq OWNED BY public.daily_quotes.id;
ALTER SEQUENCE public.desk_groups_id_seq OWNED BY public.desk_groups.id;
ALTER SEQUENCE public.digest_subscriptions_id_seq OWNED BY public.digest_subscriptions.id;
ALTER SEQUENCE public.discussion_votes_id_seq OWNED BY public.discussion_votes.id;
ALTER SEQUENCE public.discussions_id_seq OWNED BY public.discussions.id;
ALTER SEQUENCE public.edge_map_id_seq OWNED BY public.edge_map.id;
ALTER SEQUENCE public.emotional_state_log_id_seq OWNED BY public.emotional_state_log.id;
ALTER SEQUENCE public.eod_days_id_seq OWNED BY public.eod_days.id;
ALTER SEQUENCE public.finviz_runs_id_seq OWNED BY public.finviz_runs.id;
ALTER SEQUENCE public.game_plans_id_seq OWNED BY public.game_plans.id;
ALTER SEQUENCE public.holiday_calendar_id_seq OWNED BY public.holiday_calendar.id;
ALTER SEQUENCE public.journal_days_id_seq OWNED BY public.journal_days.id;
ALTER SEQUENCE public.junior_note_reminders_id_seq OWNED BY public.junior_note_reminders.id;
ALTER SEQUENCE public.junior_notes_id_seq OWNED BY public.junior_notes.id;
ALTER SEQUENCE public.market_events_id_seq OWNED BY public.market_events.id;
ALTER SEQUENCE public.market_open_brief_cache_id_seq OWNED BY public.market_open_brief_cache.id;
ALTER SEQUENCE public.market_themes_id_seq OWNED BY public.market_themes.id;
ALTER SEQUENCE public.news_cache_id_seq OWNED BY public.news_cache.id;
ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;
ALTER SEQUENCE public.plan_media_id_seq OWNED BY public.plan_media.id;
ALTER SEQUENCE public.plan_templates_id_seq OWNED BY public.plan_templates.id;
ALTER SEQUENCE public.playbook_checklist_runs_id_seq OWNED BY public.playbook_checklist_runs.id;
ALTER SEQUENCE public.playbook_examples_id_seq OWNED BY public.playbook_examples.id;
ALTER SEQUENCE public.playbook_id_seq OWNED BY public.playbook.id;
ALTER SEQUENCE public.playbook_media_id_seq OWNED BY public.playbook_media.id;
ALTER SEQUENCE public.playbook_reviews_id_seq OWNED BY public.playbook_reviews.id;
ALTER SEQUENCE public.playbook_revisions_id_seq OWNED BY public.playbook_revisions.id;
ALTER SEQUENCE public.pre_trade_checklist_responses_id_seq OWNED BY public.pre_trade_checklist_responses.id;
ALTER SEQUENCE public.pre_trade_checklist_template_id_seq OWNED BY public.pre_trade_checklist_template.id;
ALTER SEQUENCE public.propreports_accounts_id_seq OWNED BY public.propreports_accounts.id;
ALTER SEQUENCE public.propreports_adjustments_id_seq OWNED BY public.propreports_adjustments.id;
ALTER SEQUENCE public.propreports_backfills_id_seq OWNED BY public.propreports_backfills.id;
ALTER SEQUENCE public.propreports_outbox_id_seq OWNED BY public.propreports_outbox.id;
ALTER SEQUENCE public.propreports_pending_trades_id_seq OWNED BY public.propreports_pending_trades.id;
ALTER SEQUENCE public.propreports_performance_reports_id_seq OWNED BY public.propreports_performance_reports.id;
ALTER SEQUENCE public.propreports_reconcile_days_id_seq OWNED BY public.propreports_reconcile_days.id;
ALTER SEQUENCE public.propreports_sync_runs_id_seq OWNED BY public.propreports_sync_runs.id;
ALTER SEQUENCE public.quest_instances_id_seq OWNED BY public.quest_instances.id;
ALTER SEQUENCE public.recognition_events_id_seq OWNED BY public.recognition_events.id;
ALTER SEQUENCE public.research_id_seq OWNED BY public.research.id;
ALTER SEQUENCE public.reward_grants_id_seq OWNED BY public.reward_grants.id;
ALTER SEQUENCE public.reward_items_id_seq OWNED BY public.reward_items.id;
ALTER SEQUENCE public.risk_alert_log_id_seq OWNED BY public.risk_alert_log.id;
ALTER SEQUENCE public.risk_breach_reviews_id_seq OWNED BY public.risk_breach_reviews.id;
ALTER SEQUENCE public.risk_live_alerts_id_seq OWNED BY public.risk_live_alerts.id;
ALTER SEQUENCE public.rule_self_checks_id_seq OWNED BY public.rule_self_checks.id;
ALTER SEQUENCE public.rule_violations_id_seq OWNED BY public.rule_violations.id;
ALTER SEQUENCE public.scaling_history_id_seq OWNED BY public.scaling_history.id;
ALTER SEQUENCE public.scaling_proposals_id_seq OWNED BY public.scaling_proposals.id;
ALTER SEQUENCE public.scaling_rules_id_seq OWNED BY public.scaling_rules.id;
ALTER SEQUENCE public.telegram_link_tokens_id_seq OWNED BY public.telegram_link_tokens.id;
ALTER SEQUENCE public.telegram_pending_actions_id_seq OWNED BY public.telegram_pending_actions.id;
ALTER SEQUENCE public.trade_archive_batches_id_seq OWNED BY public.trade_archive_batches.id;
ALTER SEQUENCE public.trade_executions_id_seq OWNED BY public.trade_executions.id;
ALTER SEQUENCE public.trade_idea_comments_id_seq OWNED BY public.trade_idea_comments.id;
ALTER SEQUENCE public.trade_idea_reactions_id_seq OWNED BY public.trade_idea_reactions.id;
ALTER SEQUENCE public.trade_ideas_id_seq OWNED BY public.trade_ideas.id;
ALTER SEQUENCE public.trade_reactions_id_seq OWNED BY public.trade_reactions.id;
ALTER SEQUENCE public.trade_reviews_id_seq OWNED BY public.trade_reviews.id;
ALTER SEQUENCE public.trade_setup_suggestions_id_seq OWNED BY public.trade_setup_suggestions.id;
ALTER SEQUENCE public.trader_plans_id_seq OWNED BY public.trader_plans.id;
ALTER SEQUENCE public.trader_progress_snapshots_id_seq OWNED BY public.trader_progress_snapshots.id;
ALTER SEQUENCE public.trader_ratings_id_seq OWNED BY public.trader_ratings.id;
ALTER SEQUENCE public.trader_risk_limit_events_id_seq OWNED BY public.trader_risk_limit_events.id;
ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;
ALTER SEQUENCE public.trading_errors_archive_id_seq OWNED BY public.trading_errors_archive.id;
ALTER SEQUENCE public.trading_errors_id_seq OWNED BY public.trading_errors.id;
ALTER SEQUENCE public.trading_rules_id_seq OWNED BY public.trading_rules.id;
ALTER SEQUENCE public.trainer_drill_attempts_id_seq OWNED BY public.trainer_drill_attempts.id;
ALTER SEQUENCE public.trainer_drills_id_seq OWNED BY public.trainer_drills.id;
ALTER SEQUENCE public.usage_events_id_seq OWNED BY public.usage_events.id;
ALTER SEQUENCE public.user_boards_id_seq OWNED BY public.user_boards.id;
ALTER SEQUENCE public.user_themes_id_seq OWNED BY public.user_themes.id;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
ALTER SEQUENCE public.voice_notes_id_seq OWNED BY public.voice_notes.id;
ALTER SEQUENCE public.war_room_levels_id_seq OWNED BY public.war_room_levels.id;
ALTER SEQUENCE public.war_room_sessions_id_seq OWNED BY public.war_room_sessions.id;
ALTER SEQUENCE public.watchlist_id_seq OWNED BY public.watchlist.id;
ALTER SEQUENCE public.weekly_psychology_reports_id_seq OWNED BY public.weekly_psychology_reports.id;
ALTER SEQUENCE public.weekly_reviews_id_seq OWNED BY public.weekly_reviews.id;
ALTER SEQUENCE public.whatif_honesty_cache_id_seq OWNED BY public.whatif_honesty_cache.id;
ALTER SEQUENCE public.whatif_scenarios_id_seq OWNED BY public.whatif_scenarios.id;

CREATE INDEX academy_action_items_student_idx ON public.academy_action_items USING btree (student, status);
CREATE INDEX academy_assignments_module_idx ON public.academy_assignments USING btree (module_id);
CREATE INDEX academy_attendance_user_idx ON public.academy_attendance USING btree (user_name, occurrence_date DESC);
CREATE INDEX academy_challenges_user_idx ON public.academy_challenges USING btree (user_name, starts_on DESC) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX academy_cohorts_name_live_uq ON public.academy_cohorts USING btree (name) WHERE (archived_at IS NULL);
CREATE INDEX academy_enrollment_history_enr_idx ON public.academy_enrollment_history USING btree (enrollment_id, changed_at DESC);
CREATE INDEX academy_enrollment_history_user_idx ON public.academy_enrollment_history USING btree (user_name, changed_at DESC);
CREATE UNIQUE INDEX academy_enrollments_live_uq ON public.academy_enrollments USING btree (cohort_id, user_name) WHERE (archived_at IS NULL);
CREATE INDEX academy_enrollments_user_idx ON public.academy_enrollments USING btree (user_name);
CREATE INDEX academy_idp_goals_student_idx ON public.academy_idp_goals USING btree (student, status);
CREATE INDEX academy_lessons_module_idx ON public.academy_lessons USING btree (module_id);
CREATE INDEX academy_lessons_playbook_idx ON public.academy_lessons USING gin (playbook_ids);
CREATE INDEX academy_modules_program_idx ON public.academy_modules USING btree (program_id);
CREATE INDEX academy_one_on_ones_student_idx ON public.academy_one_on_ones USING btree (student, met_at DESC);
CREATE UNIQUE INDEX academy_promotion_requests_pending_uniq ON public.academy_promotion_requests USING btree (user_name) WHERE (status = 'pending'::text);
CREATE INDEX academy_promotion_requests_user_idx ON public.academy_promotion_requests USING btree (user_name, created_at DESC);
CREATE INDEX academy_quiz_attempts_user_idx ON public.academy_quiz_attempts USING btree (user_name, quiz_id);
CREATE INDEX academy_quizzes_module_idx ON public.academy_quizzes USING btree (module_id);
CREATE INDEX academy_sessions_cohort_idx ON public.academy_sessions USING btree (cohort_id);
CREATE INDEX academy_stage_criteria_stage_idx ON public.academy_stage_criteria USING btree (from_stage) WHERE (archived_at IS NULL);
CREATE INDEX academy_stage_history_user_idx ON public.academy_stage_history USING btree (user_name, created_at DESC);
CREATE INDEX academy_submissions_status_idx ON public.academy_submissions USING btree (status) WHERE (archived_at IS NULL);
CREATE INDEX academy_submissions_user_idx ON public.academy_submissions USING btree (user_name, assignment_id);
CREATE INDEX activity_log_section_entity_idx ON public.activity_log USING btree (section, entity_id, created_at DESC);
CREATE INDEX ai_review_rate_created_idx ON public.ai_review_rate_limit USING btree (created_at);
CREATE INDEX ai_review_rate_user_idx ON public.ai_review_rate_limit USING btree (user_key);
CREATE INDEX ai_trade_reviews_generated_at_idx ON public.ai_trade_reviews USING btree (generated_at);
CREATE INDEX ai_trade_reviews_trade_idx ON public.ai_trade_reviews USING btree (trade_id);
CREATE INDEX analyst_actions_graded_at_idx ON public.analyst_actions_cache USING btree (graded_at);
CREATE INDEX analyst_actions_ticker_idx ON public.analyst_actions_cache USING btree (ticker);
CREATE UNIQUE INDEX analyst_actions_unique ON public.analyst_actions_cache USING btree (ticker, graded_at, firm, action);
CREATE INDEX app_error_occurrences_error_idx ON public.app_error_occurrences USING btree (error_id, at DESC);
CREATE INDEX app_errors_last_seen_idx ON public.app_errors USING btree (last_seen DESC);
CREATE INDEX audit_log_action_idx ON public.audit_log USING btree (action);
CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor);
CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at);
CREATE INDEX auth_revoked_sessions_user_idx ON public.auth_revoked_sessions USING btree (user_id, revoked_at DESC);
CREATE INDEX auth_session_locks_user_idx ON public.auth_session_locks USING btree (user_id);
CREATE INDEX author_notes_trader_date_idx ON public.author_notes USING btree (trader, note_date);
CREATE INDEX behavior_triggers_trader_idx ON public.behavior_triggers USING btree (trader) WHERE (deleted_at IS NULL);
CREATE INDEX big7_tickers_group_idx ON public.big7_tickers USING btree (group_name);
CREATE UNIQUE INDEX big7_tickers_group_symbol_unique ON public.big7_tickers USING btree (group_name, symbol);
CREATE INDEX candle_archive_day_idx ON public.candle_archive USING btree (day);
CREATE UNIQUE INDEX candle_archive_key_uidx ON public.candle_archive USING btree (symbol, day, tf);
CREATE UNIQUE INDEX candle_archive_misses_key_uidx ON public.candle_archive_misses USING btree (symbol, day);
CREATE INDEX candles_cache_ticker_idx ON public.candles_cache USING btree (ticker);
CREATE UNIQUE INDEX candles_cache_unique ON public.candles_cache USING btree (ticker, date, "interval", extended);
CREATE INDEX comments_discussion_id_idx ON public.comments USING btree (discussion_id);
CREATE INDEX content_reports_created_at_idx ON public.content_reports USING btree (created_at);
CREATE INDEX content_reports_status_idx ON public.content_reports USING btree (status);
CREATE INDEX content_reports_target_idx ON public.content_reports USING btree (target_type, target_id);
CREATE INDEX curator_interventions_kind_idx ON public.curator_interventions USING btree (kind, started_on);
CREATE INDEX curator_interventions_trader_idx ON public.curator_interventions USING btree (trader, started_on DESC, id DESC);
CREATE INDEX curator_notes_trader_idx ON public.curator_notes USING btree (trader, created_at DESC) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX curator_requests_open_link_uniq ON public.curator_requests USING btree (trader_id, kind, COALESCE(link, ''::text)) WHERE (status = 'open'::text);
CREATE INDEX curator_requests_status_idx ON public.curator_requests USING btree (status, created_at DESC);
CREATE INDEX curator_requests_trader_idx ON public.curator_requests USING btree (trader_id, created_at DESC);
CREATE INDEX daily_feed_date_idx ON public.daily_feed USING btree (date);
CREATE INDEX daily_focus_date_idx ON public.daily_focus USING btree (date);
CREATE UNIQUE INDEX daily_quotes_date_unique ON public.daily_quotes USING btree (date);
CREATE INDEX daily_reviews_date_idx ON public.daily_reviews USING btree (date);
CREATE INDEX daily_reviews_disputed_idx ON public.daily_reviews USING btree (trader, date) WHERE disputed;
CREATE INDEX desk_groups_curator_idx ON public.desk_groups USING btree (curator_id) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX desk_groups_name_active_uniq ON public.desk_groups USING btree (lower(name)) WHERE (archived_at IS NULL);
CREATE INDEX discussion_votes_discussion_idx ON public.discussion_votes USING btree (discussion_id);
CREATE UNIQUE INDEX discussion_votes_unique ON public.discussion_votes USING btree (discussion_id, trader);
CREATE INDEX discussions_ticker_idx ON public.discussions USING btree (ticker);
CREATE INDEX discussions_ticker_upper_idx ON public.discussions USING btree (upper(ticker));
CREATE INDEX discussions_trade_id_idx ON public.discussions USING btree (trade_id);
CREATE INDEX edge_map_latest_idx ON public.edge_map USING btree (trader, as_of DESC);
CREATE INDEX edge_map_verdict_idx ON public.edge_map USING btree (as_of, verdict) WHERE (verdict <> 'NONE'::text);
CREATE INDEX emotional_state_log_date_idx ON public.emotional_state_log USING btree (date);
CREATE INDEX emotional_state_log_user_date_idx ON public.emotional_state_log USING btree (user_id, date);
CREATE INDEX emotional_state_log_user_id_idx ON public.emotional_state_log USING btree (user_id);
CREATE INDEX eod_days_queue_idx ON public.eod_days USING btree (closed_at) WHERE ((closed_at IS NOT NULL) AND (reviewed_at IS NULL));
CREATE INDEX finviz_earnings_date_idx ON public.finviz_earnings USING btree (date) WHERE (superseded_at IS NULL);
CREATE INDEX finviz_runs_kind_idx ON public.finviz_runs USING btree (kind, preset, status, finished_at DESC);
CREATE INDEX finviz_screener_rows_run_idx ON public.finviz_screener_rows USING btree (last_run_id, rank);
CREATE INDEX finviz_ticker_snapshot_pending_idx ON public.finviz_ticker_snapshot USING btree (requested_at) WHERE (as_of IS NULL);
CREATE INDEX gamification_season_points_rank_idx ON public.gamification_season_points USING btree (season, points DESC);
CREATE INDEX holiday_calendar_date_idx ON public.holiday_calendar USING btree (date);
CREATE UNIQUE INDEX holiday_calendar_unique ON public.holiday_calendar USING btree (date, type, name);
CREATE INDEX job_runs_job_started_idx ON public.job_runs USING btree (job, started_at DESC);
CREATE INDEX junior_notes_date_idx ON public.junior_notes USING btree (note_date DESC);
CREATE INDEX junior_notes_trader_date_idx ON public.junior_notes USING btree (trader, note_date);
CREATE INDEX market_events_date_idx ON public.market_events USING btree (date);
CREATE INDEX market_events_ticker_upper_idx ON public.market_events USING btree (upper(ticker));
CREATE UNIQUE INDEX market_themes_name_key ON public.market_themes USING btree (lower(name));
CREATE INDEX market_themes_order_idx ON public.market_themes USING btree (active, sort_order, id);
CREATE UNIQUE INDEX news_cache_ticker_guid_uniq ON public.news_cache USING btree (ticker, guid);
CREATE INDEX news_cache_ticker_idx ON public.news_cache USING btree (ticker);
CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_name, created_at DESC, id DESC);
CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_name, is_read);
CREATE INDEX plan_media_date_idx ON public.plan_media USING btree (plan_date, context);
CREATE INDEX plan_media_owner_created_idx ON public.plan_media USING btree (owner, created_at);
CREATE INDEX playbook_parent_active_idx ON public.playbook USING btree (parent_id) WHERE (deleted_at IS NULL);
CREATE INDEX playbook_setup_type_idx ON public.playbook USING btree (setup_type);
CREATE INDEX playbook_space_trader_idx ON public.playbook USING btree (space, trader) WHERE (deleted_at IS NULL);
CREATE INDEX playbook_trader_idx ON public.playbook USING btree (trader);
CREATE INDEX playbook_checklist_marks_playbook_idx ON public.playbook_checklist_marks USING btree (playbook_id);
CREATE INDEX playbook_checklist_runs_playbook_idx ON public.playbook_checklist_runs USING btree (playbook_id);
CREATE INDEX playbook_checklist_runs_trade_idx ON public.playbook_checklist_runs USING btree (trade_id);
CREATE UNIQUE INDEX playbook_examples_live_uq ON public.playbook_examples USING btree (playbook_id, trade_id) WHERE (deleted_at IS NULL);
CREATE INDEX playbook_examples_setup_idx ON public.playbook_examples USING btree (playbook_id, tier, sort_order) WHERE (deleted_at IS NULL);
CREATE INDEX playbook_examples_tier_idx ON public.playbook_examples USING btree (tier, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX playbook_examples_trade_idx ON public.playbook_examples USING btree (trade_id) WHERE (deleted_at IS NULL);
CREATE INDEX playbook_media_owner_created_idx ON public.playbook_media USING btree (owner, created_at);
CREATE INDEX playbook_media_setup_idx ON public.playbook_media USING btree (playbook_id);
CREATE INDEX playbook_reviews_playbook_idx ON public.playbook_reviews USING btree (playbook_id, created_at DESC);
CREATE INDEX playbook_revisions_playbook_idx ON public.playbook_revisions USING btree (playbook_id);
CREATE INDEX checklist_responses_ticker_idx ON public.pre_trade_checklist_responses USING btree (ticker);
CREATE INDEX checklist_responses_trade_id_idx ON public.pre_trade_checklist_responses USING btree (trade_id);
CREATE INDEX checklist_responses_trader_date_idx ON public.pre_trade_checklist_responses USING btree (trader, trade_date);
CREATE INDEX checklist_template_active_idx ON public.pre_trade_checklist_template USING btree (active);
CREATE INDEX checklist_template_sort_idx ON public.pre_trade_checklist_template USING btree (sort_order);
CREATE INDEX propreports_accounts_trader_idx ON public.propreports_accounts USING btree (trader);
CREATE INDEX propreports_adjustments_account_date_idx ON public.propreports_adjustments USING btree (account, date) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX propreports_adjustments_pr_id_key ON public.propreports_adjustments USING btree (account, propreports_id) WHERE (propreports_id IS NOT NULL);
CREATE INDEX propreports_adjustments_scope_date_idx ON public.propreports_adjustments USING btree (scope, date);
CREATE INDEX propreports_adjustments_trader_date_idx ON public.propreports_adjustments USING btree (trader, date) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX propreports_backfills_one_running ON public.propreports_backfills USING btree (status) WHERE (status = 'running'::text);
CREATE INDEX propreports_fill_identity_fp_idx ON public.propreports_fill_identity USING btree (fingerprint) WHERE (replaced_by IS NULL);
CREATE INDEX propreports_live_positions_trader_idx ON public.propreports_live_positions USING btree (trader, trading_date);
CREATE INDEX propreports_outbox_kind_open_idx ON public.propreports_outbox USING btree (kind) WHERE ((done_at IS NULL) AND (failed_at IS NULL));
CREATE INDEX propreports_outbox_open_idx ON public.propreports_outbox USING btree (id) WHERE ((done_at IS NULL) AND (failed_at IS NULL));
CREATE INDEX propreports_pending_trader_idx ON public.propreports_pending_trades USING btree (trader);
CREATE INDEX propreports_perf_trader_idx ON public.propreports_performance_reports USING btree (trader_name);
CREATE INDEX propreports_reconcile_days_open_idx ON public.propreports_reconcile_days USING btree (date DESC) WHERE ((status <> 'ok'::text) AND (acknowledged_at IS NULL));
CREATE INDEX propreports_reconcile_days_trader_idx ON public.propreports_reconcile_days USING btree (trader, date);
CREATE INDEX propreports_sync_runs_started_idx ON public.propreports_sync_runs USING btree (started_at DESC);
CREATE INDEX quest_instances_assigner_idx ON public.quest_instances USING btree (assigned_by, updated_at) WHERE (scope = 'curator'::text);
CREATE UNIQUE INDEX quest_instances_catalog_uq ON public.quest_instances USING btree (trader, scope, template, period) WHERE (scope <> 'curator'::text);
CREATE INDEX quest_instances_trader_idx ON public.quest_instances USING btree (trader, status);
CREATE INDEX recognition_events_day_idx ON public.recognition_events USING btree (day);
CREATE INDEX research_ticker_upper_idx ON public.research USING btree (upper(ticker));
CREATE INDEX reward_grants_status_idx ON public.reward_grants USING btree (status, updated_at);
CREATE INDEX reward_grants_trader_idx ON public.reward_grants USING btree (trader);
CREATE INDEX risk_breach_reviews_trader_idx ON public.risk_breach_reviews USING btree (trader, date DESC);
CREATE INDEX rule_self_checks_trader_day_idx ON public.rule_self_checks USING btree (trader, day);
CREATE INDEX rule_violations_active_trader_idx ON public.rule_violations USING btree (trader) WHERE (archived_at IS NULL);
CREATE INDEX rule_violations_occurred_idx ON public.rule_violations USING btree (occurred_at);
CREATE INDEX rule_violations_rule_idx ON public.rule_violations USING btree (rule_id);
CREATE UNIQUE INDEX rule_violations_rule_key_uidx ON public.rule_violations USING btree (rule_id, dedup_key);
CREATE INDEX rule_violations_trade_idx ON public.rule_violations USING btree (trade_id);
CREATE INDEX rule_violations_trader_idx ON public.rule_violations USING btree (trader);
CREATE INDEX scaling_history_trader_idx ON public.scaling_history USING btree (trader, created_at DESC);
CREATE UNIQUE INDEX scaling_proposals_pending_uniq ON public.scaling_proposals USING btree (trader) WHERE (status = 'pending'::text);
CREATE INDEX scaling_proposals_trader_idx ON public.scaling_proposals USING btree (trader, created_at DESC);
CREATE INDEX sim_games_daily_date_idx ON public.sim_games USING btree (((params #>> '{daily,date}'::text[]))) WHERE (params ? 'daily'::text);
CREATE UNIQUE INDEX sim_games_daily_uq ON public.sim_games USING btree (user_id, ((params #>> '{daily,date}'::text[]))) WHERE (params ? 'daily'::text);
CREATE INDEX sim_games_finished_idx ON public.sim_games USING btree (finished_at) WHERE (status = 'finished'::text);
CREATE UNIQUE INDEX sim_games_one_active_idx ON public.sim_games USING btree (user_id) WHERE (status = 'active'::text);
CREATE INDEX sim_games_series_idx ON public.sim_games USING btree (series_id, id) WHERE (series_id IS NOT NULL);
CREATE INDEX sim_games_user_idx ON public.sim_games USING btree (user_id, id DESC);
CREATE INDEX sim_series_user_idx ON public.sim_series USING btree (user_id, id DESC);
CREATE INDEX trade_executions_trade_idx ON public.trade_executions USING btree (trade_id);
CREATE INDEX trade_idea_comments_idea_idx ON public.trade_idea_comments USING btree (idea_id);
CREATE INDEX trade_idea_reactions_idea_idx ON public.trade_idea_reactions USING btree (trade_idea_id);
CREATE INDEX trade_idea_reactions_trader_idx ON public.trade_idea_reactions USING btree (trader);
CREATE INDEX trade_ideas_created_at_idx ON public.trade_ideas USING btree (created_at);
CREATE INDEX trade_ideas_status_idx ON public.trade_ideas USING btree (status);
CREATE INDEX trade_ideas_ticker_idx ON public.trade_ideas USING btree (ticker);
CREATE INDEX trade_ideas_trader_idx ON public.trade_ideas USING btree (trader);
CREATE INDEX trade_setup_suggestions_trade_idx ON public.trade_setup_suggestions USING btree (trade_id);
CREATE INDEX trader_achievements_earned_idx ON public.trader_achievements USING btree (trader, earned_on);
CREATE INDEX trader_badges_awarded_idx ON public.trader_badges USING btree (awarded_on);
CREATE INDEX trader_plans_date_idx ON public.trader_plans USING btree (date);
CREATE INDEX trader_progress_snapshots_latest_idx ON public.trader_progress_snapshots USING btree (trader, as_of DESC);
CREATE INDEX trader_risk_limit_events_trader_idx ON public.trader_risk_limit_events USING btree (trader, changed_at DESC);
CREATE INDEX trades_broker_account_idx ON public.trades USING btree (broker_account) WHERE (broker_account IS NOT NULL);
CREATE INDEX trades_chain_idx ON public.trades USING btree (trader, ticker, date);
CREATE INDEX trades_horizon_idx ON public.trades USING btree (horizon);
CREATE INDEX trades_live_close_day_idx ON public.trades USING btree ("left"(COALESCE(NULLIF(exit_date, ''::text), date), 10)) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_date_id_idx ON public.trades USING btree (date DESC, id DESC) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_open_idx ON public.trades USING btree (date, id) WHERE ((deleted_at IS NULL) AND ((lower(TRIM(BOTH FROM result)) = 'open'::text) OR (((result IS NULL) OR (TRIM(BOTH FROM result) = ''::text)) AND (NULLIF(exit_date, ''::text) IS NULL) AND (exit IS NULL))));
CREATE INDEX trades_live_source_idx ON public.trades USING btree (source) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_strategy_idx ON public.trades USING btree (strategy) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_ticker_date_idx ON public.trades USING btree (ticker, date DESC) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_trader_close_day_idx ON public.trades USING btree (trader, "left"(COALESCE(NULLIF(exit_date, ''::text), date), 10)) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_trader_date_id_idx ON public.trades USING btree (trader, date DESC, id DESC) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_trader_upper_ticker_idx ON public.trades USING btree (trader, upper(ticker)) WHERE (deleted_at IS NULL);
CREATE INDEX trades_live_upper_ticker_date_idx ON public.trades USING btree (upper(ticker), date DESC, id DESC) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX trades_source_external_id_uidx ON public.trades USING btree (source, external_id) WHERE (external_id IS NOT NULL);
CREATE INDEX trades_strategy_sig_idx ON public.trades USING btree (strategy_sig);
CREATE INDEX trades_trader_day_idx ON public.trades USING btree (COALESCE(trader, ''::text), "left"(date, 10));
CREATE INDEX trading_errors_trade_code_idx ON public.trading_errors USING btree (trade_id, code);
CREATE INDEX trading_errors_archive_trader_idx ON public.trading_errors_archive USING btree (trader);
CREATE UNIQUE INDEX trading_rules_template_key_uidx ON public.trading_rules USING btree (template_key) WHERE (template_key IS NOT NULL);
CREATE INDEX trading_rules_trader_idx ON public.trading_rules USING btree (trader);
CREATE INDEX trainer_daily_challenges_key_idx ON public.trainer_daily_challenges USING btree (ticker, bars_day);
CREATE UNIQUE INDEX trainer_drill_attempts_first_uq ON public.trainer_drill_attempts USING btree (user_id, drill_id) WHERE first;
CREATE INDEX trainer_drill_attempts_trader_idx ON public.trainer_drill_attempts USING btree (trader, setup_id) WHERE first;
CREATE INDEX trainer_drill_attempts_user_idx ON public.trainer_drill_attempts USING btree (user_id, created_at DESC);
CREATE INDEX trainer_drills_setup_idx ON public.trainer_drills USING btree (setup_id) WHERE (NOT disabled);
CREATE UNIQUE INDEX trainer_drills_trade_uq ON public.trainer_drills USING btree (trade_id);
CREATE INDEX usage_events_at_idx ON public.usage_events USING btree (at);
CREATE INDEX usage_events_day_idx ON public.usage_events USING btree (ny_day, user_id);
CREATE INDEX usage_events_user_day_idx ON public.usage_events USING btree (user_id, ny_day);
CREATE INDEX user_boards_user_idx ON public.user_boards USING btree (user_id, active, "position", id);
CREATE INDEX user_themes_board_idx ON public.user_themes USING btree (board_id) WHERE (board_id IS NOT NULL);
CREATE INDEX user_themes_user_idx ON public.user_themes USING btree (user_id, active, id);
CREATE INDEX users_group_idx ON public.users USING btree (group_id) WHERE (group_id IS NOT NULL);
CREATE UNIQUE INDEX users_telegram_chat_id_idx ON public.users USING btree (telegram_chat_id) WHERE (telegram_chat_id IS NOT NULL);
CREATE INDEX voice_notes_daily_feed_id_idx ON public.voice_notes USING btree (daily_feed_id);
CREATE INDEX voice_notes_trade_id_idx ON public.voice_notes USING btree (trade_id);
CREATE INDEX voice_notes_user_id_idx ON public.voice_notes USING btree (user_id);
CREATE INDEX watchlist_owner_idx ON public.watchlist USING btree (owner, deleted_at);
CREATE INDEX watchlist_score_idx ON public.watchlist USING btree (score);
CREATE INDEX weekly_psych_reports_user_idx ON public.weekly_psychology_reports USING btree (user_id);
CREATE INDEX weekly_psych_reports_user_week_idx ON public.weekly_psychology_reports USING btree (user_id, week_start);
CREATE INDEX weekly_psych_reports_week_start_idx ON public.weekly_psychology_reports USING btree (week_start);
CREATE INDEX weekly_reviews_week_idx ON public.weekly_reviews USING btree (week);
CREATE INDEX whatif_honesty_cache_queue_idx ON public.whatif_honesty_cache USING btree (requested_at, id) WHERE (state = 'queued'::text);
CREATE INDEX whatif_honesty_cache_recent_idx ON public.whatif_honesty_cache USING btree (trader, period_from, period_to, used_at DESC);
CREATE INDEX whatif_scenarios_trader_idx ON public.whatif_scenarios USING btree (trader);

ALTER TABLE public.academy_assignments ADD CONSTRAINT academy_assignments_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.academy_modules(id);
ALTER TABLE public.academy_attendance ADD CONSTRAINT academy_attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.academy_sessions(id);
ALTER TABLE public.academy_enrollments ADD CONSTRAINT academy_enrollments_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.academy_cohorts(id);
ALTER TABLE public.academy_lesson_progress ADD CONSTRAINT academy_lesson_progress_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.academy_lessons(id);
ALTER TABLE public.academy_lessons ADD CONSTRAINT academy_lessons_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.academy_modules(id);
ALTER TABLE public.academy_modules ADD CONSTRAINT academy_modules_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.academy_programs(id);
ALTER TABLE public.academy_quiz_attempts ADD CONSTRAINT academy_quiz_attempts_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.academy_quizzes(id);
ALTER TABLE public.academy_quizzes ADD CONSTRAINT academy_quizzes_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.academy_modules(id);
ALTER TABLE public.academy_sessions ADD CONSTRAINT academy_sessions_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.academy_cohorts(id);
ALTER TABLE public.academy_submissions ADD CONSTRAINT academy_submissions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.academy_assignments(id);
ALTER TABLE public.app_error_occurrences ADD CONSTRAINT app_error_occurrences_error_id_fkey FOREIGN KEY (error_id) REFERENCES public.app_errors(id) ON DELETE CASCADE;
ALTER TABLE public.author_note_reads ADD CONSTRAINT author_note_reads_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.author_notes(id) ON DELETE CASCADE;
ALTER TABLE public.chart_drawings ADD CONSTRAINT chart_drawings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.curator_requests ADD CONSTRAINT curator_requests_resolved_by_id_fkey FOREIGN KEY (resolved_by_id) REFERENCES public.users(id);
ALTER TABLE public.curator_requests ADD CONSTRAINT curator_requests_trader_id_fkey FOREIGN KEY (trader_id) REFERENCES public.users(id);
ALTER TABLE public.desk_groups ADD CONSTRAINT desk_groups_curator_id_fkey FOREIGN KEY (curator_id) REFERENCES public.users(id);
ALTER TABLE public.discussion_reads ADD CONSTRAINT discussion_reads_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.discussions(id) ON DELETE CASCADE;
ALTER TABLE public.discussion_votes ADD CONSTRAINT discussion_votes_discussion_id_fkey FOREIGN KEY (discussion_id) REFERENCES public.discussions(id) ON DELETE CASCADE;
ALTER TABLE public.feed_acks ADD CONSTRAINT feed_acks_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.daily_feed(id) ON DELETE CASCADE;
ALTER TABLE public.finviz_screener_rows ADD CONSTRAINT finviz_screener_rows_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.finviz_runs(id);
ALTER TABLE public.game_plan_reads ADD CONSTRAINT game_plan_reads_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.game_plans(id) ON DELETE CASCADE;
ALTER TABLE public.research_pins ADD CONSTRAINT research_pins_research_id_fkey FOREIGN KEY (research_id) REFERENCES public.research(id) ON DELETE CASCADE;
ALTER TABLE public.reward_grants ADD CONSTRAINT reward_grants_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.reward_items(id);
ALTER TABLE public.rule_self_checks ADD CONSTRAINT rule_self_checks_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.trading_rules(id) ON DELETE CASCADE;
ALTER TABLE public.rule_violations ADD CONSTRAINT rule_violations_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.trading_rules(id) ON DELETE CASCADE;
ALTER TABLE public.sim_games ADD CONSTRAINT sim_games_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.sim_series(id) ON DELETE SET NULL;
ALTER TABLE public.sim_games ADD CONSTRAINT sim_games_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.sim_prefs ADD CONSTRAINT sim_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.sim_series ADD CONSTRAINT sim_series_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.trade_executions ADD CONSTRAINT trade_executions_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE CASCADE;
ALTER TABLE public.trainer_drill_attempts ADD CONSTRAINT trainer_drill_attempts_drill_id_fkey FOREIGN KEY (drill_id) REFERENCES public.trainer_drills(id) ON DELETE CASCADE;
ALTER TABLE public.trainer_drill_attempts ADD CONSTRAINT trainer_drill_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.usage_events ADD CONSTRAINT usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.users ADD CONSTRAINT users_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.desk_groups(id);
ALTER TABLE public.war_room_levels ADD CONSTRAINT war_room_levels_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.war_room_sessions(id) ON DELETE CASCADE;

CREATE TRIGGER trade_executions_strategy_del_trg AFTER DELETE ON public.trade_executions REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trade_executions_strategy_stale();
CREATE TRIGGER trade_executions_strategy_ins_trg AFTER INSERT ON public.trade_executions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trade_executions_strategy_stale();
CREATE TRIGGER trade_executions_strategy_upd_trg AFTER UPDATE ON public.trade_executions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trade_executions_strategy_stale();
CREATE TRIGGER trades_day_deleted_trg AFTER DELETE ON public.trades REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trades_day_deleted_stale();
CREATE TRIGGER trades_day_left_trg AFTER UPDATE OF trader, date ON public.trades FOR EACH ROW WHEN (old.trader IS DISTINCT FROM new.trader OR "left"(old.date, 10) IS DISTINCT FROM "left"(new.date, 10)) EXECUTE FUNCTION public.trades_day_left_stale();
CREATE TRIGGER trades_strategy_stale_trg BEFORE UPDATE OF ticker, date, exit_date, horizon, session, qty, entry, context_snapshot, trader, pnl, fees, result, hold_time, structure, reentry_of, deleted_at, stop ON public.trades FOR EACH ROW EXECUTE FUNCTION public.trades_strategy_stale();
CREATE TRIGGER trades_ticker_day_deleted_trg AFTER DELETE ON public.trades REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trades_ticker_day_deleted_stale();
CREATE TRIGGER trades_ticker_day_left_trg AFTER UPDATE OF ticker, date ON public.trades FOR EACH ROW WHEN (old.ticker IS NOT NULL AND (old.entry_sec IS NULL OR old.entry_sec < 34200) AND (upper(old.ticker) IS DISTINCT FROM upper(new.ticker) OR "left"(old.date, 10) IS DISTINCT FROM "left"(new.date, 10))) EXECUTE FUNCTION public.trades_ticker_day_left_stale();
