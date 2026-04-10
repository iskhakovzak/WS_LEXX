import { Router, type IRouter } from "express";
import { db, pool, tradesTable, eventsTable, researchTable, dailyFeedTable, discussionsTable, commentsTable, watchlistTable, playbookTable, activityLogTable, tradeReactionsTable, tradeReviewsTable, tradingErrorsTable, big7LevelsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.post("/admin/migrate", asyncHandler(async (req, res): Promise<void> => {
  const results: string[] = [];

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
      "tags" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  ];

  for (const sql of createStatements) {
    try {
      await pool.query(sql);
      const tableName = sql.match(/"(\w+)"/)?.[1] || "unknown";
      results.push(`TABLE OK: ${tableName}`);
    } catch (e: any) {
      results.push(`TABLE ERR: ${e.message}`);
    }
  }

  const addColumns = [
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
    { table: "playbook", column: "folder", type: "TEXT" },
    { table: "playbook", column: "source_type", type: "TEXT" },
    { table: "playbook", column: "source_id", type: "INTEGER" },
    { table: "playbook", column: "screenshot_notes", type: "TEXT" },
  ];

  for (const m of addColumns) {
    try {
      await pool.query(`ALTER TABLE "${m.table}" ADD COLUMN IF NOT EXISTS "${m.column}" ${m.type}`);
      results.push(`COL OK: ${m.table}.${m.column}`);
    } catch (e: any) {
      results.push(`COL ERR: ${m.table}.${m.column} - ${e.message}`);
    }
  }

  res.json({ success: true, results });
}));

const RESET_PASSWORD = "0987";

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val == null) return "";
          const str = String(val);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(","),
    ),
  ];
  return lines.join("\n");
}

router.post("/admin/reset", asyncHandler(async (req, res): Promise<void> => {
  const { password } = req.body as { password?: string };
  if (!password || password !== RESET_PASSWORD) {
    res.status(403).json({ error: "Неверный пароль" });
    return;
  }
  await db.delete(commentsTable);
  await db.delete(discussionsTable);
  await db.delete(tradesTable);
  await db.delete(eventsTable);
  await db.delete(researchTable);
  await db.delete(dailyFeedTable);
  req.log.info("Database reset by admin");
  res.json({ success: true, message: "База данных очищена" });
}));

router.get("/export/trades", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=trades.csv");
  res.send(csv);
}));

router.get("/export/events", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(desc(eventsTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=events.csv");
  res.send(csv);
}));

router.get("/export/research", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(researchTable).orderBy(desc(researchTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=research.csv");
  res.send(csv);
}));

router.get("/export/dailyfeed", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(dailyFeedTable).orderBy(desc(dailyFeedTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=dailyfeed.csv");
  res.send(csv);
}));

router.get("/export/discussions", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(discussionsTable).orderBy(desc(discussionsTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=discussions.csv");
  res.send(csv);
}));

router.get("/export/watchlist", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(watchlistTable).orderBy(desc(watchlistTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=watchlist.csv");
  res.send(csv);
}));

router.get("/export/playbook", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(playbookTable).orderBy(desc(playbookTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=playbook.csv");
  res.send(csv);
}));

router.get("/export/errors", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(tradingErrorsTable).orderBy(desc(tradingErrorsTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=trading-errors.csv");
  res.send(csv);
}));

router.get("/export/big7", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(big7LevelsTable).orderBy(desc(big7LevelsTable.createdAt));
  const csv = toCSV(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=big7-levels.csv");
  res.send(csv);
}));

