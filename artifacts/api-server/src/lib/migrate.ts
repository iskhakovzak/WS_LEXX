import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function runMigrations() {
  logger.info("Running database migrations...");

  const createStatements = [
    `CREATE TABLE IF NOT EXISTS "trades" (
      "id" SERIAL PRIMARY KEY,
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
      "notes" TEXT,
      "what_worked" TEXT,
      "what_failed" TEXT,
      "conclusion" TEXT,
      "trader" TEXT,
      "tags" TEXT,
      "event_id" INTEGER,
      "pattern_id" INTEGER,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "market_events" (
      "id" SERIAL PRIMARY KEY,
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
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "research" (
      "id" SERIAL PRIMARY KEY,
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
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "daily_feed" (
      "id" SERIAL PRIMARY KEY,
      "date" TEXT NOT NULL,
      "what_works_now" TEXT,
      "what_doesnt_work" TEXT,
      "best_tickers" TEXT,
      "market_theme" TEXT,
      "notes" TEXT,
      "tags" TEXT,
      "screenshot_url" TEXT,
      "screenshot_notes" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "discussions" (
      "id" SERIAL PRIMARY KEY,
      "topic" TEXT NOT NULL,
      "type" TEXT,
      "trader" TEXT,
      "notes" TEXT,
      "tags" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "comments" (
      "id" SERIAL PRIMARY KEY,
      "discussion_id" INTEGER NOT NULL,
      "trader" TEXT,
      "text" TEXT NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "watchlist" (
      "id" SERIAL PRIMARY KEY,
      "ticker" TEXT NOT NULL,
      "catalyst" TEXT,
      "target_price" NUMERIC(12,4),
      "stop_price" NUMERIC(12,4),
      "status" TEXT NOT NULL DEFAULT 'watching',
      "notes" TEXT,
      "sector" TEXT,
      "tags" TEXT,
      "screenshot_url" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "playbook" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "setup_type" TEXT,
      "conditions" TEXT,
      "checklist" TEXT,
      "notes" TEXT,
      "confidence_level" INTEGER,
      "screenshot_url" TEXT,
      "screenshot_notes" TEXT,
      "tags" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "activity_log" (
      "id" SERIAL PRIMARY KEY,
      "action" TEXT NOT NULL,
      "section" TEXT NOT NULL,
      "entity_id" TEXT,
      "entity_title" TEXT,
      "trader" TEXT,
      "details" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "trade_reactions" (
      "id" SERIAL PRIMARY KEY,
      "trade_id" INTEGER NOT NULL,
      "trader" TEXT NOT NULL,
      "reaction_type" TEXT NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "trading_errors" (
      "id" SERIAL PRIMARY KEY,
      "trader" TEXT NOT NULL,
      "error_type" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "ticker" TEXT,
      "trade_id" INTEGER,
      "severity" TEXT NOT NULL DEFAULT 'medium',
      "lesson" TEXT,
      "resolved" TEXT NOT NULL DEFAULT 'no',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "trade_reviews" (
      "id" SERIAL PRIMARY KEY,
      "trade_id" INTEGER NOT NULL,
      "curator" TEXT NOT NULL,
      "comment" TEXT NOT NULL,
      "rating" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "playbook_trade_ideas" (
      "id" SERIAL PRIMARY KEY,
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
    )`,
    `CREATE TABLE IF NOT EXISTS "big7_levels" (
      "id" SERIAL PRIMARY KEY,
      "ticker" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "price" NUMERIC(12,4) NOT NULL,
      "notes" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "big7_catalysts" (
      "id" SERIAL PRIMARY KEY,
      "ticker" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "description" TEXT,
      "impact" TEXT NOT NULL DEFAULT 'medium',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "users" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "password" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'trader',
      "active" BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "trader_ratings" (
      "id" SERIAL PRIMARY KEY,
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
    )`,
    `CREATE TABLE IF NOT EXISTS "war_room_sessions" (
      "id" SERIAL PRIMARY KEY,
      "trader" TEXT,
      "event_name" TEXT NOT NULL,
      "event_time" TIMESTAMPTZ NOT NULL,
      "notes" TEXT,
      "checklist" JSONB,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "ended_at" TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS "war_room_levels" (
      "id" SERIAL PRIMARY KEY,
      "session_id" INTEGER NOT NULL REFERENCES "war_room_sessions"("id") ON DELETE CASCADE,
      "ticker" TEXT NOT NULL,
      "price" NUMERIC(12,4) NOT NULL,
      "label" TEXT NOT NULL,
      "type" TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "playbook_folder_settings" (
      "folder_name" TEXT PRIMARY KEY,
      "color_index" INTEGER,
      "sort_order" INTEGER NOT NULL DEFAULT 0,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  ];

  for (const sql of createStatements) {
    try {
      await pool.query(sql);
      const tableName = sql.match(/"(\w+)"/)?.[1] || "unknown";
      logger.info(`Migration: table ${tableName} OK`);
    } catch (e: any) {
      logger.error({ error: e.message }, "Migration: table creation error");
    }
  }

  const addColumns = [
    { table: "trades", column: "screenshot_notes", type: "TEXT" },
    { table: "trades", column: "side", type: "TEXT" },
    { table: "trades", column: "tags", type: "TEXT" },
    { table: "market_events", column: "tags", type: "TEXT" },
    { table: "research", column: "tags", type: "TEXT" },
    { table: "daily_feed", column: "tags", type: "TEXT" },
    { table: "daily_feed", column: "screenshot_url", type: "TEXT" },
    { table: "discussions", column: "tags", type: "TEXT" },
    { table: "discussions", column: "type", type: "TEXT" },
    { table: "discussions", column: "trader", type: "TEXT" },
    { table: "watchlist", column: "tags", type: "TEXT" },
    { table: "watchlist", column: "sector", type: "TEXT" },
    { table: "watchlist", column: "screenshot_url", type: "TEXT" },
    { table: "playbook", column: "tags", type: "TEXT" },
    { table: "market_events", column: "screenshot_notes", type: "TEXT" },
    { table: "research", column: "screenshot_notes", type: "TEXT" },
    { table: "daily_feed", column: "screenshot_notes", type: "TEXT" },
    { table: "playbook", column: "screenshot_notes", type: "TEXT" },
    { table: "trades", column: "pattern_id", type: "INTEGER" },
    { table: "trades", column: "deleted_at", type: "TIMESTAMPTZ" },
    { table: "playbook", column: "folder", type: "TEXT" },
    { table: "playbook", column: "source_type", type: "TEXT" },
    { table: "playbook", column: "source_id", type: "INTEGER" },
    { table: "playbook", column: "deleted_at", type: "TIMESTAMPTZ" },
    { table: "watchlist", column: "deleted_at", type: "TIMESTAMPTZ" },
    { table: "market_events", column: "deleted_at", type: "TIMESTAMPTZ" },
    { table: "research", column: "deleted_at", type: "TIMESTAMPTZ" },
    { table: "daily_feed", column: "deleted_at", type: "TIMESTAMPTZ" },
    { table: "discussions", column: "deleted_at", type: "TIMESTAMPTZ" },
    { table: "trades", column: "playbook_id", type: "INTEGER" },
    { table: "playbook", column: "parent_id", type: "INTEGER" },
    { table: "users", column: "theme", type: "TEXT DEFAULT 'dark'" },
  ];

  for (const m of addColumns) {
    try {
      await pool.query(`ALTER TABLE "${m.table}" ADD COLUMN IF NOT EXISTS "${m.column}" ${m.type}`);
    } catch (e: any) {
      logger.warn({ error: e.message }, `Migration: column ${m.table}.${m.column}`);
    }
  }

  const { rows: existingUsers } = await pool.query(`SELECT COUNT(*) as cnt FROM users`);
  if (Number(existingUsers[0]?.cnt) === 0) {
    logger.info("Seeding default users...");
    const defaultUsers = [
      { name: "Закир", password: "0101", role: "trader" },
      { name: "Антон", password: "61725", role: "curator" },
      { name: "Артур", password: "93547", role: "trader" },
      { name: "Рахматулло", password: "5555", role: "trader" },
      { name: "Умид", password: "15964", role: "trader" },
      { name: "Максат", password: "82374", role: "trader" },
      { name: "Тимур", password: "39156", role: "curator" },
      { name: "Ориф", password: "07770", role: "curator" },
    ];
    for (const u of defaultUsers) {
      try {
        await pool.query(`INSERT INTO users (name, password, role) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`, [u.name, u.password, u.role]);
      } catch (e: any) { logger.warn({ error: e.message }, `Seed user ${u.name}`); }
    }
    logger.info("Default users seeded");
  }

  const smbStrategies = [
    { name: "ATM Offering Play — Short", folder: "SMB Capital — Offering Plays", setupType: "Другой", confidenceLevel: 80, conditions: "Stock announces ATM offering (shelf registration). Price drops on dilution fear. Short into the bounce after initial panic selling.", checklist: "- ATM offering confirmed (SEC filing)\n- Price dropped >5% on news\n- Volume spike > 3x average\n- Wait for first bounce attempt\n- Entry on failed bounce / rejection at VWAP\n- Stop above pre-market high", notes: "One of SMB Capital's core plays. ATM offerings create sustained selling pressure as the company sells shares into the open market. Key: don't short the initial drop, wait for the bounce attempt and short the failure." },
    { name: "Pricing Play — Long Bounce", folder: "SMB Capital — Offering Plays", setupType: "Reversal", confidenceLevel: 65, conditions: "After offering is priced (usually after hours), stock often gaps down to or below offering price. Long bounce off offering price level.", checklist: "- Offering priced (press release confirms price)\n- Stock trades at or below offering price\n- Volume confirms capitulation\n- Entry near offering price with tight stop\n- Target: VWAP or prior support turned resistance", notes: "Offering price acts as strong support because institutions bought at that level. They defend their position. Key risk: if offering price breaks, there's no floor." },
    { name: "Gap and Go — Earnings Momentum", folder: "SMB Capital — Gap Plays", setupType: "Earnings Gap Up", confidenceLevel: 75, conditions: "Stock gaps up >5% on strong earnings. Follow-through buying in first 30 minutes. Long continuation above opening range.", checklist: "- Earnings beat expectations significantly\n- Gap > 5% with volume > 2x average\n- Stock holds above VWAP in first 15 min\n- Entry on first pullback to VWAP or opening range high break\n- Stop below VWAP or opening range low\n- Target: prior resistance levels", notes: "Classic SMB play. The key is waiting for the first pullback rather than chasing the gap. Quality of earnings matters — revenue growth > EPS beats." },
    { name: "IPO Day Trade — First Day Play", folder: "SMB Capital — IPO Plays", setupType: "IPO Day Trade", confidenceLevel: 60, conditions: "First day of trading for IPO. Wait for opening range to establish (first 5-15 min), then trade the breakout or breakdown.", checklist: "- IPO with significant hype/demand\n- Wait for opening print and first range\n- Don't trade first 5 minutes\n- Long above opening range high OR short below opening range low\n- Use half size (IPO = volatile)\n- Stop: middle of opening range", notes: "SMB teaches patience on IPO day 1. The opening range is key. Many traders get chopped trying to trade the first 5 minutes. Wait for the range, then trade the break." },
    { name: "Second Day Play — Momentum Continuation", folder: "SMB Capital — Gap Plays", setupType: "Second Day Play", confidenceLevel: 70, conditions: "Stock had a big move Day 1 (earnings, news, IPO). Day 2 continuation trade — long above Day 1 high or short below Day 1 low.", checklist: "- Day 1 move was >10% on catalyst\n- Pre-market shows continuation interest\n- Entry above Day 1 high (long) or below Day 1 low (short)\n- Volume confirmation needed\n- Stop: Day 1 close or VWAP\n- Target: measured move from Day 1 range", notes: "Second Day Play is one of SMB's signature setups. The idea: momentum from Day 1 carries into Day 2. Best when the catalyst is fundamental (earnings, FDA) rather than technical." },
    { name: "VWAP Trend Trade — Intraday", folder: "SMB Capital — Intraday Setups", setupType: "Intraday Momentum", confidenceLevel: 75, conditions: "Stock trends above/below VWAP all day. Trade pullbacks to VWAP in direction of the trend. Long if above, short if below.", checklist: "- Clear trend direction established by 10:00 AM\n- Stock respects VWAP as support (uptrend) or resistance (downtrend)\n- Entry on pullback to VWAP with volume dry-up\n- Stop: VWAP cross (close below for longs, above for shorts)\n- Trail stop using rising/falling VWAP", notes: "VWAP is the institutional benchmark. When a stock trends above VWAP, institutions are net buyers. When below, net sellers. This creates a self-reinforcing cycle." },
    { name: "Parabolic Short — Extended Stock", folder: "SMB Capital — Short Setups", setupType: "Reversal", confidenceLevel: 65, conditions: "Stock goes parabolic (vertical move up 30%+ intraday). Short the blow-off top when momentum exhausts.", checklist: "- Stock up >30% intraday on low/mid float\n- Parabolic arc visible on 1-min chart\n- Wait for first red candle after vertical move\n- Volume climax (highest volume candle of the day)\n- Entry on break of first red candle low\n- Stop above high of day\n- Target: VWAP or 50% retrace", notes: "High risk / high reward. SMB teaches strict rules: NEVER short into strength. Wait for the first crack. Use small size. The blow-off top often comes with a volume climax — that's your signal." },
    { name: "Opening Range Breakout (ORB)", folder: "SMB Capital — Intraday Setups", setupType: "Breakout", confidenceLevel: 72, conditions: "First 5/15/30 minute range establishes. Trade the breakout above the high or breakdown below the low of that range.", checklist: "- Define opening range (5min, 15min, or 30min)\n- Wait for range to complete\n- Long above range high / Short below range low\n- Volume must confirm breakout (> average)\n- Stop: opposite side of range or midpoint\n- Target: 1:1 then trail", notes: "ORB is a bread-and-butter SMB setup. The opening range captures the battle between buyers and sellers. When one side wins (breakout), the move can be powerful. Best on days with catalyst." },
    { name: "Low Float Momentum — Float Rotation", folder: "SMB Capital — Intraday Setups", setupType: "Intraday Momentum", confidenceLevel: 60, conditions: "Low float stock (<20M shares) with catalyst. When volume > float (float rotation), momentum can carry the stock much further than expected.", checklist: "- Float < 20M shares\n- Catalyst (earnings, news, FDA)\n- Volume approaching or exceeding float\n- Stock making new HOD with increasing volume\n- Entry on pullback or flag break\n- Small size (low float = volatile)\n- Stop: prior consolidation low", notes: "Float rotation = when the entire float has traded hands. At this point, there are no more 'trapped' sellers and the stock can run much further. Key metric: volume/float ratio." },
    { name: "Failed Follow Through — Bear Flag Short", folder: "SMB Capital — Short Setups", setupType: "Reversal", confidenceLevel: 73, conditions: "Stock had a big move up but fails to follow through. Forms a bear flag (weak bounce on low volume). Short the breakdown of the flag.", checklist: "- Prior move up on Day 1\n- Day 2/3: weak bounce, low volume\n- Bear flag pattern forms (lower highs)\n- Entry on break below flag support\n- Volume increases on breakdown\n- Stop above flag high\n- Target: measured move down (flag pole)", notes: "Failed follow-through is the opposite of the Second Day Play. When momentum should continue but doesn't, it's a powerful reversal signal. SMB uses this as one of their primary short setups." },
    { name: "Short Squeeze Play", folder: "SMB Capital — Momentum Setups", setupType: "Intraday Momentum", confidenceLevel: 55, conditions: "High short interest stock (>20%) gets a catalyst. Short sellers forced to cover, creating buying pressure and rapid price increase.", checklist: "- Short interest > 20% of float\n- Catalyst (earnings beat, news, upgrade)\n- Pre-market gap up with high volume\n- Entry on first pullback after initial squeeze\n- Monitor short interest data / borrow rates\n- Tight stop (if squeeze fails, reversal is sharp)\n- Target: prior resistance levels from weekly chart", notes: "Short squeezes are unpredictable. SMB teaches to trade them small and respect the volatility. The best squeezes happen when fundamental catalyst + high short interest + low float combine." },
    { name: "Sympathy Play — Sector Follower", folder: "SMB Capital — Momentum Setups", setupType: "Intraday Momentum", confidenceLevel: 60, conditions: "When a sector leader makes a big move, other stocks in the same sector often follow (sympathy move). Trade the follower.", checklist: "- Identify the sector leader making the move\n- Find related stocks in same sector/industry\n- Sympathy stock should have its own catalyst or setup\n- Entry on breakout or momentum confirmation\n- Don't chase — wait for your setup\n- Stop based on the sympathy stock's chart, not the leader\n- Target: proportional move to leader", notes: "Sympathy plays are a staple of prop trading. When NVDA moves, watch AMD, AVGO, MU. When one biotech gets FDA approval, watch similar pipeline companies. Key: the leader goes first, sympathies follow with a delay." },
    { name: "Halt & Resume Play", folder: "SMB Capital — Intraday Setups", setupType: "Другой", confidenceLevel: 65, conditions: "Stock gets halted (LULD halt or news halt). Trade the resume — either continuation or reversal depending on context.", checklist: "- Note halt type (LULD up/down, news pending)\n- During halt: assess catalyst, level 2, pre-halt momentum\n- On resume: wait 30 seconds for price discovery\n- If continuation: long above halt price (up halt) or short below (down halt)\n- If reversal: opposite direction after failed continuation\n- Use small size — halts = maximum volatility\n- Stop: opposite side of resume range", notes: "Halt resumes are some of the highest-volatility moments in trading. SMB teaches discipline: don't place orders during halt, wait for resume, let price discover, then act. Many traders get destroyed by blindly buying/shorting halts." },
    { name: "Anchored VWAP — Earnings / IPO Level", folder: "SMB Capital — Intraday Setups", setupType: "Breakout", confidenceLevel: 70, conditions: "Anchored VWAP from significant event (earnings, IPO, offering) acts as key support/resistance. Trade the reaction at this level.", checklist: "- Identify significant event date (earnings, IPO, offering)\n- Calculate anchored VWAP from that date\n- Wait for price to reach anchored VWAP level\n- Look for reaction (bounce or break)\n- Entry on confirmation of direction\n- Stop: other side of anchored VWAP\n- Target: next significant level", notes: "Anchored VWAP shows the average price paid by all participants since a significant event. Institutions track this level closely. It's especially powerful from earnings dates and IPO dates." },
    { name: "9 EMA Daily — Swing Entry на Trend", folder: "SMB Capital — Swing Setups", setupType: "Breakout", confidenceLevel: 74, conditions: "Stock in strong uptrend pulls back to 9 EMA on daily chart. This is the 'trend pullback' entry for swing traders.", checklist: "- Stock in clear uptrend (higher highs, higher lows)\n- Pullback to 9 EMA daily (within 1-2% of EMA)\n- Volume decreases on pullback\n- Entry on bounce off 9 EMA with volume\n- Stop: below 9 EMA or recent swing low\n- Target: prior high or measured move\n- Hold time: 2-10 days", notes: "The 9 EMA daily is SMB's favorite swing setup. It works because strong stocks rarely pull back more than 3-5 days before continuing. The 9 EMA captures this rhythm perfectly." },
    { name: "Dead Cat Bounce — Short the Recovery", folder: "SMB Capital — Short Setups", setupType: "Reversal", confidenceLevel: 68, conditions: "Stock drops sharply on bad news (earnings miss, downgrade). A weak bounce follows. Short the failed bounce.", checklist: "- Stock dropped >10% on negative catalyst\n- Weak bounce: low volume, doesn't reclaim VWAP\n- Bounce reaches resistance (prior support, moving average)\n- Entry on reversal from bounce high\n- Stop above bounce high\n- Target: retest of lows or new low", notes: "Dead cat bounces occur because: 1) Short covering, 2) Bottom fishers, 3) Algorithmic mean reversion. These bounces typically fail because the fundamental damage is real. SMB shorts these aggressively." },
    { name: "High of Day Break — Momentum Ignition", folder: "SMB Capital — Intraday Setups", setupType: "Breakout", confidenceLevel: 73, conditions: "Stock consolidates near HOD then breaks to new highs. This 'momentum ignition' triggers stops and algorithms, creating a powerful move.", checklist: "- Stock near HOD with tightening range\n- At least 2-3 tests of HOD level\n- Volume building on each test\n- Entry on break above HOD with volume surge\n- Stop below consolidation / last pullback low\n- Target: next resistance or measured move", notes: "HOD breaks are powerful because they trigger: 1) Buy stops from shorts, 2) Momentum algorithms, 3) Breakout traders. The combination creates a supply/demand imbalance that drives price higher quickly." },
    { name: "News Fade — Sell/Short the News", folder: "SMB Capital — Reversal Setups", setupType: "Reversal", confidenceLevel: 66, conditions: "Stock spikes on news but the news is already priced in or overhyped. Fade the initial move as it reverses.", checklist: "- News event causes spike (upgrade, product launch, partnership)\n- Assess if news is truly new or already expected\n- Wait for first signs of reversal (red candle, volume shift)\n- Entry on break of initial spike candle low\n- Stop above spike high\n- Target: pre-news price or VWAP", notes: "'Buy the rumor, sell the news' — one of the oldest market principles. SMB teaches to identify when news is already priced in by checking: pre-news price action, options activity, and whether the move is proportional to the catalyst." },
    { name: "In Play Stock Framework — Отбор акций", folder: "SMB Capital — Frameworks", setupType: "Другой", confidenceLevel: 90, conditions: "Framework for identifying 'In Play' stocks — stocks that will have the most opportunity for day traders on a given day.", checklist: "- Fresh catalyst (earnings, FDA, news) within 24 hours\n- Gap > 4% (up or down)\n- Pre-market volume > 500K shares\n- Relative volume > 2x average\n- ATR > $2 (enough range to trade)\n- Float < 100M preferred\n- Not in a halt or pending news\n- Check sector (is the whole sector moving?)", notes: "The In Play framework is the foundation of SMB Capital's methodology. Before trading any setup, the stock must be 'In Play' — meaning it has a catalyst, volume, and range to create opportunity. Without In Play status, setups have much lower probability." },
    { name: "Power Hour Momentum — 3:00–4:00 PM", folder: "SMB Capital — Intraday Setups", setupType: "Intraday Momentum", confidenceLevel: 68, conditions: "Last hour of trading (3:00-4:00 PM). Institutions execute large orders, creating momentum. Trade in direction of the day's trend.", checklist: "- Identify day's trend (above/below VWAP)\n- Wait until 3:00 PM\n- Look for volume increase (institutional activity)\n- Long if above VWAP all day, Short if below\n- Entry on pullback within the trend\n- Stop: VWAP cross\n- Target: close of day or trailing stop", notes: "Power hour is when institutions execute their remaining orders for the day. This creates volume and momentum. SMB teaches that the last hour often mirrors the first hour in terms of direction and opportunity." },
  ];

  const additionalStrategies = [
    { name: "Pre-Market Gap Scan — Watchlist Build", folder: "Pre-Market & After Hours", setupType: "Другой", confidenceLevel: 85, conditions: "Before market open (7:00-9:30 AM ET). Scan for stocks gapping >4% on catalyst. Build watchlist with levels, plan entries.", checklist: "- Scan at 7:00 AM for gaps >4%\n- Check catalyst (earnings, news, upgrade/downgrade)\n- Note pre-market volume (>500K = in play)\n- Mark key levels: PM high, PM low, prior day close\n- Calculate ATR for position sizing\n- Rank top 3-5 stocks by catalyst quality\n- Set alerts at key levels", notes: "The most important 30 minutes of the day happens before the market opens. Every successful prop trader starts with a thorough pre-market scan. This framework ensures you're prepared, not reactive." },
    { name: "After Hours Earnings React — Next Day Prep", folder: "Pre-Market & After Hours", setupType: "Другой", confidenceLevel: 70, conditions: "Stock reports earnings after hours. Analyze reaction, prepare next-day game plan based on after-hours price action.", checklist: "- Note earnings results vs expectations\n- Watch after-hours price reaction\n- Identify key AH levels (high, low, close)\n- Check options implied move vs actual\n- Prepare bull/bear scenario for next day\n- Set pre-market alerts", notes: "After-hours reaction to earnings often sets the tone for the next trading day. Preparing the night before gives you a significant edge over traders who react in real-time." },
    { name: "Overnight Hold — Swing Catalyst", folder: "Pre-Market & After Hours", setupType: "Другой", confidenceLevel: 55, conditions: "Hold position overnight when catalyst supports multi-day move. Reduce size for overnight risk. Set hard stop.", checklist: "- Catalyst supports multi-day move (earnings beat, FDA, M&A)\n- Reduce position to 50% of intraday size\n- Set hard stop (worst-case exit level)\n- Calculate overnight gap risk\n- Check after-hours liquidity\n- Set pre-market alert for review\n- Re-evaluate at next open", notes: "Overnight holds add gap risk but capture multi-day moves. Key rule: if you wouldn't enter the position fresh at the close, don't hold it overnight. Always reduce size." },
    { name: "Tape Reading — Order Flow Entry", folder: "Advanced Tape Reading", setupType: "Другой", confidenceLevel: 78, conditions: "Read Level 2 / Time & Sales to identify institutional activity. Large prints, hidden orders, and bid/ask dynamics reveal intent.", checklist: "- Watch Time & Sales for large prints (>10K shares)\n- Note bid/ask size imbalances on Level 2\n- Look for iceberg orders (repeated same-size prints)\n- Identify institutional accumulation vs distribution\n- Entry when tape confirms your directional bias\n- Stop if tape reading thesis is invalidated", notes: "Tape reading is the original edge. Before charts, traders read the tape. Large prints at the ask = buying pressure. Large prints at the bid = selling pressure. SMB Capital considers tape reading a core skill." },
    { name: "Dark Pool Print — Hidden Liquidity", folder: "Advanced Tape Reading", setupType: "Другой", confidenceLevel: 65, conditions: "Unusually large dark pool prints signal institutional interest. Trade in direction of the largest prints when they cluster at a price level.", checklist: "- Monitor dark pool print data (Finra ADF, TRF)\n- Look for prints >100K shares\n- Note price level where prints cluster\n- If prints at/above ask = bullish\n- If prints at/below bid = bearish\n- Use as confirmation, not primary signal\n- Combine with chart pattern for entry", notes: "Dark pools account for ~40% of US equity volume. Large institutional orders often execute there to avoid market impact. When you can see these prints, you're seeing what smart money is doing." },
    { name: "Level 2 Spoofing Detection", folder: "Advanced Tape Reading", setupType: "Другой", confidenceLevel: 60, conditions: "Detect spoofing on Level 2 — large orders that appear and disappear to manipulate price. Trade opposite the spoof direction.", checklist: "- Watch for large bid/ask orders that repeatedly cancel\n- Spoof orders usually >50K shares on illiquid stocks\n- Note if price moves toward the spoof, then spoof is removed\n- Real orders get filled, spoof orders get cancelled\n- If large bid keeps disappearing = fake support = bearish\n- If large ask keeps disappearing = fake resistance = bullish\n- Use tape confirmation before entry", notes: "Spoofing is illegal but still occurs, especially on small/mid cap stocks. Recognizing it gives you an edge because you understand which levels are real and which are fake. Key: real orders absorb volume, spoof orders run." },
    { name: "Mean Reversion — Oversold Bounce", folder: "Mean Reversion Plays", setupType: "Reversal", confidenceLevel: 72, conditions: "Stock drops >3 standard deviations from its mean (20-day MA). Statistical probability favors a bounce. Long the oversold condition.", checklist: "- Stock >3 StdDev below 20-day MA\n- RSI < 20 on daily chart\n- No fundamental catalyst for further downside\n- Volume exhaustion (decreasing on sell-off)\n- Entry on first green candle after selling exhaustion\n- Stop below recent low\n- Target: 20-day MA (mean)", notes: "Mean reversion works because extreme moves are statistically unsustainable. However, key filter: avoid stocks with ongoing fundamental deterioration (bankruptcy risk, fraud, etc.). Best on large-cap with temporary panic." },
    { name: "Rubber Band Snap — Extended Stock Reversal", folder: "Mean Reversion Plays", setupType: "Reversal", confidenceLevel: 68, conditions: "Stock stretched far from VWAP or moving average like a rubber band. Trade the snap-back to the mean when momentum exhausts.", checklist: "- Stock >2% from VWAP (intraday) or >5% from 20MA (daily)\n- Momentum indicators showing divergence\n- Volume decreasing on the extension\n- Candle pattern showing reversal (doji, hammer, engulfing)\n- Entry on reversal confirmation\n- Stop beyond the extreme\n- Target: VWAP or moving average", notes: "The rubber band analogy: the further a stock stretches from its mean, the more energy is stored for the snap-back. Works best when the extension is on declining volume — showing exhaustion rather than genuine trend." },
    { name: "Pairs Trade — Relative Value", folder: "Mean Reversion Plays", setupType: "Другой", confidenceLevel: 75, conditions: "Two correlated stocks diverge. Long the underperformer, short the outperformer. Profit when the spread reverts to mean.", checklist: "- Identify correlated pair (same sector, similar business)\n- Calculate historical spread (ratio or price difference)\n- Wait for spread to reach 2+ StdDev from mean\n- Long the laggard, short the leader (equal dollar amounts)\n- Monitor correlation — if it breaks, exit\n- Target: spread returns to mean\n- Max hold: 5-10 days", notes: "Pairs trading is market-neutral — you profit from the relative move, not the absolute direction. Classic pairs: XOM/CVX, GOOGL/META, JPM/BAC. Risk: the correlation can break permanently (structural change)." },
    { name: "Gap Fill — Statistical Edge", folder: "Gap Trading", setupType: "Gap", confidenceLevel: 70, conditions: "Most gaps fill within 1-3 days (statistical tendency). Trade the gap fill when conditions support mean reversion back to prior close.", checklist: "- Gap without strong catalyst (earnings, FDA excluded)\n- Gap size < 5% (large gaps less likely to fill same day)\n- Pre-market volume normal (not elevated)\n- If gap up: short toward prior close\n- If gap down: long toward prior close\n- Entry after first 15 min (avoid opening volatility)\n- Stop beyond gap extreme\n- Target: prior day close (full fill)", notes: "Statistical studies show ~70% of gaps eventually fill. However, catalyst-driven gaps (earnings, FDA) fill less often. Best gap fill trades are on 'nothing' gaps — gap on no real news, just overnight drift." },
    { name: "Gap and Trap — False Breakout", folder: "Gap Trading", setupType: "Gap", confidenceLevel: 72, conditions: "Stock gaps up through resistance but immediately sells off. The gap traps breakout buyers. Short the trapped longs as they panic.", checklist: "- Stock gaps above key resistance level\n- First 15 minutes: selling pressure emerges\n- Stock falls back below resistance (now support becomes resistance)\n- Trapped longs begin to panic sell\n- Entry short on break below gap low or key level\n- Volume increases on the reversal\n- Stop above gap high\n- Target: prior support or gap fill", notes: "Gap and Trap is the opposite of Gap and Go. It works because breakout buyers get trapped when the gap fails. Their stop-loss selling accelerates the move down. Best when the gap is on weak catalyst or into major resistance." },
    { name: "Exhaustion Gap — Reversal Signal", folder: "Gap Trading", setupType: "Gap", confidenceLevel: 65, conditions: "After an extended multi-day move, a final gap in the trend direction signals exhaustion. Trade the reversal.", checklist: "- Stock has moved >20% in one direction over 3-5 days\n- Final gap in the same direction (up gap after rally, down gap after selloff)\n- Volume highest of the entire move\n- Intraday reversal candle forms (shooting star, doji)\n- Entry on reversal confirmation\n- Stop above/below exhaustion gap extreme\n- Target: 38-50% retrace of entire move", notes: "Exhaustion gaps are one of the most reliable reversal signals in technical analysis. They represent the last burst of momentum before the trend reverses. Key identifier: the gap comes AFTER a multi-day move, not at the beginning." },
    { name: "Multi-Day Breakout — Weekly Range Expansion", folder: "Swing Trading Setups", setupType: "Breakout", confidenceLevel: 76, conditions: "Stock breaks out of a weekly/monthly range on catalyst. Hold for multi-day measured move. Wider stops, bigger targets.", checklist: "- Tight weekly range (Bollinger Bands squeezing)\n- Breakout on catalyst with volume >2x average\n- Close above range high (weekly candle)\n- Entry on pullback to breakout level\n- Stop below breakout level (former resistance = new support)\n- Target: measured move (range height added to breakout)\n- Hold time: 3-15 days", notes: "Weekly range breakouts capture larger moves than intraday trades. The tight range = low volatility, which precedes high volatility (regime change). Best combined with fundamental catalyst." },
    { name: "Moving Average Crossover — Trend Change", folder: "Swing Trading Setups", setupType: "Другой", confidenceLevel: 63, conditions: "8/21 EMA crossover on daily chart signals trend change. Enter in direction of the cross with swing time frame.", checklist: "- 8 EMA crosses above 21 EMA = bullish\n- 8 EMA crosses below 21 EMA = bearish\n- Volume confirms crossover\n- Wait for pullback to 8 EMA after cross\n- Entry on bounce off 8 EMA in crossover direction\n- Stop: below 21 EMA\n- Target: prior swing high/low or Fibonacci extension\n- Hold: 5-20 days", notes: "EMA crossovers lag by nature but filter noise. The 8/21 combo captures trend changes faster than 50/200. Best used as a trend filter — take only long setups when 8>21, short setups when 8<21." },
    { name: "Fibonacci Retracement — Measured Pullback", folder: "Swing Trading Setups", setupType: "Breakout", confidenceLevel: 71, conditions: "Stock in trend pulls back to key Fibonacci level (38.2%, 50%, 61.8%). Enter at Fib level with stop below next Fib.", checklist: "- Identify clear trend (impulse move)\n- Draw Fibonacci from swing low to swing high (uptrend)\n- Wait for pullback to 38.2%, 50%, or 61.8% level\n- Look for reversal candle at Fib level\n- Volume should decrease on pullback\n- Entry on bounce from Fib with volume\n- Stop below next Fib level\n- Target: retest of prior high or 1.618 extension", notes: "Fibonacci levels are self-fulfilling because so many traders use them. The 61.8% level is especially powerful — it's the 'golden ratio' pullback. If price holds 61.8%, the trend is likely intact. Below 78.6% = trend likely failed." },
    { name: "Earnings Whisper — Pre-Earnings Position", folder: "Earnings Strategies", setupType: "Другой", confidenceLevel: 58, conditions: "Accumulate position before earnings when technical setup + whisper numbers suggest upside surprise. Small size for binary risk.", checklist: "- Earnings within 1-3 days\n- Technical setup bullish (above MAs, tight range)\n- Options IV < historical norm (cheap options)\n- Whisper number higher than consensus\n- Revenue growth trend positive\n- Entry: small position (25-50% normal size)\n- Define max loss BEFORE entry\n- Exit plan for both scenarios", notes: "Pre-earnings positions are high-risk binary trades. SMB teaches: if you trade earnings, use reduced size and define your max loss before entry. The best risk/reward comes when options IV is below average — you're getting paid less for the uncertainty." },
    { name: "Post-Earnings Drift (PEAD) — Follow Surprise", folder: "Earnings Strategies", setupType: "Другой", confidenceLevel: 74, conditions: "After earnings surprise, stock continues drifting in the direction of the surprise for days/weeks. Trade the drift, not the gap.", checklist: "- Significant earnings surprise (>10% above/below estimates)\n- Initial gap confirmed by volume\n- Wait for first pullback (don't chase the gap)\n- Entry on pullback in direction of surprise\n- Positive surprise: long pullback to VWAP/21EMA\n- Negative surprise: short bounce to VWAP/21EMA\n- Hold: 5-20 days\n- Trail stop using 8 EMA daily", notes: "Post-Earnings Announcement Drift (PEAD) is one of the most well-documented anomalies in finance. Studies show stocks continue moving in the direction of the earnings surprise for 60+ days. The market underreacts to earnings surprises." },
    { name: "Earnings Range Anticipation — Straddle Alternative", folder: "Earnings Strategies", setupType: "Другой", confidenceLevel: 50, conditions: "Anticipate the earnings range based on implied move. Trade the break of that range rather than guessing direction.", checklist: "- Calculate expected move from options (straddle price)\n- Mark expected range (close +/- expected move)\n- After earnings: if price exceeds expected range = continuation\n- If price within expected range = mean reversion to close\n- Entry on confirmation of scenario\n- Stop based on expected range boundary\n- Target: 1.5x expected move (if exceeded) or prior close (if within)", notes: "Instead of guessing earnings direction, this framework uses the options market's expected move as a roadmap. When the actual move exceeds expectations, momentum is real. When it stays within, the move is priced in." },
    { name: "Sector Rotation — Follow the Money", folder: "Macro & Sector Plays", setupType: "Другой", confidenceLevel: 72, conditions: "Money rotates between sectors based on economic cycle. Identify which sectors are receiving inflows and trade the leaders.", checklist: "- Monitor sector ETF relative performance (XLF, XLE, XLK, etc.)\n- Identify sector showing 3+ days of outperformance\n- Find leading stocks within that sector\n- Entry on pullback in the leading stock\n- Confirm with sector ETF still trending\n- Stop if sector rotation reverses\n- Target: sector trend continuation", notes: "Sector rotation is driven by institutional portfolio rebalancing. When the economy shifts, trillions of dollars rotate. Early identification = riding the institutional wave. Track XL_ ETFs daily for rotation signals." },
    { name: "Fed Day / FOMC — 2:00 PM Reversal", folder: "Macro & Sector Plays", setupType: "Другой", confidenceLevel: 62, conditions: "FOMC announcement at 2:00 PM ET. Initial move often reverses. Wait for the 'whipsaw' and trade the real direction.", checklist: "- No new positions before 2:00 PM on FOMC day\n- Note initial reaction direction at 2:00 PM\n- Wait 15-30 minutes for the 'whipsaw'\n- If initial move reverses = trade the reversal\n- If initial move continues with volume = trade continuation\n- Reduce size (FOMC = volatile)\n- Stop tight (FOMC moves are fast)\n- Close all FOMC trades by end of day", notes: "FOMC days have a well-known pattern: initial spike at 2:00 PM, then reversal, then the 'real' move. The initial reaction is often wrong because algorithms react to headlines before the full statement is analyzed. Patience is key." },
    { name: "CPI / Jobs Report — Morning Gap Framework", folder: "Macro & Sector Plays", setupType: "Другой", confidenceLevel: 67, conditions: "Major economic data (CPI, NFP, PPI) released at 8:30 AM ET. Creates significant gaps. Trade the gap framework after open.", checklist: "- Note data release at 8:30 AM (pre-market)\n- Calculate gap vs expectations\n- If data better than expected = bullish gap (usually)\n- If data worse = bearish gap\n- Wait for market open, don't pre-market trade\n- Apply Gap and Go or Gap Fill framework\n- Sector impact: CPI → tech/growth, Jobs → financials\n- Reduce size on macro days", notes: "Macro data days create the biggest moves because they affect ALL stocks simultaneously. CPI and jobs data move the entire market. Key: don't trade the data, trade the reaction to the data. The same CPI number can be bullish or bearish depending on context." },
    { name: "Dollar Cost Into Winner — Pyramiding", folder: "Position Management", setupType: "Другой", confidenceLevel: 80, conditions: "When trade is working, add to the position (pyramid) at predetermined levels. Maximize winners, don't just take profit.", checklist: "- Initial entry at planned level (full or partial)\n- First add: after breakout confirms (price + volume)\n- Second add: on first pullback that holds\n- Each add is smaller than the previous\n- Move stop to breakeven after first add\n- Trail stop to lock in profits on adds\n- Never add to losers\n- Max position: 3 tiers", notes: "Pyramiding into winners is how prop traders maximize their best trades. SMB calls this 'pressing your winners.' The key: each add must be smaller, and the stop must move up. Never average down — that's the opposite of this strategy." },
    { name: "Scaling Out — Tiered Profit Taking", folder: "Position Management", setupType: "Другой", confidenceLevel: 85, conditions: "Instead of all-or-nothing exits, scale out in tiers. Take 1/3 at first target, 1/3 at second, trail the rest.", checklist: "- Before entry: define 3 target levels\n- Target 1 (1R): take 1/3 off, move stop to breakeven\n- Target 2 (2R): take 1/3 off, trail stop\n- Target 3 (3R+): trail remaining 1/3 with tight stop\n- If stop hits before T1: full loss (acceptable)\n- Result: winners are bigger, losers are controlled\n- Track average R-multiple", notes: "Scaling out is a risk management technique that ensures you capture profits while keeping upside potential. The psychology: taking partial profits reduces the urge to close the entire position too early." },
    { name: "Max Loss Day Rule — Circuit Breaker", folder: "Position Management", setupType: "Другой", confidenceLevel: 95, conditions: "Hard daily loss limit. When reached, STOP TRADING. No exceptions. This is the most important risk management rule.", checklist: "- Set max daily loss (e.g., $500 or 2% of account)\n- Track P&L in real-time\n- At 50% of max loss: reduce size by half\n- At 75% of max loss: only A+ setups\n- At 100% of max loss: STOP. Walk away.\n- Review losing trades end of day\n- NO revenge trading\n- Reset next day fresh", notes: "The max loss day rule is NON-NEGOTIABLE. Every prop firm enforces this. Without it, one bad day can destroy a month of profits. SMB Capital says: 'Live to trade another day.' The market will be there tomorrow." },
  ];

  const opgImbxMocStrategies = [
    { name: "OPG — Opening Price Guarantee Order", folder: "OPG / Auction Plays", setupType: "OPG", confidenceLevel: 75, conditions: "Use OPG (Market-On-Open) order to participate in the NYSE/NASDAQ opening auction. Capture the opening print when catalyst is clear overnight.", checklist: "- Strong overnight catalyst (earnings, news, upgrade)\n- Pre-market direction is clear and consistent\n- Submit OPG order before 9:28 AM ET\n- Size: 50% of normal (auction risk)\n- OPG executes only at the opening print\n- If no fill, order cancels automatically\n- Review fill vs pre-market price\n- Manage position from open", notes: "OPG orders guarantee you participate in the opening auction at the official opening price. This is how institutions enter positions. Advantage: no slippage from the open, you get the exact opening print. Best on gap days with clear catalyst." },
    { name: "OPG Gap Fade — Auction Reversal", folder: "OPG / Auction Plays", setupType: "OPG", confidenceLevel: 68, conditions: "Stock gaps significantly on weak catalyst. OPG order to fade the gap — enter opposite direction at the open, expecting gap fill.", checklist: "- Gap >3% but catalyst is weak or already priced in\n- Pre-market volume is moderate (not extreme)\n- No institutional upgrades/downgrades\n- Submit OPG order to fade gap direction\n- Size: 25-50% of normal\n- Target: gap fill (prior close)\n- Stop: beyond gap extreme +0.5%\n- Time limit: close by lunch if not working", notes: "Fading gaps at the open is risky but statistically favorable when the catalyst is weak. The OPG order ensures you get the exact opening price. Key: only fade gaps with no fundamental reason. Earnings/FDA gaps should NOT be faded." },
    { name: "OPG Momentum — Opening Auction Breakout", folder: "OPG / Auction Plays", setupType: "OPG", confidenceLevel: 72, conditions: "Use OPG to ride momentum when opening auction price will be significantly different from prior close. Follow the smart money flow.", checklist: "- Pre-market shows strong directional bias\n- Imbalance data (if available) confirms direction\n- Submit OPG in direction of momentum\n- Immediately set stop after fill\n- Target 1: first 5-min range extreme\n- Target 2: VWAP or prior resistance/support\n- Scale out in thirds\n- Best on In Play stocks with catalyst", notes: "OPG momentum captures the institutional order flow at the open. When there's a clear imbalance (more buy than sell orders), the opening price adjusts up and the momentum continues. Getting in at the auction = best possible entry." },
    { name: "IMBX — Opening Imbalance Long", folder: "Imbalance (IMBX) Strategies", setupType: "Imbalance", confidenceLevel: 74, conditions: "NYSE/NASDAQ publish order imbalance data at 9:20 AM. Significant buy imbalance (IMBX > 500K shares) signals strong opening demand. Long into the imbalance.", checklist: "- Check imbalance data starting at 9:20 AM\n- Buy imbalance > 500K shares = significant\n- Confirm catalyst supports the direction\n- Entry via OPG order or first pullback after open\n- Imbalance should be consistent (not flipping)\n- Watch for paired-off vs total imbalance ratio\n- Stop: if imbalance reverses or VWAP breaks\n- Target: morning high or prior resistance", notes: "Order imbalance data is public and published by exchanges. A large buy imbalance means there are significantly more buy orders than sell orders for the open. This creates upward pressure on the opening price. Prop firms monitor this data religiously." },
    { name: "IMBX — Opening Imbalance Short", folder: "Imbalance (IMBX) Strategies", setupType: "Imbalance", confidenceLevel: 74, conditions: "Significant sell imbalance (IMBX > 500K shares on sell side) at 9:20 AM. Strong selling pressure expected at open. Short into the imbalance.", checklist: "- Sell imbalance > 500K shares at 9:20+ AM\n- Confirm negative catalyst (earnings miss, downgrade)\n- Entry via OPG short or first bounce after open\n- Imbalance should be consistent and growing\n- Watch 9:28 AM final imbalance (most reliable)\n- Stop: if imbalance reverses significantly\n- Target: morning low or gap fill\n- Close by midday if not working", notes: "Sell imbalances create supply/demand asymmetry at the open. Institutions are net sellers and the opening price adjusts down. Key: the 9:28 AM imbalance is the most reliable — earlier readings can flip." },
    { name: "IMBX Fade — Imbalance Reversal", folder: "Imbalance (IMBX) Strategies", setupType: "Imbalance", confidenceLevel: 58, conditions: "When opening imbalance is extreme but reverses by 9:28 AM, the initial move often reverses. Fade the expected direction.", checklist: "- Large imbalance at 9:20 (>1M shares one direction)\n- By 9:28 AM imbalance reduces significantly or flips\n- This signals the imbalance was absorbed / crossed\n- Trade opposite the original imbalance direction\n- Wait for open, then entry on reversal candle\n- Small size (counter-trend play)\n- Stop tight — opposite side of opening range\n- Target: VWAP", notes: "Imbalance fades are advanced plays. When a large buy imbalance at 9:20 gets paired off by 9:28, it means the selling interest absorbed the demand. The opening may still pop up, but it quickly reverses. This is a trap for imbalance-only traders." },
    { name: "IMBX + VWAP Confirmation", folder: "Imbalance (IMBX) Strategies", setupType: "Imbalance", confidenceLevel: 80, conditions: "Combine imbalance data with VWAP direction. When opening imbalance aligns with VWAP trend (stock opens above/below VWAP in same direction as imbalance), the signal is strongest.", checklist: "- Buy imbalance + stock above developing VWAP = strong long\n- Sell imbalance + stock below developing VWAP = strong short\n- Entry on first pullback to VWAP after open\n- Volume must confirm direction\n- Contradictory signals (buy imbalance but below VWAP) = no trade\n- Stop: VWAP cross\n- Target: prior day level or measured move\n- This is a high-probability A+ setup when aligned", notes: "Combining two institutional signals (imbalance + VWAP) creates a high-probability setup. Institutions use both VWAP and auction data. When they agree, you're aligned with smart money. When they contradict, stay flat." },
    { name: "MOC — Market On Close Order", folder: "MOC / Closing Auction", setupType: "Другой", confidenceLevel: 76, conditions: "Use MOC (Market-On-Close) order to participate in the NYSE closing auction. Capture the closing print for next-day gap positioning.", checklist: "- MOC orders must be submitted by 3:45 PM ET (NYSE) or 3:50 PM (NASDAQ)\n- Determine direction based on day's trend (above/below VWAP)\n- Size: 50% of normal for overnight risk\n- MOC guarantees fill at official closing price\n- Cannot cancel after 3:45 PM deadline\n- Best for next-day catalyst plays (earnings AH, overnight events)\n- Review closing imbalance data at 3:45 PM\n- Set overnight stop-loss alert", notes: "MOC orders are used by institutions to execute at the closing price — the most important price of the day. For prop traders, MOC is useful when you want to hold overnight and want the best closing price without chasing." },
    { name: "MOC Imbalance — Closing Auction Play", folder: "MOC / Closing Auction", setupType: "Другой", confidenceLevel: 73, conditions: "NYSE publishes closing imbalance data at 3:45 PM. Large MOC imbalances create predictable price moves into the close. Trade the last 15 minutes.", checklist: "- Check closing imbalance at 3:45 PM ET\n- Buy imbalance > 500K shares = bullish into close\n- Sell imbalance > 500K shares = bearish into close\n- Entry at 3:45-3:50 PM in direction of imbalance\n- Price typically moves toward imbalance direction\n- Quick trade: entry 3:45, exit at close or MOC\n- No overnight hold required\n- Best on index rebalance / options expiration days", notes: "Closing imbalances are the most predictable short-term trades in the market. Index funds, ETFs, and institutional rebalancing create massive order imbalances at the close. On rebalancing days, these can be >$2B. The price MUST adjust to fill these orders." },
    { name: "MOC Fade — Closing Reversal", folder: "MOC / Closing Auction", setupType: "Другой", confidenceLevel: 60, conditions: "After an extreme closing imbalance pushes price, the next morning often sees a reversal. Fade the closing auction move at next open.", checklist: "- Large closing imbalance pushed price >0.5% in last 15 min\n- The move was mechanical (rebalance) not fundamental\n- Next day: fade the closing move direction\n- Entry: at open or first 15 min of next day\n- Target: prior day's 3:45 PM price (pre-imbalance level)\n- Stop: beyond closing price\n- Works best on quarterly rebalance days\n- Avoid if fundamental catalyst exists", notes: "Closing imbalances are mechanical — index funds MUST buy or sell regardless of price. This creates artificial moves that often reverse the next morning when the forced buying/selling is done. Key: only fade mechanical moves, not fundamental ones." },
    { name: "MOC + Options Expiration — Pin Risk Play", folder: "MOC / Closing Auction", setupType: "Другой", confidenceLevel: 62, conditions: "On options expiration (monthly/weekly), stocks tend to 'pin' to strike prices with maximum open interest. Trade the pin into the close.", checklist: "- Identify max pain / highest OI strike price\n- After 2:00 PM on OPEX day, monitor price vs strike\n- If stock near high-OI strike, expect pinning action\n- Trade toward the pin strike (mean reversion to strike)\n- MOC order at the pin strike if profitable\n- Size small — pinning is not guaranteed\n- Works best on large-cap with high options volume\n- Close all positions at market close", notes: "Options expiration pinning occurs because market makers hedge their delta by buying/selling stock. As options expire, this hedging creates mean-reversion toward the highest open interest strike. This effect is strongest in the last 2 hours of OPEX day." },
  ];

  const seedTags: Record<string, string> = {
    "ATM Offering Play — Short": "Offering Play,ATM Offering,Fade Trade,VWAP Rejection,Offering,ATM,S-1 Filing,High Relative Volume,Volume Spike",
    "Pricing Play — Long Bounce": "Offering Play,Post-Offering Bounce,Reversal,VWAP Bounce,Offering,Pricing,Offering Price",
    "Gap and Go — Earnings Momentum": "Gap and Go,Earnings Gap Up,ORB,Trend Continuation,Earnings Beat,Revenue Beat,VWAP,Opening Range High,High Relative Volume",
    "IPO Day Trade — First Day Play": "IPO Trade,ORB,Breakout,Opening Range High,Opening Range Low,IPO Stock,Recent IPO (<6mo),High Relative Volume",
    "Second Day Play — Momentum Continuation": "Second Day Play,Trend Continuation,Breakout,Gap Up,HOD,Yesterday High,High Relative Volume",
    "VWAP Trend Trade — Intraday": "VWAP Trend,VWAP Bounce,VWAP Hold Long,Pullback Trade,Intraday Momentum,VWAP,Trending Day",
    "Parabolic Short — Extended Stock": "Parabolic Short,Blow-Off Top Short,Exhaustion Short,Reversal,HOD,Low Float (<10M),High Relative Volume,Volume Spike",
    "Opening Range Breakout (ORB)": "ORB,ORB 5min,ORB 15min,Breakout,Opening Range High,Opening Range Low,First 15min,First 30min,Volume Spike",
    "Low Float Momentum — Float Rotation": "Intraday Momentum,Runner,Breakout,Bull Flag,Low Float (<10M),Extremely Low Float (<2M),High Relative Volume,Volume Spike",
    "Failed Follow Through — Bear Flag Short": "Failed Follow Through,Bear Flag,Reversal,Dead Cat Bounce,Short,Yesterday High,Low Volume",
    "Short Squeeze Play": "Short Squeeze,Intraday Momentum,Breakout,High Short Interest (>20%),High Relative Volume,Volume Spike,Gap Up",
    "Sympathy Play — Sector Follower": "Sympathy Play,Sector Rotation Play,Intraday Momentum,Breakout,Sector Leading,Sector Rotation",
    "Halt & Resume Play": "Halt & Resume,Breakout,Reversal,High Relative Volume,Volume Spike,High Volatility",
    "Anchored VWAP — Earnings / IPO Level": "VWAP Bounce,VWAP Rejection,Breakout,Anchored VWAP,Earnings Beat,IPO Stock,Daily Support,Daily Resistance",
    "9 EMA Daily — Swing Entry на Trend": "Pullback Trade,Swing Hold,Trend Continuation,EMA9,Daily Support,Trending Day",
    "Dead Cat Bounce — Short the Recovery": "Dead Cat Bounce,Reversal,Fade Trade,Short,Earnings Miss,Analyst Downgrade,VWAP,Daily Resistance",
    "High of Day Break — Momentum Ignition": "Breakout,Momentum Ignition,HOD,Flat Top Breakout,Volume Spike,High Relative Volume,Trending Day",
    "News Fade — Sell/Short the News": "Fade Trade,News Spike Fade,Reversal,Short,Breaking News,Analyst Upgrade,VWAP",
    "In Play Stock Framework — Отбор акций": "Gap Up,Gap Down,High Relative Volume,Volume Spike,Breaking News,Earnings Beat",
    "Power Hour Momentum — 3:00–4:00 PM": "Intraday Momentum,VWAP Trend,Trend Continuation,Power Hour,Last Hour,VWAP",
    "Pre-Market Gap Scan — Watchlist Build": "Gap Up,Gap Down,Premarket,Premarket High,Premarket Low,High Relative Volume",
    "After Hours Earnings React — Next Day Prep": "Earnings Gap Up,Earnings Gap Down,Second Day Play,After Hours,Earnings Beat,Earnings Miss",
    "Overnight Hold — Swing Catalyst": "Swing Hold,Overnight Hold Gap,Multi-Day Momentum,Earnings Beat,FDA Approval",
    "Tape Reading — Order Flow Entry": "Tape Reading Entry,Level 2 Entry,Dark Pool Print,Block Trade Follow,High Relative Volume",
    "Dark Pool Print — Hidden Liquidity": "Dark Pool Print,Block Trade Follow,Tape Reading Entry,Dark Pool Level,Dark Pool Volume",
    "Level 2 / Order Book Reading": "Tape Reading Entry,Level 2 Entry,Full Size,High Relative Volume",
    "Exhaustion Print — Volume Climax": "Exhaustion Short,Blow-Off Top Short,Reversal,Volume Spike,HOD,High Volatility",
    "RSI Oversold Bounce — Mean Reversion": "RSI Oversold Bounce,Mean Reversion,Reversal,Bollinger Band Bounce,Daily Support,LOD,Low Volatility",
    "Bollinger Band Squeeze → Expansion": "Bollinger Band Bounce,Mean Reversion,Breakout,Range Expansion,Low Volatility,Narrow Range Break (NR7)",
    "Pairs Trade — Long / Short Hedge": "Pairs Trade,Relative Value,ETF Arbitrage,Hedged Swing,Sector Rotation",
    "Gap Fill Strategy — Intraday Reversion": "Gap Fill,Mean Reversion,Gap Up,Gap Down,VWAP,Gap Fill Level,Open Price",
    "Gap Up Continuation — Trend Follow": "Gap and Go,Gap and Go Long,Trend Continuation,Breakout,Gap Up,Earnings Beat,VWAP,Opening Range High",
    "Gap Down Reversal — Catch the Bounce": "Gap Fill,Reversal,Red to Green,Gap Down,LOD,VWAP Reclaim,Volume Spike",
    "Earnings Gap Down Short — Continuation": "Earnings Gap Down,Gap and Go Short,Trend Continuation,Short,Earnings Miss,Guidance Down,VWAP,Daily Resistance",
    "Swing Breakout — Weekly Range": "Weekly Breakout,Breakout,Swing Hold,Multi-Day Momentum,52-Week High,Weekly Resistance,High Relative Volume",
    "Swing Pullback — 20 SMA Bounce": "Pullback Trade,Swing Hold,Trend Continuation,SMA20,Daily Support,Normal Volume",
    "Swing Reversal — Double Bottom": "Double Bottom,Reversal,Swing Hold,V-Bottom Reversal,Daily Support,52-Week Low,Volume Spike",
    "Post-Earnings Drift (PEAD)": "Earnings Drift (PEAD),Post-Earnings Continuation,Trend Continuation,Swing Hold,Earnings Beat,Earnings Miss,High Relative Volume",
    "Pre-Earnings Volatility Play": "Pre-Earnings Run,Catalyst Anticipation,Swing Hold,Earnings Season,Unusual Options Activity",
    "Earnings Straddle — Volatility Capture": "Catalyst Anticipation,Pre-Earnings Run,Earnings Season,Unusual Options Activity,High Volatility",
    "Sector Rotation — Follow the Flow": "Sector Rotation Play,Relative Strength Trade,Macro Play,Sector Leading,Sector Lagging,Sector Rotation",
    "Macro Catalyst Trade — FOMC / CPI / NFP": "Macro Play,Fundamental / Catalyst Trade,FOMC,CPI,NFP,Interest Rate,Fed Day,VIX Spike",
    "Correlation Trade — Sector ETF + Stock": "Pairs Trade,ETF Arbitrage,Relative Value,Sector Rotation,SPY Above VWAP,QQQ Leading",
    "Scaling — Pyramid Into Winners": "Pyramid Into Winner,Add to Winner,Scale In,Pyramided In,Added on Confirmation,Trending Day",
    "Risk Unit Framework — Max Loss / Day": "Cut Loss Fast,Stopped Out,No Stop Set,Over-Sized,Bad Risk/Reward,Discipline Win",
    "Partial Profit — Trail Stop System": "Scale Out,Partial Profit,Trail Stop,Scaled Out Well,Let Runner Run,Full Target Hit",
    "OPG — Стандартный Opening Imbalance": "Opening Imbalance (OPG),Imbalance,ORB,Open Drive,First 15min,Volume Spike,High Relative Volume",
    "OPG — Fade Large Imbalance": "Opening Imbalance (OPG),Imbalance,Fade Trade,Reversal,Open Drive,First 15min,VWAP",
    "OPG — Index Arbitrage at Open": "Opening Imbalance (OPG),ETF Arbitrage,Pairs Trade,Open Drive,SPY Above VWAP,First 15min",
    "OPG — Sector ETF Imbalance": "Opening Imbalance (OPG),Sector Rotation Play,ETF Arbitrage,Sector Leading,First 15min",
    "IMBX — Continuous Book Imbalance": "Imbalance,Tape Reading Entry,Level 2 Entry,Intraday Momentum,Trending Day",
    "IMBX — Bid Stack Fade (Large Passive Seller)": "Imbalance,Fade Trade,Tape Reading Entry,Level 2 Entry,Dark Pool Print",
    "IMBX — Ask Stack Break (Hidden Buyer)": "Imbalance,Breakout,Tape Reading Entry,Level 2 Entry,Dark Pool Print,Volume Spike",
    "IMBX + VWAP Confluence": "Imbalance,VWAP Bounce,VWAP Rejection,Tape Reading Entry,VWAP,Trending Day",
    "MOC — Standard Closing Imbalance Trade": "MOC Imbalance,Closing Cross Play,Imbalance,Last Hour,Power Hour",
    "MOC — Large Imbalance Fade (Next Day)": "MOC Imbalance,Closing Cross Play,Fade Trade,Reversal,Last Hour,Gap Down",
    "MOC Fade — Closing Reversal": "MOC Imbalance,Closing Cross Play,Fade Trade,Reversal,Last Hour,Power Hour",
    "MOC + Options Expiration — Pin Risk Play": "MOC Imbalance,Closing Cross Play,Imbalance,OPEX Day,Last Hour,Round Number",
  };

  const allSeedStrategies = [...smbStrategies, ...additionalStrategies, ...opgImbxMocStrategies];
  let seeded = 0;
  for (const s of allSeedStrategies) {
    try {
      const tags = seedTags[s.name] || null;
      const { rowCount } = await pool.query(
        `INSERT INTO playbook (name, folder, setup_type, conditions, checklist, notes, confidence_level, tags)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
         WHERE NOT EXISTS (SELECT 1 FROM playbook WHERE name = $1 AND deleted_at IS NULL)`,
        [s.name, s.folder, s.setupType, s.conditions, s.checklist, s.notes, s.confidenceLevel, tags]
      );
      if (rowCount && rowCount > 0) seeded++;
    } catch (e: any) { logger.warn({ error: e.message }, `Seed playbook: ${s.name}`); }
  }

  if (seeded === 0) {
    let tagUpdated = 0;
    for (const s of allSeedStrategies) {
      const tags = seedTags[s.name];
      if (!tags) continue;
      try {
        const { rowCount } = await pool.query(
          `UPDATE playbook SET tags = $1 WHERE name = $2 AND (tags IS NULL OR tags = '') AND deleted_at IS NULL`,
          [tags, s.name]
        );
        if (rowCount && rowCount > 0) tagUpdated++;
      } catch (e: any) { logger.warn({ error: e.message }, `Update tags: ${s.name}`); }
    }
    if (tagUpdated > 0) logger.info(`Updated tags for ${tagUpdated} existing strategies`);
  }
  if (seeded > 0) {
    logger.info(`Seeded ${seeded} new playbook strategies (${allSeedStrategies.length - seeded} already existed)`);
  } else {
    logger.info(`All ${allSeedStrategies.length} playbook strategies already exist, skipping seed`);
  }

  logger.info("Database migrations completed");
}
