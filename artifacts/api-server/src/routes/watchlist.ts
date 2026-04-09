import { Router, type IRouter } from "express";
import { eq, desc, isNull } from "drizzle-orm";
import { db, watchlistTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.get("/watchlist", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(watchlistTable).where(isNull(watchlistTable.deletedAt)).orderBy(desc(watchlistTable.createdAt));
  res.json(rows);
}));

router.post("/watchlist", asyncHandler(async (req, res): Promise<void> => {
  const { ticker, catalyst, targetPrice, stopPrice, status, notes, sector, tags } = req.body as Record<string, unknown>;
  if (!ticker) { res.status(400).json({ error: "ticker required" }); return; }
  const [row] = await db.insert(watchlistTable).values({
    ticker: String(ticker).toUpperCase(),
    catalyst: catalyst ? String(catalyst) : null,
    targetPrice: targetPrice ? String(targetPrice) : null,
    stopPrice: stopPrice ? String(stopPrice) : null,
    status: status ? String(status) : "watching",
    notes: notes ? String(notes) : null,
    sector: sector ? String(sector) : null,
    tags: tags ? String(tags) : null,
  }).returning();
  res.json(row);
}));

router.patch("/watchlist/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { ticker, catalyst, targetPrice, stopPrice, status, notes, sector, tags } = req.body as Record<string, unknown>;
  const [row] = await db.update(watchlistTable).set({
    ticker: ticker ? String(ticker).toUpperCase() : undefined,
    catalyst: catalyst !== undefined ? (catalyst ? String(catalyst) : null) : undefined,
    targetPrice: targetPrice !== undefined ? (targetPrice ? String(targetPrice) : null) : undefined,
    stopPrice: stopPrice !== undefined ? (stopPrice ? String(stopPrice) : null) : undefined,
    status: status ? String(status) : undefined,
    notes: notes !== undefined ? (notes ? String(notes) : null) : undefined,
    sector: sector !== undefined ? (sector ? String(sector) : null) : undefined,
    tags: tags !== undefined ? (tags ? String(tags) : null) : undefined,
  }).where(eq(watchlistTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
}));

router.delete("/watchlist/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.update(watchlistTable).set({ deletedAt: new Date() }).where(eq(watchlistTable.id, id));
  res.json({ success: true });
}));

router.post("/watchlist/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(watchlistTable).set({ deletedAt: null }).where(eq(watchlistTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
}));

export default router;
