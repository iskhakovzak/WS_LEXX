/**
 * Where a person's name lives, for the cascading rename (./renameUser.ts). users.name is a plain-text key in ~150
 * columns (trades.trader, academy_*.user_name, notifications.user_name …); renaming only users.name orphans them.
 *
 * Every column of the schema that can hold a desk person's name is classified here, on purpose, in one of two lists:
 *
 *   RENAMED  — moved to the new name in the same transaction as users.name:
 *     text      plain column equal to the old name (identity keys, owners, «who did it» attributions)
 *     json      json / jsonb: every string value (any depth) and object key EXACTLY equal to the old name
 *     array     text[]: elements equal to the old name (none today; supported for the guard test)
 *     segments  ':'-joined keys whose segment equals the old name («risk:risk_breach:<name>:2026-10-19»)
 *     link      in-app links whose query parameter equals the old name («/risk?trader=<name>»)
 *     nameList  a desk setting holding a comma / ';' / newline list of names (usage.pilotUsers)
 *
 *   KEPT     — left as written, with the reason. Immutable history (audit_log), operational logs, market data,
 *              non-person «name» columns (a setup, a group, a tier), tokens (discussion audience = stages / cohorts).
 *
 * Free prose (comments, notes, rendered notification messages, «@name» mentions inside text, activity_log.details,
 * audit_log.details) is never rewritten: it is what someone wrote or what was shown at the time. Mentions are matched
 * against users.name when a text is saved, so new mentions use the new name.
 *
 * The guard test (lib/__tests__/people/renameUserColumns.test.ts + the scratch-DB test) fails when the schema grows a
 * column that looks like a person name (PERSON_COLUMN_RE), a json / jsonb column or a text[] column that is in
 * neither list — decide and add it here.
 */

export type RenameKind = "text" | "json" | "array" | "segments" | "link" | "nameList";
export type RenameTarget = { table: string; column: string; kind: RenameKind; settingKey?: string };

