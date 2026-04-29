import { Router, type IRouter } from "express";
import { desc, isNull } from "drizzle-orm";
import { db, tradesTable, eventsTable, researchTable, dailyFeedTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import {
  GetDashboardSummaryResponse,
  GetPerformanceStatsResponse,
  GetTopPatternsResponse,
  GetRecentTradesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", asyncHandler(async (_req, res): Promise<void> => {
  const allTrades = await db.select().from(tradesTable).where(isNull(tradesTable.deletedAt));
  const today = new Date().toISOString().split("T")[0];
  const todayTrades = allTrades.filter((t) => t.date === today);

  const totalTrades = allTrades.length;
  const wins = allTrades.filter((t) => t.result === "win" || t.result === "прибыль").length;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;

  const totalPnl = allTrades.reduce((sum, t) => sum + (t.pnl ? Number(t.pnl) : 0), 0);
  const validRMultiples = allTrades.filter((t) => t.rMultiple != null);
  const avgRMultiple =
    validRMultiples.length > 0
      ? validRMultiples.reduce((sum, t) => sum + Number(t.rMultiple), 0) /
        validRMultiples.length
      : 0;

  const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl ? Number(t.pnl) : 0), 0);

  const setupGroups: Record<string, { wins: number; total: number }> = {};
  for (const t of allTrades) {
    if (!setupGroups[t.setup]) setupGroups[t.setup] = { wins: 0, total: 0 };
    setupGroups[t.setup].total++;
    if (t.result === "win" || t.result === "прибыль") setupGroups[t.setup].wins++;
  }
  let topSetup: string | null = null;
  let topWinRate = -1;
  for (const [setup, data] of Object.entries(setupGroups)) {
    const wr = data.total > 0 ? data.wins / data.total : 0;
    if (wr > topWinRate) {
      topWinRate = wr;
      topSetup = setup;
    }
  }

  const traderGroups: Record<string, number> = {};
  for (const t of allTrades) {
    if (!t.trader) continue;
    traderGroups[t.trader] = (traderGroups[t.trader] || 0) + (t.pnl ? Number(t.pnl) : 0);
  }
  let topTrader: string | null = null;
  let topTraderPnl = -Infinity;
  for (const [trader, pnl] of Object.entries(traderGroups)) {
    if (pnl > topTraderPnl) {
      topTraderPnl = pnl;
      topTrader = trader;
    }
  }

  const feeds = await db.select().from(dailyFeedTable).orderBy(desc(dailyFeedTable.createdAt));
  const latestFeed = feeds[0];

  res.json(
    GetDashboardSummaryResponse.parse({
      totalTrades,
      winRate,
      totalPnl,
      avgRMultiple,
      todayTrades: todayTrades.length,
      todayPnl,
      topSetup,
      topTrader,
      marketRegime: latestFeed?.marketTheme ?? null,
      bestTickers: latestFeed?.bestTickers ?? null,
    }),
  );
}));