router.get("/export/all", asyncHandler(async (_req, res): Promise<void> => {
  const trades = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt));
  const events = await db.select().from(eventsTable).orderBy(desc(eventsTable.createdAt));
  const research = await db.select().from(researchTable).orderBy(desc(researchTable.createdAt));
  const feed = await db.select().from(dailyFeedTable).orderBy(desc(dailyFeedTable.createdAt));
  const discussions = await db.select().from(discussionsTable).orderBy(desc(discussionsTable.createdAt));
  const comments = await db.select().from(commentsTable).orderBy(desc(commentsTable.createdAt));
  const watchlist = await db.select().from(watchlistTable).orderBy(desc(watchlistTable.createdAt));
  const playbook = await db.select().from(playbookTable).orderBy(desc(playbookTable.createdAt));
  const activityLog = await db.select().from(activityLogTable).orderBy(desc(activityLogTable.createdAt));
  const tradeReactions = await db.select().from(tradeReactionsTable).orderBy(desc(tradeReactionsTable.createdAt));
  const tradeReviews = await db.select().from(tradeReviewsTable).orderBy(desc(tradeReviewsTable.createdAt));
  const tradingErrors = await db.select().from(tradingErrorsTable).orderBy(desc(tradingErrorsTable.createdAt));
  const big7Levels = await db.select().from(big7LevelsTable).orderBy(desc(big7LevelsTable.createdAt));

  const ts = (r: { createdAt: Date }) => ({ ...r, createdAt: r.createdAt.toISOString() });

  const backup = {
    exportedAt: new Date().toISOString(),
    trades: trades.map(ts),
    events: events.map(ts),
    research: research.map(ts),
    dailyFeed: feed.map(ts),
    discussions: discussions.map(ts),
    comments: comments.map(ts),
    watchlist: watchlist.map(ts),
    playbook: playbook.map(ts),
    activityLog: activityLog.map(ts),
    tradeReactions: tradeReactions.map(ts),
    tradeReviews: tradeReviews.map(ts),
    tradingErrors: tradingErrors.map(ts),
    big7Levels: big7Levels.map(ts),
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=deskjournal-backup.json");
  res.json(backup);
}));

router.post("/import/trades", asyncHandler(async (req, res): Promise<void> => {
  const rows = req.body as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "Нет данных для импорта" });
    return;
  }
  const inserted = await db.insert(tradesTable).values(
    rows.map((r) => ({
      ticker: String(r.ticker || ""),
      date: String(r.date || new Date().toISOString().split("T")[0]),
      setup: String(r.setup || ""),
      result: String(r.result || ""),
      eventType: r.eventType ? String(r.eventType) : null,
      entry: r.entry ? Number(r.entry) : null,
      exit: r.exit ? Number(r.exit) : null,
      stop: r.stop ? Number(r.stop) : null,
      pnl: r.pnl ? Number(r.pnl) : null,
      rMultiple: r.rMultiple ? Number(r.rMultiple) : null,
      holdTime: r.holdTime ? String(r.holdTime) : null,
      slippage: r.slippage ? Number(r.slippage) : null,
      marketCap: r.marketCap ? String(r.marketCap) : null,
      float: r.float ? String(r.float) : null,
      relativeVolume: r.relativeVolume ? Number(r.relativeVolume) : null,
      session: r.session ? String(r.session) : null,
      notes: r.notes ? String(r.notes) : null,
      whatWorked: r.whatWorked ? String(r.whatWorked) : null,
      whatFailed: r.whatFailed ? String(r.whatFailed) : null,
      conclusion: r.conclusion ? String(r.conclusion) : null,
      trader: r.trader ? String(r.trader) : null,
    }))
  ).returning();
  res.json({ success: true, count: inserted.length });
}));

router.post("/import/events", asyncHandler(async (req, res): Promise<void> => {
  const rows = req.body as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "Нет данных для импорта" });
    return;
  }
  const inserted = await db.insert(eventsTable).values(
    rows.map((r) => ({
      ticker: String(r.ticker || ""),
      date: String(r.date || new Date().toISOString().split("T")[0]),
      eventType: String(r.eventType || ""),
      headline: String(r.headline || ""),
      reaction: r.reaction ? String(r.reaction) : null,
      percentMove: r.percentMove ? Number(r.percentMove) : null,
      volume: r.volume ? String(r.volume) : null,
      summary: r.summary ? String(r.summary) : null,
    }))
  ).returning();
  res.json({ success: true, count: inserted.length });
}));