/** Plain text columns holding a person's name. users.name itself is updated by id (renameUser), not listed here. */
const TEXT: Record<string, readonly string[]> = {
  academy_action_items: ["created_by", "owner", "student"],
  academy_assignments: ["created_by"],
  academy_attendance: ["marked_by", "user_name"],
  academy_challenges: ["archived_by", "created_by", "user_name"],
  academy_cohorts: ["created_by", "mentor"],
  academy_enrollment_history: ["changed_by", "user_name"],
  academy_enrollments: ["created_by", "user_name"],
  academy_idp_goals: ["created_by", "student"],
  academy_lesson_progress: ["user_name"],
  academy_lessons: ["created_by"],
  academy_one_on_ones: ["created_by", "mentor", "student"],
  academy_programs: ["created_by"],
  academy_promotion_requests: ["decided_by", "requested_by", "user_name"],
  academy_quiz_attempts: ["user_name"],
  academy_quizzes: ["created_by"],
  academy_readiness_notices: ["user_name"],
  academy_sessions: ["created_by", "host"],
  academy_stage_criteria: ["updated_by"],
  academy_stage_history: ["actor", "user_name"],
  academy_stages: ["updated_by"],
  academy_submissions: ["graded_by", "user_name"],
  academy_trader_stage: ["updated_by", "user_name"],
  achievement_kudos: ["author", "trader"],
  activity_log: ["trader"],
  ai_assistant_audit: ["user_name"],
  ai_assistant_messages: ["user_name"],
  ai_assistant_usage: ["user_name"],
  ai_review_rate_limit: ["user_key"],
  ai_reviews: ["created_by", "trader"],
  ai_batch_items: ["trader"],
  app_errors: ["resolved_by"],
  app_settings: ["updated_by"],
  author_note_reads: ["reader"],
  author_notes: ["trader"],
  author_weekly_summaries: ["trader"],
  behavior_triggers: ["created_by", "trader"],
  big7_catalysts: ["created_by"],
  big7_levels: ["created_by"],
  big7_tickers: ["created_by"],
  catalyst_marks: ["trader"],
  comments: ["trader"],
  content_reports: ["reporter", "resolved_by"],
  corp_event_type_setups: ["updated_by"],
  corp_events: ["created_by"],
  curator_interventions: ["author", "trader"],
  curator_notes: ["archived_by", "author", "trader"],
  curator_queue_acks: ["acked_by", "trader"],
  daily_feed: ["created_by"],
  daily_focus: ["set_by", "trader"],
  daily_reviews: ["trader"],
  desk_regime_days: ["set_by"],
  digest_subscriptions: ["trader"],
  discussion_reads: ["user_name"],
  discussion_votes: ["trader"],
  discussions: ["trader"],
  emotional_state_log: ["user_id"],
  emotional_state_log_dupes_0274: ["user_id"],
  eod_days: ["reviewed_by", "trader"],
  edge_map: ["trader"],
  eod_trade_reviews: ["trader"],
  feed_acks: ["user_name"],
  feed_visits: ["user_name"],
  game_plan_reads: ["trader"],
  game_plans: ["author", "updated_by"],
  gamification_profiles: ["trader"],
  gamification_season_points: ["trader"],
  indicator_notes: ["user_name"],
  journal_days: ["trader"],
  junior_note_reminders: ["curator", "trader"],
  junior_notes: ["reviewed_by", "trader"],
  leak_guard_events: ["released_by", "trader"],
  leak_guard_levels: ["set_by", "trader"],
  market_events: ["created_by"],
  market_themes: ["updated_by"],
  mentor_commitments: ["created_by", "trader"],
  mentor_digests: ["trader"],
  mentor_escalations: ["ack_by", "trader"],
  mentor_messages: ["trader"],
  mentor_notes: ["author", "trader"],
  mentor_profile: ["trader"],
  notification_batch_items: ["user_name"],
  notification_prefs: ["user_name"],
  notifications: ["actor", "user_name"],
  telegram_push_log: ["user_name"],
  office_capital: ["updated_by"],
  plan_media: ["owner"],
  plan_templates: ["author"],
  playbook: ["copied_from_author", "created_by", "office_proposed_by", "reviewed_by", "shared_by", "trader"],
  playbook_cases: ["added_by"],
  playbook_checklist_marks: ["trader"],
  playbook_checklist_runs: ["trader"],
  playbook_examples: ["added_by"],
  playbook_inbox_dismissed: ["dismissed_by"],
  playbook_media: ["owner"],
  playbook_reviews: ["reviewer"],
  playbook_revisions: ["trader"],
  pre_trade_checklist_responses: ["trader"],
  propreports_accounts: ["trader"],
  propreports_adjustments: ["trader"],
  propreports_backfills: ["actor"],
  propreports_live_positions: ["trader"],
  propreports_pending_trades: ["trader"],
  propreports_performance_reports: ["trader_name", "uploaded_by"],
  propreports_reconcile_days: ["acknowledged_by", "trader"],
  propreports_sync_runs: ["actor"],
  quest_events: ["trader"],
  quest_instances: ["assigned_by", "cancelled_by", "trader"],
  recognition_events: ["trader"],
  regime_reflections: ["trader"],
  research: ["created_by"],
  research_pins: ["user_name"],
  reward_grants: ["decided_by", "trader"],
  reward_items: ["created_by", "updated_by"],
  risk_alert_log: ["trader"],
  risk_breach_reviews: ["archived_by", "created_by", "trader", "updated_by"],
  risk_live_alerts: ["trader"],
  role_permissions: ["updated_by"],
  rule_self_checks: ["trader", "updated_by"],
  rule_violations: ["acknowledged_by", "resolved_by", "trader"],
  scaling_history: ["actor", "trader"],
  scaling_proposals: ["created_by", "decided_by", "trader"],
  scaling_rules: ["updated_by"],
  scaling_tiers: ["updated_by"],
  setup_mastery: ["trader"],
  telegram_link_tokens: ["user_name"],
  trade_idea_comments: ["author_name"],
  trade_idea_reactions: ["trader"],
  trade_ideas: ["reviewed_by", "trader"],
  trade_reactions: ["trader"],
  trade_reviews: ["curator"],
  trade_setup_suggestions: ["decided_by"],
  trader_achievements: ["trader"],
  trader_badges: ["trader"],
  trader_plans: ["trader"],
  trader_progress_snapshots: ["trader"],
  trader_ratings: ["curator", "trader"],
  trader_risk_limit_events: ["changed_by", "trader"],
  trader_risk_limits: ["trader", "updated_by"],
  trades: ["trader"],
  trading_errors: ["trader"],
  trading_errors_archive: ["archived_by", "trader"],
  trading_rules: ["created_by", "trader"],
  trainer_drill_attempts: ["trader"],
  trainer_drills: ["trader"],
  usage_events: ["trader"],
  users: ["assigned_curator", "assigned_mentor", "assigned_risk_manager"],
  voice_notes: ["user_id"],
  war_room_sessions: ["trader"],
  watchlist: ["created_by"],
  weekly_psychology_reports: ["user_id"],
  weekly_reviews: ["trader"],
  whatif_honesty_cache: ["trader"],
  whatif_scenarios: ["created_by", "trader"],
};

