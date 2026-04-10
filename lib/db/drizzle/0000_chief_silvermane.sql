CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" text NOT NULL,
	"setup" text,
	"side" text,
	"event_type" text,
	"entry" numeric(12, 4),
	"exit" numeric(12, 4),
	"stop" numeric(12, 4),
	"result" text NOT NULL,
	"pnl" numeric(12, 2),
	"r_multiple" numeric(8, 2),
	"hold_time" text,
	"slippage" numeric(8, 2),
	"market_cap" text,
	"float" text,
	"relative_volume" numeric(8, 2),
	"session" text,
	"screenshot_url" text,
	"screenshot_notes" text,
	"notes" text,
	"what_worked" text,
	"what_failed" text,
	"conclusion" text,
	"trader" text,
	"tags" text,
	"event_id" integer,
	"pattern_id" integer,
	"playbook_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" text NOT NULL,
	"event_type" text NOT NULL,
	"headline" text NOT NULL,
	"reaction" text,
	"percent_move" numeric(8, 2),
	"volume" text,
	"summary" text,
	"screenshot_url" text,
	"screenshot_notes" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_name" text NOT NULL,
	"ticker" text,
	"context" text,
	"market_condition" text,
	"what_worked" text,
	"what_failed" text,
	"repeat_count" integer DEFAULT 1,
	"confidence_level" integer DEFAULT 50,
	"screenshot_url" text,
	"screenshot_notes" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_feed" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"what_works_now" text,
	"what_doesnt_work" text,
	"best_tickers" text,
	"market_theme" text,
	"notes" text,
	"tags" text,
	"screenshot_url" text,
	"screenshot_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"discussion_id" integer NOT NULL,
	"trader" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discussions" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"type" text,
	"trader" text,
	"notes" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"catalyst" text,
	"target_price" numeric(12, 4),
	"stop_price" numeric(12, 4),
	"status" text DEFAULT 'watching' NOT NULL,
	"notes" text,
	"sector" text,
	"screenshot_url" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "playbook" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"folder" text,
	"setup_type" text,
	"conditions" text,
	"checklist" text,
	"notes" text,
	"confidence_level" integer,
	"screenshot_url" text,
	"screenshot_notes" text,
	"tags" text,
	"source_type" text,
	"source_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"section" text NOT NULL,
	"entity_id" text,
	"entity_title" text,
	"trader" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"trader" text NOT NULL,
	"reaction_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"curator" text NOT NULL,
	"comment" text NOT NULL,
	"rating" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader" text NOT NULL,
	"error_type" text NOT NULL,
	"description" text NOT NULL,
	"ticker" text,
	"trade_id" integer,
	"severity" text DEFAULT 'medium' NOT NULL,
	"lesson" text,
	"resolved" text DEFAULT 'no' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "big7_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"label" text NOT NULL,
	"price" numeric(12, 4) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "big7_catalysts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"impact" text DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "war_room_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"price" numeric(12, 4) NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "war_room_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trader" text,
	"event_name" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"notes" text,
	"checklist" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_event_id_market_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."market_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_pattern_id_research_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."research"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_discussion_id_discussions_id_fk" FOREIGN KEY ("discussion_id") REFERENCES "public"."discussions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_reactions" ADD CONSTRAINT "trade_reactions_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_errors" ADD CONSTRAINT "trading_errors_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "war_room_levels" ADD CONSTRAINT "war_room_levels_session_id_war_room_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."war_room_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_ticker_idx" ON "trades" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "trades_date_idx" ON "trades" USING btree ("date");--> statement-breakpoint
CREATE INDEX "trades_trader_idx" ON "trades" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "trades_created_at_idx" ON "trades" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trades_event_id_idx" ON "trades" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "trades_pattern_id_idx" ON "trades" USING btree ("pattern_id");--> statement-breakpoint
CREATE INDEX "trades_playbook_id_idx" ON "trades" USING btree ("playbook_id");--> statement-breakpoint
CREATE INDEX "events_ticker_idx" ON "market_events" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "market_events" USING btree ("date");--> statement-breakpoint
CREATE INDEX "events_created_at_idx" ON "market_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "research_ticker_idx" ON "research" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "research_created_at_idx" ON "research" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "daily_feed_date_idx" ON "daily_feed" USING btree ("date");--> statement-breakpoint
CREATE INDEX "daily_feed_created_at_idx" ON "daily_feed" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comments_discussion_id_idx" ON "comments" USING btree ("discussion_id");--> statement-breakpoint
CREATE INDEX "comments_trader_idx" ON "comments" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "comments_created_at_idx" ON "comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "discussions_trader_idx" ON "discussions" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "discussions_created_at_idx" ON "discussions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "watchlist_ticker_idx" ON "watchlist" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "watchlist_created_at_idx" ON "watchlist" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "playbook_created_at_idx" ON "playbook" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "playbook_folder_idx" ON "playbook" USING btree ("folder");--> statement-breakpoint
CREATE INDEX "activity_log_trader_idx" ON "activity_log" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "activity_log_created_at_idx" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trade_reactions_trade_id_idx" ON "trade_reactions" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "trade_reactions_created_at_idx" ON "trade_reactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trade_reviews_trade_id_idx" ON "trade_reviews" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "trade_reviews_created_at_idx" ON "trade_reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trading_errors_trader_idx" ON "trading_errors" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "trading_errors_trade_id_idx" ON "trading_errors" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "trading_errors_created_at_idx" ON "trading_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "big7_levels_ticker_idx" ON "big7_levels" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "big7_levels_created_at_idx" ON "big7_levels" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "big7_catalysts_ticker_idx" ON "big7_catalysts" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "big7_catalysts_date_idx" ON "big7_catalysts" USING btree ("date");--> statement-breakpoint
CREATE INDEX "war_room_levels_session_idx" ON "war_room_levels" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "war_room_sessions_trader_idx" ON "war_room_sessions" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "war_room_sessions_created_at_idx" ON "war_room_sessions" USING btree ("created_at");