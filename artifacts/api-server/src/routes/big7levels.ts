import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, big7LevelsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.get("/big7levels", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(big7LevelsTable).orderBy(desc(big7LevelsTable.createdAt));
  res.json(rows);
}));

router.post("/big7levels", asyncHandler(async (req, res): Promise<void> => {
  const { ticker, label, price, notes } = req.body as Record<string, unknown>;
  if (!ticker || !label || price === undefined || price === null) {
    res.status(400).json({ error: "ticker, label, and price are required" });
    return;
  }
  const [row] = await db.insert(big7LevelsTable).values({
    ticker: String(ticker).toUpperCase(),
    label: String(label),
    price: String(price),
    notes: notes != null ? String(notes) : null,
  }).returning();
  res.status(201).json(row);
}));

router.patch("/big7levels/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { ticker, label, price, notes } = req.body as Record<string, unknown>;
  const [row] = await db.update(big7LevelsTable).set({
    ticker: ticker !== undefined ? String(ticker).toUpperCase() : undefined,
    label: label !== undefined ? String(label) : undefined,
    price: price !== undefined ? String(price) : undefined,
    notes: notes !== undefined ? (notes != null ? String(notes) : null) : undefined,
  }).where(eq(big7LevelsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
}));

router.delete("/big7levels/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(big7LevelsTable).where(eq(big7LevelsTable.id, id));
  res.status(204).send();
}));

export default router;
