import { Router, type IRouter } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, activityLogTable, tradeReactionsTable, tradeReviewsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

async function isCurator(name: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM users WHERE name = $1 AND role = 'curator' AND active = true", [name]);
  return rows.length > 0;
}

const router: IRouter = Router();

router.get("/activity", asyncHandler(async (_req, res): Promise<void> => {
  const logs = await db
    .select()
    .from(activityLogTable)
    .orderBy(desc(activityLogTable.createdAt))
    .limit(100);
  res.json(logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })));
}));

router.get("/trades/:id/reactions", asyncHandler(async (req, res): Promise<void> => {
  const tradeId = Number(req.params.id);
  if (!tradeId || isNaN(tradeId)) { res.status(400).json({ error: "Invalid trade ID" }); return; }
  const reactions = await db.select().from(tradeReactionsTable).where(eq(tradeReactionsTable.tradeId, tradeId));
  res.json(reactions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
}));

router.post("/trades/:id/reactions", asyncHandler(async (req, res): Promise<void> => {
  const tradeId = Number(req.params.id);
  if (!tradeId || isNaN(tradeId)) { res.status(400).json({ error: "Invalid trade ID" }); return; }
  const { trader, reactionType } = req.body as { trader?: string; reactionType?: string };
  if (!trader || !reactionType) { res.status(400).json({ error: "trader and reactionType required" }); return; }
  const existing = await db.select().from(tradeReactionsTable)
    .where(and(eq(tradeReactionsTable.tradeId, tradeId), eq(tradeReactionsTable.trader, trader)));
  if (existing.length > 0) {
    await db.delete(tradeReactionsTable)
      .where(and(eq(tradeReactionsTable.tradeId, tradeId), eq(tradeReactionsTable.trader, trader)));
    res.json({ removed: true });
    return;
  }
  const [reaction] = await db.insert(tradeReactionsTable).values({ tradeId, trader, reactionType }).returning();
  res.status(201).json({ ...reaction, createdAt: reaction.createdAt.toISOString() });
}));

router.get("/trades/:id/reviews", asyncHandler(async (req, res): Promise<void> => {
  const tradeId = Number(req.params.id);
  if (!tradeId || isNaN(tradeId)) { res.status(400).json({ error: "Invalid trade ID" }); return; }
  const reviews = await db.select().from(tradeReviewsTable)
    .where(eq(tradeReviewsTable.tradeId, tradeId))
    .orderBy(desc(tradeReviewsTable.createdAt));
  res.json(reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
}));

router.post("/trades/:id/reviews", asyncHandler(async (req, res): Promise<void> => {
  const tradeId = Number(req.params.id);
  if (!tradeId || isNaN(tradeId)) { res.status(400).json({ error: "Invalid trade ID" }); return; }
  const { curator, comment, rating } = req.body as { curator?: string; comment?: string; rating?: string };
  if (!curator || !comment) { res.status(400).json({ error: "curator and comment required" }); return; }
  if (!(await isCurator(curator))) { res.status(403).json({ error: "Only curators can leave reviews" }); return; }
  const [review] = await db.insert(tradeReviewsTable).values({ tradeId, curator, comment, rating: rating ?? null }).returning();
  res.status(201).json({ ...review, createdAt: review.createdAt.toISOString() });
}));

router.delete("/trades/:tradeId/reviews/:reviewId", asyncHandler(async (req, res): Promise<void> => {
  const reviewId = Number(req.params.reviewId);
  if (!reviewId || isNaN(reviewId)) { res.status(400).json({ error: "Invalid review ID" }); return; }
  const curator = req.query.curator as string | undefined;
  const [existing] = await db.select().from(tradeReviewsTable).where(eq(tradeReviewsTable.id, reviewId));
  if (!existing) { res.status(404).json({ error: "Review not found" }); return; }
  if (curator && existing.curator !== curator) { res.status(403).json({ error: "You can only delete your own reviews" }); return; }
  await db.delete(tradeReviewsTable).where(eq(tradeReviewsTable.id, reviewId));
  res.sendStatus(204);
}));

export default router;
