-- no-transaction
-- Performance review 2026-10-21.
--
-- 1. Ticker filters compare UPPER(ticker): lib/tradesPageQuery (GET /trades/page ?ticker=, the book by ticker, newest
--    first) and lib/watchlist/store tickerStats (the viewer's own trades / open positions per watched ticker). A plain
--    index on trades.ticker cannot serve UPPER(ticker), and a manual trade (POST /trades) may be stored in any case, so
--    the comparison has to stay case-insensitive: expression indexes, spelled exactly as the queries write them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS trades_live_upper_ticker_date_idx
  ON trades ((UPPER(ticker)), date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS trades_live_trader_upper_ticker_idx
  ON trades (trader, (UPPER(ticker)))
  WHERE deleted_at IS NULL;

-- 2. Indexes declared in the Drizzle schema (lib/db/src/schema) that no migration ever created.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_trade_reviews_trade_idx ON ai_trade_reviews (trade_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_trade_reviews_generated_at_idx ON ai_trade_reviews (generated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_review_rate_user_idx ON ai_review_rate_limit (user_key);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_review_rate_created_idx ON ai_review_rate_limit (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS checklist_responses_trader_date_idx ON pre_trade_checklist_responses (trader, trade_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS discussions_ticker_idx ON discussions (ticker);
CREATE INDEX CONCURRENTLY IF NOT EXISTS emotional_state_log_user_id_idx ON emotional_state_log (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS emotional_state_log_date_idx ON emotional_state_log (date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS emotional_state_log_user_date_idx ON emotional_state_log (user_id, date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS trade_ideas_created_at_idx ON trade_ideas (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS trade_idea_reactions_trader_idx ON trade_idea_reactions (trader);
CREATE INDEX CONCURRENTLY IF NOT EXISTS voice_notes_user_id_idx ON voice_notes (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS voice_notes_trade_id_idx ON voice_notes (trade_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS voice_notes_daily_feed_id_idx ON voice_notes (daily_feed_id);
