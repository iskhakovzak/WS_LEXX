-- WS_LEXX Schema for Supabase
-- Paste this in Supabase SQL Editor to create all tables

CREATE TABLE IF NOT EXISTS "trades" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticker" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "setup" TEXT,
  "side" TEXT,
  "event_type" TEXT,
  "entry" NUMERIC(12,4),
  "exit" NUMERIC(12,4),
  "stop" NUMERIC(12,4),
  "result" TEXT NOT NULL,
  "pnl" NUMERIC(12,2),
  "r_multiple" NUMERIC(8,2),
  "hold_time" TEXT,
  "slippage" NUMERIC(8,2),
  "market_cap" TEXT,
  "float" TEXT,
  "relative_volume" NUMERIC(8,2),
  "session" TEXT,
  "screenshot_url" TEXT,
  "screenshot_notes" TEXT,
  "notes" TEXT,
  "what_worked" TEXT,
  "what_failed" TEXT,
  "conclusion" TEXT,
  "trader" TEXT,
  "tags" TEXT,
  "event_id" INTEGER,
  "pattern_id" INTEGER,
  "playbook_id" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "market_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticker" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "headline" TEXT NOT NULL,
  "reaction" TEXT,
  "percent_move" NUMERIC(8,2),
  "volume" TEXT,
  "summary" TEXT,
  "screenshot_url" TEXT,
  "screenshot_notes" TEXT,
  "tags" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "research" (
  "id" BIGSERIAL PRIMARY KEY,
  "pattern_name" TEXT NOT NULL,
  "ticker" TEXT,
  "context" TEXT,
  "market_condition" TEXT,
  "what_worked" TEXT,
  "what_failed" TEXT,
  "repeat_count" INTEGER DEFAULT 1,
  "confidence_level" INTEGER DEFAULT 50,
  "screenshot_url" TEXT,
  "screenshot_notes" TEXT,
  "tags" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "daily_feed" (
  "id" BIGSERIAL PRIMARY KEY,
  "date" TEXT NOT NULL,
  "what_works_now" TEXT,
  "what_doesnt_work" TEXT,
  "best_tickers" TEXT,
  "market_theme" TEXT,
  "notes" TEXT,
  "tags" TEXT,
  "screenshot_url" TEXT,
  "screenshot_notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "discussions" (
  "id" BIGSERIAL PRIMARY KEY,
  "topic" TEXT NOT NULL,
  "type" TEXT,
  "trader" TEXT,
  "notes" TEXT,
  "tags" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "comments" (
  "id" BIGSERIAL PRIMARY KEY,
  "discussion_id" INTEGER NOT NULL,
  "trader" TEXT,
  "text" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "watchlist" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticker" TEXT NOT NULL,
  "catalyst" TEXT,
  "target_price" NUMERIC(12,4),
  "stop_price" NUMERIC(12,4),
  "status" TEXT NOT NULL DEFAULT 'watching',
  "notes" TEXT,
  "sector" TEXT,
  "tags" TEXT,
  "screenshot_url" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "playbook" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "folder" TEXT,
  "setup_type" TEXT,
  "conditions" TEXT,
  "checklist" TEXT,
  "notes" TEXT,
  "confidence_level" INTEGER,
  "screenshot_url" TEXT,
  "screenshot_notes" TEXT,
  "tags" TEXT,
  "source_type" TEXT,
  "source_id" INTEGER,
  "parent_id" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "activity_log" (
  "id" BIGSERIAL PRIMARY KEY,
  "action" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "entity_id" TEXT,
  "entity_title" TEXT,
  "trader" TEXT,
  "details" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "trade_reactions" (
  "id" BIGSERIAL PRIMARY KEY,
  "trade_id" INTEGER NOT NULL,
  "trader" TEXT NOT NULL,
  "reaction_type" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "trading_errors" (
  "id" BIGSERIAL PRIMARY KEY,
  "trader" TEXT NOT NULL,
  "error_type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "ticker" TEXT,
  "trade_id" INTEGER,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "lesson" TEXT,
  "resolved" TEXT NOT NULL DEFAULT 'no',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "trade_reviews" (
  "id" BIGSERIAL PRIMARY KEY,
  "trade_id" INTEGER NOT NULL,
  "curator" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "rating" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "playbook_trade_ideas" (
  "id" BIGSERIAL PRIMARY KEY,
  "playbook_entry_id" INTEGER NOT NULL,
  "ticker" TEXT NOT NULL,
  "side" TEXT,
  "entry_zone" TEXT,
  "target" TEXT,
  "stop" TEXT,
  "status" TEXT DEFAULT 'watching',
  "notes" TEXT,
  "date" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "big7_levels" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticker" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "price" NUMERIC(12,4) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "big7_catalysts" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticker" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT,
  "impact" TEXT NOT NULL DEFAULT 'medium',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "password" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'trader',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "trader_ratings" (
  "id" BIGSERIAL PRIMARY KEY,
  "trader" TEXT NOT NULL,
  "curator" TEXT NOT NULL,
  "week" TEXT NOT NULL,
  "discipline" INTEGER DEFAULT 5,
  "risk_management" INTEGER DEFAULT 5,
  "execution" INTEGER DEFAULT 5,
  "journaling" INTEGER DEFAULT 5,
  "improvement" INTEGER DEFAULT 5,
  "overall" INTEGER DEFAULT 5,
  "comment" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "war_room_sessions" (
  "id" BIGSERIAL PRIMARY KEY,
  "trader" TEXT,
  "event_name" TEXT NOT NULL,
  "event_time" TIMESTAMPTZ NOT NULL,
  "notes" TEXT,
  "checklist" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ended_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "war_room_levels" (
  "id" BIGSERIAL PRIMARY KEY,
  "session_id" INTEGER NOT NULL REFERENCES "war_room_sessions"("id") ON DELETE CASCADE,
  "ticker" TEXT NOT NULL,
  "price" NUMERIC(12,4) NOT NULL,
  "label" TEXT NOT NULL,
  "type" TEXT NOT NULL
);
