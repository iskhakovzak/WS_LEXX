import { Router, type IRouter } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, tradingErrorsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.get("/errors", asyncHandler(async (req, res): Promise<void> => {
  const trader = req.query.trader as string | undefined;
  const where = trader ? eq(tradingErrorsTable.trader, trader) : undefined;
  const errors = await db
    .select()
    .from(tradingErrorsTable)
    .where(where)
    .orderBy(desc(tradingErrorsTable.createdAt))
    .limit(200);
  res.json(errors.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })));
}));

router.post("/errors", asyncHandler(async (req, res): Promise<void> => {
  const { trader, errorType, description, ticker, tradeId, severity, lesson } = req.body as {
    trader?: string; errorType?: string; description?: string;
    ticker?: string; tradeId?: number; severity?: string; lesson?: string;
  };
  if (!trader || !errorType || !description) {
    res.status(400).json({ error: "trader, errorType, description required" });
    return;
  }
  const [row] = await db.insert(tradingErrorsTable).values({
    trader,
    errorType,
    description,
    ticker: ticker || null,
    tradeId: tradeId || null,
    severity: severity || "medium",
    lesson: lesson || null,
  }).returning();
  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
}));

const VALID_SEVERITIES = ["low", "medium", "high", "critical"];
const VALID_RESOLVED = ["yes", "no"];

router.patch("/errors/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const trader = req.query.trader as string;
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  if (!trader) { res.status(400).json({ error: "trader query param required" }); return; }
  const updates: Record<string, any> = {};
  const body = req.body as Record<string, any>;
  if (body.resolved !== undefined) {
    if (!VALID_RESOLVED.includes(body.resolved)) { res.status(400).json({ error: "Invalid resolved value" }); return; }
    updates.resolved = body.resolved;
  }
  if (body.lesson !== undefined) updates.lesson = body.lesson;
  if (body.severity !== undefined) {
    if (!VALID_SEVERITIES.includes(body.severity)) { res.status(400).json({ error: "Invalid severity" }); return; }
    updates.severity = body.severity;
  }
  if (body.description !== undefined) updates.description = body.description;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(tradingErrorsTable).set(updates)
    .where(and(eq(tradingErrorsTable.id, id), eq(tradingErrorsTable.trader, trader))).returning();
  if (!row) { res.status(404).json({ error: "Not found or not owned by trader" }); return; }
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
}));

router.delete("/errors/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const trader = req.query.trader as string;
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  if (!trader) { res.status(400).json({ error: "trader query param required" }); return; }
  await db.delete(tradingErrorsTable).where(and(eq(tradingErrorsTable.id, id), eq(tradingErrorsTable.trader, trader)));
  res.json({ ok: true });
}));

router.get("/errors/stats", asyncHandler(async (req, res): Promise<void> => {
  const trader = req.query.trader as string | undefined;
  const where = trader ? eq(tradingErrorsTable.trader, trader) : undefined;
  const all = await db.select().from(tradingErrorsTable).where(where);
  const total = all.length;
  const resolved = all.filter((e) => e.resolved === "yes").length;
  const unresolved = total - resolved;
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const e of all) {
    byType[e.errorType] = (byType[e.errorType] || 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
  }
  const topErrors = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  res.json({ total, resolved, unresolved, byType, bySeverity, topErrors });
}));

export default router;