/** json / jsonb columns of desk data that carry names as values ({trader}, {student}, {users: [...]}, rankings …). */
const JSON_COLS: Record<string, readonly string[]> = {
  academy_challenges: ["summary"],
  academy_promotion_requests: ["report"],
  academy_stage_history: ["report"],
  activity_log: ["params"],
  ai_assistant_messages: ["drafts"], // draft cards (a curator-note draft names its trader)
  behavior_triggers: ["params"],
  daily_reviews: ["verdict"],
  eod_days: ["summary"],
  gamification_seasons: ["ranking"],
  junior_notes: ["sections"],
  notification_batch_items: ["params"],
  notifications: ["params"],
  plan_templates: ["doc"],
  playbook: ["shared_with"],
  playbook_revisions: ["snapshot"],
  propreports_outbox: ["payload"],
  propreports_pending_trades: ["payload"],
  propreports_reconcile_days: ["details"],
  propreports_sync_runs: ["details"],
  quest_instances: ["params"],
  recognition_events: ["params"],
  risk_breach_reviews: ["actions"],
  rule_violations: ["details"],
  scaling_history: ["limits"],
  scaling_proposals: ["reasons", "snapshot"],
  trade_archive_batches: ["reassigned"],
  trader_plans: ["doc"],
  trader_ratings: ["evidence"],
  trader_risk_limit_events: ["after", "before"],
  trading_errors_archive: ["payload"],
  users: ["settings"],
  weekly_reviews: ["curator_review", "goals", "self_review"],
};

/** text[] columns holding names (discussions.audience holds stage / cohort tokens, not names). */
const ARRAY_COLS: Record<string, readonly string[]> = {
  mentor_escalations: ["notified"], // the staff who got the escalation notice
};

const SPECIAL: readonly RenameTarget[] = [
  { table: "notifications", column: "entity_id", kind: "segments" }, // «<name>:<day>», «<name>:<day>:repeat», «<name>»
  { table: "notification_dedup", column: "key", kind: "segments" }, // «risk:risk_breach:<name>:<day>» — today's dedup keeps working
  { table: "notifications", column: "link", kind: "link" }, // «/risk?trader=<name>», «/academy/mentor?student=<name>»
  { table: "curator_requests", column: "link", kind: "link" },
  { table: "app_settings", column: "value", kind: "nameList", settingKey: "usage.pilotUsers" },
];

function expand(map: Record<string, readonly string[]>, kind: RenameKind): RenameTarget[] {
  return Object.entries(map).flatMap(([table, cols]) => cols.map((column) => ({ table, column, kind })));
}