router.get("/dashboard/performance", asyncHandler(async (_req, res): Promise<void> => {
  const allTrades = await db.select().from(tradesTable).where(isNull(tradesTable.deletedAt));

  const setupMap: Record<string, { wins: number; total: number; pnl: number; rMults: number[] }> =
    {};
  for (const t of allTrades) {
    if (!setupMap[t.setup]) setupMap[t.setup] = { wins: 0, total: 0, pnl: 0, rMults: [] };
    setupMap[t.setup].total++;
    if (t.result === "win" || t.result === "прибыль") setupMap[t.setup].wins++;
    setupMap[t.setup].pnl += t.pnl ? Number(t.pnl) : 0;
    if (t.rMultiple != null) setupMap[t.setup].rMults.push(Number(t.rMultiple));
  }
  const bySetup = Object.entries(setupMap).map(([setup, d]) => ({
    setup,
    count: d.total,
    winRate: d.total > 0 ? d.wins / d.total : 0,
    avgPnl: d.total > 0 ? d.pnl / d.total : 0,
    avgRMultiple: d.rMults.length > 0 ? d.rMults.reduce((a, b) => a + b, 0) / d.rMults.length : 0,
  }));

  const traderMap: Record<
    string,
    { wins: number; total: number; pnl: number; rMults: number[] }
  > = {};
  for (const t of allTrades) {
    const key = t.trader ?? "Unknown";
    if (!traderMap[key]) traderMap[key] = { wins: 0, total: 0, pnl: 0, rMults: [] };
    traderMap[key].total++;
    if (t.result === "win" || t.result === "прибыль") traderMap[key].wins++;
    traderMap[key].pnl += t.pnl ? Number(t.pnl) : 0;
    if (t.rMultiple != null) traderMap[key].rMults.push(Number(t.rMultiple));
  }
  const byTrader = Object.entries(traderMap).map(([trader, d]) => ({
    trader,
    count: d.total,
    winRate: d.total > 0 ? d.wins / d.total : 0,
    totalPnl: d.pnl,
    avgRMultiple: d.rMults.length > 0 ? d.rMults.reduce((a, b) => a + b, 0) / d.rMults.length : 0,
  }));

  const eventsAll = await db.select().from(eventsTable);
  const evTypeMap: Record<string, { total: number; moves: number[] }> = {};
  for (const e of eventsAll) {
    if (!evTypeMap[e.eventType]) evTypeMap[e.eventType] = { total: 0, moves: [] };
    evTypeMap[e.eventType].total++;
    if (e.percentMove != null) evTypeMap[e.eventType].moves.push(Number(e.percentMove));
  }
  const eventTradeMap: Record<string, { wins: number; total: number }> = {};
  for (const t of allTrades) {
    if (!t.eventType) continue;
    if (!eventTradeMap[t.eventType]) eventTradeMap[t.eventType] = { wins: 0, total: 0 };
    eventTradeMap[t.eventType].total++;
    if (t.result === "win" || t.result === "прибыль") eventTradeMap[t.eventType].wins++;
  }
  const byEventType = Object.entries(evTypeMap).map(([eventType, d]) => ({
    eventType,
    count: d.total,
    winRate:
      eventTradeMap[eventType] && eventTradeMap[eventType].total > 0
        ? eventTradeMap[eventType].wins / eventTradeMap[eventType].total
        : 0,
    avgMove: d.moves.length > 0 ? d.moves.reduce((a, b) => a + b, 0) / d.moves.length : 0,
  }));

  res.json(GetPerformanceStatsResponse.parse({ bySetup, byTrader, byEventType }));
}));

router.get("/dashboard/toppatterns", asyncHandler(async (_req, res): Promise<void> => {
  const patterns = await db
    .select()
    .from(researchTable)
    .orderBy(desc(researchTable.repeatCount));

  const allTrades = await db.select().from(tradesTable).where(isNull(tradesTable.deletedAt));
  const patternPnlMap: Record<number, number[]> = {};
  for (const t of allTrades) {
    if (t.patternId == null) continue;
    if (!patternPnlMap[t.patternId]) patternPnlMap[t.patternId] = [];
    if (t.pnl != null) patternPnlMap[t.patternId].push(Number(t.pnl));
  }

  const result = patterns.map((p) => {
    const pnls = patternPnlMap[p.id] ?? [];
    const avgPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
    return {
      patternName: p.patternName,
      repeatCount: p.repeatCount ?? 0,
      confidenceLevel: p.confidenceLevel ?? 0,
      avgPnl,
    };
  });

  res.json(GetTopPatternsResponse.parse(result));
}));

router.get("/dashboard/recenttrades", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(tradesTable)
    .where(isNull(tradesTable.deletedAt))
    .orderBy(desc(tradesTable.createdAt))
    .limit(10);
  res.json(
    GetRecentTradesResponse.parse(
      rows.map((r) => ({
        ...r,
        entry: r.entry ? Number(r.entry) : null,
        exit: r.exit ? Number(r.exit) : null,
        stop: r.stop ? Number(r.stop) : null,
        pnl: r.pnl ? Number(r.pnl) : null,
        rMultiple: r.rMultiple ? Number(r.rMultiple) : null,
        slippage: r.slippage ? Number(r.slippage) : null,
        relativeVolume: r.relativeVolume ? Number(r.relativeVolume) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    ),
  );
}));

export default router;