router.post("/import/all", asyncHandler(async (req, res): Promise<void> => {
  const data = req.body as Record<string, unknown>;
  if (!data || typeof data !== "object") {
    res.status(400).json({ error: "Неверный формат бэкапа" });
    return;
  }

  const counts: Record<string, number> = {};
  const s = (v: unknown) => (v != null ? String(v) : null);
  const n = (v: unknown) => (v != null ? Number(v) : null);

  if (Array.isArray(data.trades) && data.trades.length > 0) {
    const ins = await db.insert(tradesTable).values(
      (data.trades as Record<string, unknown>[]).map((r) => ({
        ticker: String(r.ticker || ""),
        date: String(r.date || ""),
        setup: String(r.setup || ""),
        result: String(r.result || ""),
        eventType: s(r.eventType), entry: n(r.entry), exit: n(r.exit), stop: n(r.stop),
        pnl: n(r.pnl), rMultiple: n(r.rMultiple), holdTime: s(r.holdTime),
        slippage: n(r.slippage), marketCap: s(r.marketCap), float: s(r.float),
        relativeVolume: n(r.relativeVolume), session: s(r.session), notes: s(r.notes),
        whatWorked: s(r.whatWorked), whatFailed: s(r.whatFailed), conclusion: s(r.conclusion),
        trader: s(r.trader), side: s(r.side), tags: s(r.tags),
        screenshotUrl: s(r.screenshotUrl), screenshotNotes: s(r.screenshotNotes),
      }))
    ).returning();
    counts.trades = ins.length;
  }

  if (Array.isArray(data.events) && data.events.length > 0) {
    const ins = await db.insert(eventsTable).values(
      (data.events as Record<string, unknown>[]).map((r) => ({
        ticker: String(r.ticker || ""),
        date: String(r.date || ""),
        eventType: String(r.eventType || ""),
        headline: String(r.headline || ""),
        reaction: s(r.reaction), percentMove: n(r.percentMove),
        volume: s(r.volume), summary: s(r.summary),
      }))
    ).returning();
    counts.events = ins.length;
  }

  if (Array.isArray(data.research) && data.research.length > 0) {
    const ins = await db.insert(researchTable).values(
      (data.research as Record<string, unknown>[]).map((r) => ({
        patternName: String(r.patternName || ""),
        ticker: s(r.ticker), context: s(r.context), marketCondition: s(r.marketCondition),
        whatWorked: s(r.whatWorked), whatFailed: s(r.whatFailed),
        repeatCount: r.repeatCount != null ? Number(r.repeatCount) : 1,
        confidenceLevel: r.confidenceLevel != null ? Number(r.confidenceLevel) : 50,
        screenshotUrl: s(r.screenshotUrl), screenshotNotes: s(r.screenshotNotes), tags: s(r.tags),
      }))
    ).returning();
    counts.research = ins.length;
  }

  if (Array.isArray(data.dailyFeed) && data.dailyFeed.length > 0) {
    const ins = await db.insert(dailyFeedTable).values(
      (data.dailyFeed as Record<string, unknown>[]).map((r) => ({
        date: String(r.date || ""),
        whatWorksNow: s(r.whatWorksNow), whatDoesntWork: s(r.whatDoesntWork),
        bestTickers: s(r.bestTickers), marketTheme: s(r.marketTheme),
        notes: s(r.notes), tags: s(r.tags),
        screenshotUrl: s(r.screenshotUrl), screenshotNotes: s(r.screenshotNotes),
      }))
    ).returning();
    counts.dailyFeed = ins.length;
  }

  if (Array.isArray(data.discussions) && data.discussions.length > 0) {
    const ins = await db.insert(discussionsTable).values(
      (data.discussions as Record<string, unknown>[]).map((r) => ({
        topic: String(r.topic || ""),
        type: s(r.type), trader: s(r.trader), notes: s(r.notes), tags: s(r.tags),
      }))
    ).returning();
    counts.discussions = ins.length;
  }

  if (Array.isArray(data.comments) && data.comments.length > 0) {
    const ins = await db.insert(commentsTable).values(
      (data.comments as Record<string, unknown>[]).map((r) => ({
        discussionId: Number(r.discussionId),
        trader: s(r.trader), text: String(r.text || ""),
      }))
    ).returning();
    counts.comments = ins.length;
  }

  if (Array.isArray(data.watchlist) && data.watchlist.length > 0) {
    const ins = await db.insert(watchlistTable).values(
      (data.watchlist as Record<string, unknown>[]).map((r) => ({
        ticker: String(r.ticker || ""),
        catalyst: s(r.catalyst), targetPrice: s(r.targetPrice), stopPrice: s(r.stopPrice),
        status: String(r.status || "watching"),
        notes: s(r.notes), sector: s(r.sector), screenshotUrl: s(r.screenshotUrl), tags: s(r.tags),
      }))
    ).returning();
    counts.watchlist = ins.length;
  }

  if (Array.isArray(data.playbook) && data.playbook.length > 0) {
    const ins = await db.insert(playbookTable).values(
      (data.playbook as Record<string, unknown>[]).map((r) => ({
        name: String(r.name || ""),
        folder: s(r.folder),
        setupType: s(r.setupType), conditions: s(r.conditions), checklist: s(r.checklist),
        notes: s(r.notes), confidenceLevel: r.confidenceLevel != null ? Number(r.confidenceLevel) : null,
        screenshotUrl: s(r.screenshotUrl), screenshotNotes: s(r.screenshotNotes), tags: s(r.tags),
        sourceType: s(r.sourceType), sourceId: r.sourceId != null ? Number(r.sourceId) : null,
      }))
    ).returning();
    counts.playbook = ins.length;
  }

  if (Array.isArray(data.activityLog) && data.activityLog.length > 0) {
    const ins = await db.insert(activityLogTable).values(
      (data.activityLog as Record<string, unknown>[]).map((r) => ({
        action: String(r.action || ""),
        section: String(r.section || ""),
        entityId: s(r.entityId), entityTitle: s(r.entityTitle),
        trader: s(r.trader), details: s(r.details),
      }))
    ).returning();
    counts.activityLog = ins.length;
  }

  if (Array.isArray(data.tradeReactions) && data.tradeReactions.length > 0) {
    const ins = await db.insert(tradeReactionsTable).values(
      (data.tradeReactions as Record<string, unknown>[]).map((r) => ({
        tradeId: Number(r.tradeId),
        trader: String(r.trader || ""),
        reactionType: String(r.reactionType || ""),
      }))
    ).returning();
    counts.tradeReactions = ins.length;
  }

  if (Array.isArray(data.tradeReviews) && data.tradeReviews.length > 0) {
    const ins = await db.insert(tradeReviewsTable).values(
      (data.tradeReviews as Record<string, unknown>[]).map((r) => ({
        tradeId: Number(r.tradeId),
        curator: String(r.curator || ""),
        comment: String(r.comment || ""),
        rating: s(r.rating),
      }))
    ).returning();
    counts.tradeReviews = ins.length;
  }

  if (Array.isArray(data.tradingErrors) && data.tradingErrors.length > 0) {
    const ins = await db.insert(tradingErrorsTable).values(
      (data.tradingErrors as Record<string, unknown>[]).map((r) => ({
        trader: String(r.trader || ""),
        errorType: String(r.errorType || ""),
        description: String(r.description || ""),
        ticker: s(r.ticker), tradeId: r.tradeId != null ? Number(r.tradeId) : null,
        severity: String(r.severity || "medium"),
        lesson: s(r.lesson), resolved: String(r.resolved || "no"),
      }))
    ).returning();
    counts.tradingErrors = ins.length;
  }

  if (Array.isArray(data.big7Levels) && data.big7Levels.length > 0) {
    const ins = await db.insert(big7LevelsTable).values(
      (data.big7Levels as Record<string, unknown>[]).map((r) => ({
        ticker: String(r.ticker || ""),
        label: String(r.label || ""),
        price: String(r.price || "0"),
        notes: s(r.notes),
      }))
    ).returning();
    counts.big7Levels = ins.length;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ success: true, total, counts });
}));

export default router;
