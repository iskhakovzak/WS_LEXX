import { pool } from "@workspace/db";
import { logger } from "./logger";
import { config } from "../config";
import { markSeedDone, seedDone } from "./seedMarkers";

/**
 * Boot-time seeds and data repairs, no DDL: the schema lives only in src/db/migrations (0234 adopted the tables the code
 * used to create here and in the old ensure*() helpers); src/db/runner.ts applies the migrations before this runs.
 *   - legacy playbook text checklists / screenshot lists -> jsonb (idempotent, only rows still NULL)
 *   - first accounts from SEED_USERS (random dev PINs outside production) on an empty users table
 *   - SMB strategy playbook entries + their tags ONCE per database (seed_markers), playbook space/visibility for rows without them
 *   - the default pre-trade checklist on an empty template
 */
export async function runSeeds() {
  logger.info("Running boot seeds...");

  try {
    const { rows: legacy } = await pool.query<{ id: number; checklist: string | null; screenshot_url: string | null; screenshot_notes: string | null }>(
      `SELECT id, checklist, screenshot_url, screenshot_notes
       FROM playbook
       WHERE (checklist_items IS NULL AND checklist IS NOT NULL AND checklist != '')
          OR (screenshots IS NULL AND screenshot_url IS NOT NULL AND screenshot_url != '')`
    );
    let migratedChecklists = 0, migratedScreens = 0;
    for (const row of legacy) {
      if (row.checklist) {
        const items = row.checklist.split("\n")
          .map((l) => l.replace(/^[-•*]\s*/, "").trim())
          .filter(Boolean)
          .map((text) => {
            let h = 0;
            for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
            return { id: `t${(h >>> 0).toString(36)}`, text };
          });
        if (items.length > 0) {
          await pool.query(`UPDATE playbook SET checklist_items = $1::jsonb WHERE id = $2 AND checklist_items IS NULL`, [JSON.stringify(items), row.id]);
          migratedChecklists++;
        }
      }
      if (row.screenshot_url) {
        const urls = row.screenshot_url.split("\n").map((u) => u.trim()).filter(Boolean);
        let notes: string[] = [];
        if (row.screenshot_notes) {
          try {
            const parsed = JSON.parse(row.screenshot_notes);
            if (Array.isArray(parsed)) notes = parsed.map((n) => typeof n === "string" ? n : "");
          } catch {
            notes = row.screenshot_notes.split("\n");
          }
        }
        const items = urls.map((url, i) => ({ url, notes: notes[i] || "" }));
        if (items.length > 0) {
          await pool.query(`UPDATE playbook SET screenshots = $1::jsonb WHERE id = $2 AND screenshots IS NULL`, [JSON.stringify(items), row.id]);
          migratedScreens++;
        }
      }
    }
    if (migratedChecklists || migratedScreens) {
      logger.info(`Backfilled jsonb: ${migratedChecklists} checklists, ${migratedScreens} screenshot sets`);
    }

    const { rows: legacyIdRows } = await pool.query<{ id: number; checklist_items: any }>(
      `SELECT id, checklist_items FROM playbook
       WHERE checklist_items IS NOT NULL
         AND checklist_items::text LIKE '%"legacy-%'`
    );
    let reidCount = 0;
    for (const row of legacyIdRows) {
      if (!Array.isArray(row.checklist_items)) continue;
      const fixed = row.checklist_items.map((it: any) => {
        const text = String(it?.text ?? "").trim();
        if (!text) return null;
        let h = 0;
        for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
        return { id: `t${(h >>> 0).toString(36)}`, text };
      }).filter(Boolean);
      await pool.query(`UPDATE playbook SET checklist_items = $1::jsonb WHERE id = $2`, [JSON.stringify(fixed), row.id]);
      reidCount++;
    }
    if (reidCount) logger.info(`Re-IDed ${reidCount} playbook checklists to content-hash IDs`);
  } catch (e: any) {
    logger.warn({ error: e.message }, "Migration: backfill checklist_items/screenshots");
  }

  // Legacy playbook_trade_ideas: dropped when empty by src/db/migrations/0007_drop_playbook_trade_ideas.sql (the merge failed on every boot).

  // 2026-04-22 playbook restore window: src/db/migrations/0009_restore_playbook_20260422.sql.

  // Initial accounts come from SEED_USERS (JSON: [{"name","password","role"}]) — no PINs in the code.
  // Without it, a fresh dev DB gets the desk names with random 6-digit PINs that are NEVER logged (A1 security):
  // choose them with SEED_USERS, or set them later via an admin reset / POST /auth/init-passwords.
  const defaultUsers: { name: string; password: string; role: string }[] = (() => {
    try {
      const parsed = JSON.parse(config.seedUsers ?? "null");
      if (Array.isArray(parsed)) return parsed.filter((u) => u && typeof u.name === "string" && typeof u.password === "string");
    } catch (e: any) { logger.warn({ error: e.message }, "SEED_USERS is not valid JSON"); }
    if (config.isProduction) return [];
    const rand = () => String(Math.floor(100000 + Math.random() * 900000));
    return [
      { name: "Закир", role: "trader" }, { name: "Антон", role: "curator" }, { name: "Артур", role: "trader" },
      { name: "Рахматулло", role: "trader" }, { name: "Умид", role: "trader" }, { name: "Максат", role: "trader" },
      { name: "Тимур", role: "curator" }, { name: "Ориф", role: "curator" },
    ].map((u) => ({ ...u, password: rand(), generated: true }));
  })();
  const { rows: existingUsers } = await pool.query(`SELECT COUNT(*) as cnt FROM users`);
  if (Number(existingUsers[0]?.cnt) === 0) {
    logger.info("Seeding default users...");
    const bcrypt = (await import("bcryptjs")).default;
    for (const u of defaultUsers) {
      try {
        const hash = await bcrypt.hash(u.password, 10);
        await pool.query(`INSERT INTO users (name, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`, [u.name, hash, u.role]);
      } catch (e: any) { logger.warn({ error: e.message }, `Seed user ${u.name}`); }
    }
    if (defaultUsers.some((u: any) => u.generated)) {
      logger.info({ users: defaultUsers.map((u) => u.name) }, "Dev users seeded with random PINs (not logged; set SEED_USERS to choose them)");
    }
    logger.info("Default users seeded");
  } else {
    const { rows: nullHashUsers } = await pool.query(`SELECT name FROM users WHERE password_hash IS NULL`);
    if (nullHashUsers.length > 0) {
      logger.info({ count: nullHashUsers.length }, "Fixing users with NULL password_hash...");
      const bcrypt = (await import("bcryptjs")).default;
      for (const u of defaultUsers) {
        try {
          const hash = await bcrypt.hash(u.password, 10);
          await pool.query(
            `UPDATE users SET password_hash = $1 WHERE name = $2 AND password_hash IS NULL`,
            [hash, u.name]
          );
        } catch (e: any) { logger.warn({ error: e.message }, `Fix password for ${u.name}`); }
      }
      if (defaultUsers.some((u: any) => u.generated)) {
        const fixed = new Set(nullHashUsers.map((r: any) => r.name));
        logger.info({ users: defaultUsers.filter((u) => fixed.has(u.name)).map((u) => u.name) }, "Dev users got random PINs (not logged; set SEED_USERS to choose them)");
      }
      logger.info("NULL password_hash users fixed");
    }
  }

  const smbStrategies = [
    { name: "ATM Offering Play — Short", folder: "SMB Capital — Offering Plays", setupType: "other", confidenceLevel: 80, conditions: "Stock announces ATM offering (shelf registration). Price drops on dilution fear. Short into the bounce after initial panic selling.", checklist: "- ATM offering confirmed (SEC filing)\n- Price dropped >5% on news\n- Volume spike > 3x average\n- Wait for first bounce attempt\n- Entry on failed bounce / rejection at VWAP\n- Stop above pre-market high", notes: "One of SMB Capital's core plays. ATM offerings create sustained selling pressure as the company sells shares into the open market. Key: don't short the initial drop, wait for the bounce attempt and short the failure." },
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
    { name: "Halt & Resume Play", folder: "SMB Capital — Intraday Setups", setupType: "other", confidenceLevel: 65, conditions: "Stock gets halted (LULD halt or news halt). Trade the resume — either continuation or reversal depending on context.", checklist: "- Note halt type (LULD up/down, news pending)\n- During halt: assess catalyst, level 2, pre-halt momentum\n- On resume: wait 30 seconds for price discovery\n- If continuation: long above halt price (up halt) or short below (down halt)\n- If reversal: opposite direction after failed continuation\n- Use small size — halts = maximum volatility\n- Stop: opposite side of resume range", notes: "Halt resumes are some of the highest-volatility moments in trading. SMB teaches discipline: don't place orders during halt, wait for resume, let price discover, then act. Many traders get destroyed by blindly buying/shorting halts." },
    { name: "Anchored VWAP — Earnings / IPO Level", folder: "SMB Capital — Intraday Setups", setupType: "Breakout", confidenceLevel: 70, conditions: "Anchored VWAP from significant event (earnings, IPO, offering) acts as key support/resistance. Trade the reaction at this level.", checklist: "- Identify significant event date (earnings, IPO, offering)\n- Calculate anchored VWAP from that date\n- Wait for price to reach anchored VWAP level\n- Look for reaction (bounce or break)\n- Entry on confirmation of direction\n- Stop: other side of anchored VWAP\n- Target: next significant level", notes: "Anchored VWAP shows the average price paid by all participants since a significant event. Institutions track this level closely. It's especially powerful from earnings dates and IPO dates." },
    { name: "9 EMA Daily — Swing Entry на Trend", folder: "SMB Capital — Swing Setups", setupType: "Breakout", confidenceLevel: 74, conditions: "Stock in strong uptrend pulls back to 9 EMA on daily chart. This is the 'trend pullback' entry for swing traders.", checklist: "- Stock in clear uptrend (higher highs, higher lows)\n- Pullback to 9 EMA daily (within 1-2% of EMA)\n- Volume decreases on pullback\n- Entry on bounce off 9 EMA with volume\n- Stop: below 9 EMA or recent swing low\n- Target: prior high or measured move\n- Hold time: 2-10 days", notes: "The 9 EMA daily is SMB's favorite swing setup. It works because strong stocks rarely pull back more than 3-5 days before continuing. The 9 EMA captures this rhythm perfectly." },
    { name: "Dead Cat Bounce — Short the Recovery", folder: "SMB Capital — Short Setups", setupType: "Reversal", confidenceLevel: 68, conditions: "Stock drops sharply on bad news (earnings miss, downgrade). A weak bounce follows. Short the failed bounce.", checklist: "- Stock dropped >10% on negative catalyst\n- Weak bounce: low volume, doesn't reclaim VWAP\n- Bounce reaches resistance (prior support, moving average)\n- Entry on reversal from bounce high\n- Stop above bounce high\n- Target: retest of lows or new low", notes: "Dead cat bounces occur because: 1) Short covering, 2) Bottom fishers, 3) Algorithmic mean reversion. These bounces typically fail because the fundamental damage is real. SMB shorts these aggressively." },
    { name: "High of Day Break — Momentum Ignition", folder: "SMB Capital — Intraday Setups", setupType: "Breakout", confidenceLevel: 73, conditions: "Stock consolidates near HOD then breaks to new highs. This 'momentum ignition' triggers stops and algorithms, creating a powerful move.", checklist: "- Stock near HOD with tightening range\n- At least 2-3 tests of HOD level\n- Volume building on each test\n- Entry on break above HOD with volume surge\n- Stop below consolidation / last pullback low\n- Target: next resistance or measured move", notes: "HOD breaks are powerful because they trigger: 1) Buy stops from shorts, 2) Momentum algorithms, 3) Breakout traders. The combination creates a supply/demand imbalance that drives price higher quickly." },
    { name: "News Fade — Sell/Short the News", folder: "SMB Capital — Reversal Setups", setupType: "Reversal", confidenceLevel: 66, conditions: "Stock spikes on news but the news is already priced in or overhyped. Fade the initial move as it reverses.", checklist: "- News event causes spike (upgrade, product launch, partnership)\n- Assess if news is truly new or already expected\n- Wait for first signs of reversal (red candle, volume shift)\n- Entry on break of initial spike candle low\n- Stop above spike high\n- Target: pre-news price or VWAP", notes: "'Buy the rumor, sell the news' — one of the oldest market principles. SMB teaches to identify when news is already priced in by checking: pre-news price action, options activity, and whether the move is proportional to the catalyst." },
    { name: "In Play Stock Framework — Отбор акций", folder: "SMB Capital — Frameworks", setupType: "other", confidenceLevel: 90, conditions: "Framework for identifying 'In Play' stocks — stocks that will have the most opportunity for day traders on a given day.", checklist: "- Fresh catalyst (earnings, FDA, news) within 24 hours\n- Gap > 4% (up or down)\n- Pre-market volume > 500K shares\n- Relative volume > 2x average\n- ATR > $2 (enough range to trade)\n- Float < 100M preferred\n- Not in a halt or pending news\n- Check sector (is the whole sector moving?)", notes: "The In Play framework is the foundation of SMB Capital's methodology. Before trading any setup, the stock must be 'In Play' — meaning it has a catalyst, volume, and range to create opportunity. Without In Play status, setups have much lower probability." },
    { name: "Power Hour Momentum — 3:00–4:00 PM", folder: "SMB Capital — Intraday Setups", setupType: "Intraday Momentum", confidenceLevel: 68, conditions: "Last hour of trading (3:00-4:00 PM). Institutions execute large orders, creating momentum. Trade in direction of the day's trend.", checklist: "- Identify day's trend (above/below VWAP)\n- Wait until 3:00 PM\n- Look for volume increase (institutional activity)\n- Long if above VWAP all day, Short if below\n- Entry on pullback within the trend\n- Stop: VWAP cross\n- Target: close of day or trailing stop", notes: "Power hour is when institutions execute their remaining orders for the day. This creates volume and momentum. SMB teaches that the last hour often mirrors the first hour in terms of direction and opportunity." },
  ];

  const additionalStrategies: typeof smbStrategies = [];

  const opgImbxMocStrategies: typeof smbStrategies = [];

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
  };

  const allSeedStrategies = [...smbStrategies, ...additionalStrategies, ...opgImbxMocStrategies];
  // Once per database (lib/seedMarkers, migration 0274): a renamed seeded setup or its cleared tags are the desk's own
  // edits — re-inserting by name on every boot brought the originals back as duplicates and re-filled the tags.
  if (await seedDone("playbook.strategies").catch(() => true)) {
    logger.info("Playbook strategies were seeded once already, skipping seed");
  } else {
    let seeded = 0;
    for (const s of allSeedStrategies) {
      try {
        const tags = seedTags[s.name] || null;
        const { rowCount } = await pool.query(
          `INSERT INTO playbook (name, folder, setup_type, conditions, checklist, notes, confidence_level, tags)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8
           WHERE NOT EXISTS (SELECT 1 FROM playbook WHERE name = $1)`,
          [s.name, s.folder, s.setupType, s.conditions, s.checklist, s.notes, s.confidenceLevel, tags]
        );
        if (rowCount && rowCount > 0) seeded++;
      } catch (e: any) { logger.warn({ error: e.message }, `Seed playbook: ${s.name}`); }
    }
    await markSeedDone("playbook.strategies").catch((e: any) => logger.warn({ error: e.message }, "Seed playbook: marker"));
    logger.info(`Seeded ${seeded} new playbook strategies (${allSeedStrategies.length - seeded} already existed)`);
  }

  // Playbook space / visibility for rows inserted without them (the seed above, legacy rows); readers also COALESCE
  // (lib/playbookAccess spaceSql), so this only keeps the stored values tidy. Idempotent: only NULL rows.
  try {
    await pool.query(
      `UPDATE playbook p
          SET space = CASE
                WHEN p.trader IS NULL THEN 'office'
                WHEN EXISTS (SELECT 1 FROM users u WHERE u.name = p.trader AND u.role IN ('curator', 'admin')) THEN 'office'
                ELSE 'personal' END
        WHERE p.space IS NULL`,
    );
    await pool.query(`UPDATE playbook SET visibility = 'private' WHERE visibility IS NULL`);
  } catch (e: any) {
    logger.warn({ error: e.message }, "Backfill playbook space/visibility");
  }

  // Seed default 6-item pre-trade checklist if empty
  try {
    const { rows: chkRows } = await pool.query(`SELECT COUNT(*) AS cnt FROM pre_trade_checklist_template`);
    if (Number(chkRows[0]?.cnt) === 0) {
      const defaults = [
        { label: "Есть катализатор", description: "Отчёт, новость, FDA, движение сектора или другой измеримый повод", sort: 1 },
        { label: "Объём выше среднего", description: "Относительный объём > 1.5x или премаркет-объём подтверждает интерес", sort: 2 },
        { label: "Сетап есть в плейбуке", description: "Сетап совпадает с описанной стратегией с подтверждённым edge", sort: 3 },
        { label: "Размер рассчитан от риска", description: "Позиция посчитана от заданного R. Место стопа понятно", sort: 4 },
        { label: "По направлению рынка", description: "Направление SPY/QQQ и сектора совпадает с идеей сделки", sort: 5 },
        { label: "Стоп — конкретный уровень", description: "Конкретная цена (не «по ощущениям»), не шире 1R", sort: 6 },
      ];
      for (const d of defaults) {
        await pool.query(
          `INSERT INTO pre_trade_checklist_template (label, description, required, sort_order, active) VALUES ($1, $2, TRUE, $3, TRUE)`,
          [d.label, d.description, d.sort]
        );
      }
      logger.info(`Seeded ${defaults.length} default pre-trade checklist items`);
    }
  } catch (e: any) {
    logger.warn({ error: e.message }, "Seed checklist defaults");
  }

  logger.info("Boot seeds completed");
}
