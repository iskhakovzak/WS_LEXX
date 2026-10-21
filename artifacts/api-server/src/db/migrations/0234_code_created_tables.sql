-- Волна 2 п. 2.2 (audit 2026-10-20 platform.md «39 таблиц живут вне миграций»). Every table, column and index that the
-- code used to create at startup or on the first request (lib/migrate.ts runMigrations, ensure*() in lib/* and routes/*)
-- now lives here; the code no longer runs DDL. The statements are the code's own DDL, copied verbatim and grouped by the
-- module that owned them. Only the objects missing from a schema built by 0001–0233 are listed: the rest of the old
-- boot DDL (≈300 statements, incl. the 37 ALTER TABLE on users / trades / playbook) was already in 0001_baseline or a
-- later migration. Idempotent (IF NOT EXISTS everywhere): on production every object below already exists and this
-- file changes nothing; on a fresh database it creates 40 tables, 8 columns (trade_ideas, junior_notes) and their indexes. No rows are touched.

-- lib/academyPathStore.ts
CREATE TABLE IF NOT EXISTS academy_stages (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  scaling_tier TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS academy_stage_criteria (
  id SERIAL PRIMARY KEY,
  from_stage TEXT NOT NULL,
  metric TEXT NOT NULL,
  op TEXT NOT NULL,
  value NUMERIC(14,4) NOT NULL,
  window_days INTEGER,
  label TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_stage_criteria_stage_idx ON academy_stage_criteria(from_stage) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS academy_trader_stage (
  user_name TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  since TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS academy_stage_history (
  id SERIAL PRIMARY KEY,
  user_name TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  action TEXT NOT NULL,
  request_id INTEGER,
  actor TEXT NOT NULL,
  comment TEXT,
  report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS academy_stage_history_user_idx ON academy_stage_history(user_name, created_at DESC);
CREATE TABLE IF NOT EXISTS academy_promotion_requests (
  id SERIAL PRIMARY KEY,
  user_name TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  passed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  report JSONB,
  comment TEXT,
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_comment TEXT,
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS academy_promotion_requests_pending_uniq ON academy_promotion_requests(user_name) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS academy_promotion_requests_user_idx ON academy_promotion_requests(user_name, created_at DESC);
CREATE TABLE IF NOT EXISTS academy_readiness_notices (
  user_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_name, stage)
);
CREATE TABLE IF NOT EXISTS academy_challenges (
  id SERIAL PRIMARY KEY,
  user_name TEXT NOT NULL,
  template_key TEXT,
  name TEXT NOT NULL,
  rules JSONB NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  summary JSONB,
  notified_status TEXT,
  comment TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archived_by TEXT
);
CREATE INDEX IF NOT EXISTS academy_challenges_user_idx ON academy_challenges(user_name, starts_on DESC) WHERE archived_at IS NULL;

-- lib/curatorStore.ts
CREATE TABLE IF NOT EXISTS curator_notes (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archived_by TEXT
);
CREATE INDEX IF NOT EXISTS curator_notes_trader_idx ON curator_notes (trader, created_at DESC) WHERE archived_at IS NULL;
ALTER TABLE curator_notes ADD COLUMN IF NOT EXISTS day TEXT;
CREATE TABLE IF NOT EXISTS risk_breach_reviews (
  id SERIAL PRIMARY KEY,
  alert_id INTEGER NOT NULL UNIQUE,
  trader TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  comment TEXT,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  consequence TEXT NOT NULL DEFAULT 'none',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archived_by TEXT
);
CREATE INDEX IF NOT EXISTS risk_breach_reviews_trader_idx ON risk_breach_reviews (trader, date DESC);
CREATE TABLE IF NOT EXISTS curator_queue_acks (
  item_id TEXT PRIMARY KEY,
  trader TEXT NOT NULL,
  kind TEXT NOT NULL,
  acked_by TEXT NOT NULL,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- lib/feedStream.ts
CREATE TABLE IF NOT EXISTS feed_visits (
  user_name TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prev_seen_at TIMESTAMPTZ
);

-- lib/ideaTradeMatch.ts
ALTER TABLE trade_ideas ADD COLUMN IF NOT EXISTS trade_link_source TEXT;
ALTER TABLE trade_ideas ADD COLUMN IF NOT EXISTS trade_linked_at TIMESTAMPTZ;

-- lib/notifyEvents.ts
CREATE TABLE IF NOT EXISTS notification_dedup (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- lib/offeringsCache.ts
CREATE TABLE IF NOT EXISTS offering_ticker_cache (
  ticker TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, kind)
);

-- lib/planMedia.ts
CREATE TABLE IF NOT EXISTS plan_media (
  id SERIAL PRIMARY KEY,
  context TEXT NOT NULL,
  owner TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS plan_media_owner_created_idx ON plan_media (owner, created_at);
CREATE INDEX IF NOT EXISTS plan_media_date_idx ON plan_media (plan_date, context);

-- lib/riskData.ts
CREATE TABLE IF NOT EXISTS risk_alert_log (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  used NUMERIC(14,2),
  "limit" NUMERIC(14,2),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trader, date, kind)
);
CREATE TABLE IF NOT EXISTS trader_risk_limit_events (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  before JSONB,
  after JSONB NOT NULL,
  reason TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trader_risk_limit_events_trader_idx ON trader_risk_limit_events (trader, changed_at DESC);

-- routes/academy-cohorts.ts
CREATE TABLE IF NOT EXISTS academy_cohorts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'office',
  mentor TEXT,
  starts_on DATE,
  ends_on DATE,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  description TEXT NOT NULL DEFAULT '',
  room TEXT,
  meeting_url TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS academy_cohorts_name_live_uq ON academy_cohorts (name) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS academy_enrollments (
  id SERIAL PRIMARY KEY,
  cohort_id INTEGER NOT NULL REFERENCES academy_cohorts(id),
  user_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'junior',
  status TEXT NOT NULL DEFAULT 'active',
  joined_on DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/New_York')::date),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS academy_enrollments_live_uq ON academy_enrollments (cohort_id, user_name) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS academy_enrollments_user_idx ON academy_enrollments (user_name);
CREATE TABLE IF NOT EXISTS academy_enrollment_history (
  id SERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL,
  cohort_id INTEGER,
  user_name TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  from_status TEXT,
  to_status TEXT,
  changed_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS academy_enrollment_history_enr_idx ON academy_enrollment_history (enrollment_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS academy_enrollment_history_user_idx ON academy_enrollment_history (user_name, changed_at DESC);
CREATE TABLE IF NOT EXISTS academy_sessions (
  id SERIAL PRIMARY KEY,
  cohort_id INTEGER NOT NULL REFERENCES academy_cohorts(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'lecture',
  recurrence TEXT NOT NULL DEFAULT 'none',
  weekdays SMALLINT[] NOT NULL DEFAULT '{}',
  start_date DATE NOT NULL,
  end_date DATE,
  start_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  mode TEXT NOT NULL DEFAULT 'office',
  room TEXT,
  meeting_url TEXT,
  host TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_sessions_cohort_idx ON academy_sessions (cohort_id);
CREATE TABLE IF NOT EXISTS academy_attendance (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES academy_sessions(id),
  occurrence_date DATE NOT NULL,
  user_name TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'mentor',
  checked_in_at TIMESTAMPTZ,
  marked_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, occurrence_date, user_name)
);
CREATE INDEX IF NOT EXISTS academy_attendance_user_idx ON academy_attendance (user_name, occurrence_date DESC);
CREATE TABLE IF NOT EXISTS academy_one_on_ones (
  id SERIAL PRIMARY KEY,
  student TEXT NOT NULL,
  mentor TEXT NOT NULL,
  cohort_id INTEGER,
  met_at TIMESTAMPTZ NOT NULL,
  duration_min INTEGER,
  format TEXT NOT NULL DEFAULT 'office',
  agenda TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  private_notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_one_on_ones_student_idx ON academy_one_on_ones (student, met_at DESC);
CREATE TABLE IF NOT EXISTS academy_action_items (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER,
  student TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'student',
  title TEXT NOT NULL,
  due_on DATE,
  status TEXT NOT NULL DEFAULT 'open',
  done_at TIMESTAMPTZ,
  overdue_notified_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_action_items_student_idx ON academy_action_items (student, status);
CREATE TABLE IF NOT EXISTS academy_idp_goals (
  id SERIAL PRIMARY KEY,
  student TEXT NOT NULL,
  title TEXT NOT NULL,
  metric TEXT NOT NULL,
  comparator TEXT NOT NULL,
  target NUMERIC NOT NULL,
  window_n INTEGER,
  start_date DATE NOT NULL,
  due_on DATE,
  status TEXT NOT NULL DEFAULT 'active',
  manual_progress NUMERIC,
  note TEXT NOT NULL DEFAULT '',
  last_value NUMERIC,
  last_progress NUMERIC,
  last_evaluated_at TIMESTAMPTZ,
  achieved_at TIMESTAMPTZ,
  missed_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_idp_goals_student_idx ON academy_idp_goals (student, status);

-- routes/academy-content.ts
CREATE TABLE IF NOT EXISTS academy_programs (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT,
  stage TEXT,
  published BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
ALTER TABLE academy_programs ADD COLUMN IF NOT EXISTS stage TEXT;
CREATE TABLE IF NOT EXISTS academy_modules (
  id SERIAL PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES academy_programs(id),
  title TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  seed_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_modules_program_idx ON academy_modules (program_id);
CREATE TABLE IF NOT EXISTS academy_lessons (
  id SERIAL PRIMARY KEY,
  module_id INTEGER NOT NULL REFERENCES academy_modules(id),
  title TEXT NOT NULL,
  summary TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_min INTEGER,
  playbook_ids INTEGER[] NOT NULL DEFAULT '{}',
  setup_names TEXT[] NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  draft BOOLEAN NOT NULL DEFAULT false,
  seed_key TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_lessons_module_idx ON academy_lessons (module_id);
CREATE INDEX IF NOT EXISTS academy_lessons_playbook_idx ON academy_lessons USING GIN (playbook_ids);
CREATE TABLE IF NOT EXISTS academy_quizzes (
  id SERIAL PRIMARY KEY,
  module_id INTEGER NOT NULL REFERENCES academy_modules(id),
  title TEXT NOT NULL,
  description TEXT,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  pass_pct INTEGER NOT NULL DEFAULT 80,
  max_attempts INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  draft BOOLEAN NOT NULL DEFAULT false,
  seed_key TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_quizzes_module_idx ON academy_quizzes (module_id);
CREATE TABLE IF NOT EXISTS academy_quiz_attempts (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES academy_quizzes(id),
  user_name TEXT NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  score NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academy_quiz_attempts_user_idx ON academy_quiz_attempts (user_name, quiz_id);
CREATE TABLE IF NOT EXISTS academy_assignments (
  id SERIAL PRIMARY KEY,
  module_id INTEGER NOT NULL REFERENCES academy_modules(id),
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  rubric JSONB NOT NULL DEFAULT '[]'::jsonb,
  pass_pct INTEGER NOT NULL DEFAULT 70,
  min_trades INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  draft BOOLEAN NOT NULL DEFAULT false,
  seed_key TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_assignments_module_idx ON academy_assignments (module_id);
CREATE TABLE IF NOT EXISTS academy_submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES academy_assignments(id),
  user_name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  trade_ids INTEGER[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'submitted',
  scores JSONB,
  total NUMERIC(10,2),
  max_total NUMERIC(10,2),
  pct NUMERIC(6,2),
  passed BOOLEAN,
  mentor_comment TEXT,
  graded_by TEXT,
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_submissions_user_idx ON academy_submissions (user_name, assignment_id);
CREATE INDEX IF NOT EXISTS academy_submissions_status_idx ON academy_submissions (status) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS academy_lesson_progress (
  user_name TEXT NOT NULL,
  lesson_id INTEGER NOT NULL REFERENCES academy_lessons(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_name, lesson_id)
);

-- routes/analyst-actions.ts
CREATE TABLE IF NOT EXISTS analyst_bars_cache (
  ticker TEXT PRIMARY KEY,
  bars JSONB NOT NULL DEFAULT '[]'::jsonb,
  from_date TEXT,
  to_date TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- routes/author-notes.ts
CREATE TABLE IF NOT EXISTS author_note_reads (
  note_id INTEGER NOT NULL REFERENCES author_notes(id) ON DELETE CASCADE,
  reader TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, reader)
);

-- routes/behavior.ts
CREATE TABLE IF NOT EXISTS behavior_triggers (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  source_pattern TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS behavior_triggers_trader_idx ON behavior_triggers (trader) WHERE deleted_at IS NULL;

-- routes/journal.ts
CREATE TABLE IF NOT EXISTS journal_days (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  day DATE NOT NULL,
  plan TEXT NOT NULL DEFAULT '',
  well TEXT NOT NULL DEFAULT '',
  mistakes TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  mood SMALLINT,
  discipline SMALLINT,
  followed_plan BOOLEAN,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trader, day)
);

-- routes/junior-notes.ts
ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS sections JSONB;
ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS curator_feedback TEXT;
ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS curator_score SMALLINT;
ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE junior_notes ADD COLUMN IF NOT EXISTS feedback_seen_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS junior_note_reminders (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  note_date DATE NOT NULL,
  curator TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ,
  UNIQUE (trader, note_date)
);

-- routes/officeStats.ts
CREATE TABLE IF NOT EXISTS office_capital (
  year INTEGER PRIMARY KEY,
  capital NUMERIC(16, 2),
  goal_pct NUMERIC(7, 2) NOT NULL DEFAULT 40,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- routes/playbook-inbox.ts
CREATE TABLE IF NOT EXISTS playbook_inbox_dismissed (
  trade_id INTEGER PRIMARY KEY,
  dismissed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS activity_log_section_entity_idx ON activity_log (section, entity_id, created_at DESC);

-- routes/whatif.ts
CREATE TABLE IF NOT EXISTS whatif_scenarios (
  id SERIAL PRIMARY KEY,
  trader TEXT NOT NULL,
  name TEXT NOT NULL,
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS whatif_scenarios_trader_idx ON whatif_scenarios(trader);