/** Every renamed (table, column), in a stable order: text first, then json, arrays, special keys. */
export const RENAME_TARGETS: readonly RenameTarget[] = [
  ...expand(TEXT, "text"),
  ...expand(JSON_COLS, "json"),
  ...expand(ARRAY_COLS, "array"),
  ...SPECIAL,
];

/** Columns that look like they hold a name (or are json / arrays) but are left alone on purpose — with the reason. */
export const KEPT: Readonly<Record<string, string>> = {
  "users.name": "the identity itself: updated by id in renameUser",
  "audit_log.actor": "immutable security history; the rename is audited (user.rename {from, to}) so old entries stay traceable",
  "daily_quotes.psychology_author": "author of a published quote, not a desk person",
  "daily_quotes.trading_author": "author of a published quote, not a desk person",
  "job_runs.host": "machine host name",
  "propreports_tick_lease.holder": "process lease holder id",
  "propreports_fill_identity.replaced_by": "broker fill id",
  // non-person «name» columns
  ...Object.fromEntries([
    "academy_challenges", "academy_cohorts", "academy_stages", "behavior_triggers", "big7_tickers", "cache_versions",
    "desk_groups", "holiday_calendar", "market_themes", "plan_templates", "playbook", "propreports_tick_lease",
    "propreports_tick_steps", "scaling_tiers", "schema_migrations", "sector_strength_cache", "trading_rules",
    "user_boards", "user_themes", "whatif_scenarios",
  ].map((t) => [`${t}.name`, "name of a thing (setup, group, tier, cache …), not a person"])),
  // json: operational logs / snapshots of what happened
  "app_error_occurrences.context": "error log",
  "job_runs.details": "job run log",
  "trader_achievements.detail": "what a per-setup / per-leak / path-step achievement is about (setup name, slice key, metric) — not a person",
  "trader_progress_snapshots.diagnosis": "plateau diagnosis pack: slice codes, $ per day, fee share — no names",
  "curator_interventions.params": "intervention parameters: codes and numbers (rule kind, tier, mistake), no names",
  "usage_events.meta": "no names by design (lib/usage/keys.ts)",
  "app_settings.value": "typed settings; the one name list (usage.pilotUsers) is renamed as nameList",
  "ai_assistant_audit.models": "assistant model ids (claude-…)",
  "ai_assistant_audit.tools": "assistant tool names",
  "ai_assistant_messages.tools": "assistant tool names",
  "ai_reviews.review": "model-written review (validated JSON: verdict, points, evidence labels), no structured person fields",
  "ai_reviews.facts": "the day's numbers (counts and $), no names",
  "ai_batch_items.facts": "the day's numbers (counts and $), no names",
  "ai_batches.kinds": "review kinds (day / week / month)",
  "desk_regime_days.suggestion": "the engine's suggestion: a regime key, reason codes and numbers, no names",
  "leak_guard_events.stats": "the trader's pattern numbers (counts, $, t), no names",
  "leak_guard_events.at_risk_trade_ids": "trade ids, not names",
  "regime_reflections.answers": "the trader's own free text per regime and question (free prose is never rewritten)",
  "playbook.regimes": "market regime keys (theme_bull, macro, …), not names",
  "playbook.formula": "strategy formula of a setup: catalyst kind / strength / direction codes and the author's setup / trade lines, no names",
  "scaling_proposals.limits": "capital allocation payload (lib/capital): week, direction, step and $ limits before / after, no names",
  "mentor_commitments.params": "commitment parameters: minutes, counts, dollars, HH:MM — no names",
  "mentor_digests.content": "model-written mentor brief / debrief / weekly (validated JSON), no structured person fields",
  "mentor_escalations.params": "escalation numbers (days, counts, $, %) — no names",
  "mentor_profile.hidden_facts": "keys of data facts the trader hid from the mentor (stage, leak:<slice> …), not names",
  "ai_batches.created_by": "who started the batch: «system» (the nightly job) or «manual» (the admin's run), never a person name",
  // json: market data, caches, content without people
  ...Object.fromEntries([
    "academy_assignments.rubric", "academy_lessons.attachments", "academy_quiz_attempts.answers", "academy_quiz_attempts.results",
    "academy_quizzes.questions", "academy_submissions.scores", "academy_challenges.rules", "ai_trade_reviews.sections",
    "analyst_bars_cache.bars", "candles_cache.ohlcv", "chart_drawings.drawings", "game_plans.in_play", "game_plans.key_levels",
    "game_plans.macro", "game_plans.media", "game_plans.tv_links", "journal_days.tags", "market_open_brief_cache.data",
    "offering_ticker_cache.payload", "playbook.checklist_items", "playbook.media", "playbook.screenshots",
    "playbook_checklist_runs.checked_items", "playbook_examples.checklist_marks", "propreports_cursors.value",
    "propreports_live_positions.positions", "propreports_performance_reports.data", "propreports_settings.value",
    "sim_games.bars", "sim_games.events", "sim_games.params", "sim_games.result", "ticker_data_cache.raw",
    "trade_quality.payload", "trade_setup_suggestions.explanation", "trade_setup_suggestions.features",
    "trades.context_snapshot", "trades.structure", "trading_rules.threshold",
    "trainer_daily_challenges.features", "user_boards.sort", "war_room_sessions.checklist",
    "weekly_psychology_reports.emotional_breakdown", "weekly_psychology_reports.key_insights",
    "weekly_psychology_reports.raw_stats", "whatif_honesty_cache.result", "whatif_scenarios.rules",
  ].map((k) => [k, "market data, cache or content without desk people"])),
  // text[]: tokens, tickers, filters
  ...Object.fromEntries([
    "academy_lessons.setup_names", "eod_trade_reviews.mistakes", "market_themes.tickers", "propreports_accounts.aliases",
    "propreports_adjustments.replaced_ids", "user_boards.columns", "user_boards.filters", "user_boards.resolved_tickers",
    "user_boards.tickers", "user_themes.filters", "user_themes.resolved_tickers", "user_themes.tickers",
  ].map((k) => [k, "tickers, filters, setup names or broker account aliases"])),
  "discussions.audience": "stage / cohort tokens (lib/discussionAudience.ts), not names",
};

/**
 * Text columns that look like a person: trader, user_name, student, …, any «*_by» / «*_author», «name».
 * Every match must be renamed or kept on purpose.
 */
export const PERSON_COLUMN_RE =
  /^(trader|trader_name|user_name|user_id|user_key|student|reader|owner|mentor|curator|author|author_name|actor|reporter|reviewer|holder|host|name|assigned_[a-z_]+|[a-z_]+_by|[a-z_]+_author)$/;

export type SchemaColumn = { table: string; column: string; type: "text" | "json" | "array" | "other" };

/** Columns of the schema that need a decision and have none. Empty = every candidate is classified. */
export function unclassifiedColumns(schema: readonly SchemaColumn[]): string[] {
  const renamed = new Set(RENAME_TARGETS.map((t) => `${t.table}.${t.column}`));
  return schema
    .filter((c) => c.type === "json" || c.type === "array" || (c.type === "text" && PERSON_COLUMN_RE.test(c.column)))
    .map((c) => `${c.table}.${c.column}`)
    .filter((k) => !renamed.has(k) && !Object.prototype.hasOwnProperty.call(KEPT, k))
    .sort();
}

/** Listed columns the schema doesn't have (a table or column was dropped / renamed: update the lists). */
export function staleEntries(schema: readonly SchemaColumn[]): string[] {
  const have = new Set(schema.map((c) => `${c.table}.${c.column}`));
  return [...RENAME_TARGETS.map((t) => `${t.table}.${t.column}`), ...Object.keys(KEPT)].filter((k) => !have.has(k)).sort();
}
