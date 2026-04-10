import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, big7CatalystsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.get("/big7/catalysts", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(big7CatalystsTable).orderBy(desc(big7CatalystsTable.date));
  res.json(rows);
}));

router.post("/big7/catalysts", asyncHandler(async (req, res): Promise<void> => {
  const { ticker, date, type, description, impact } = req.body as Record<string, unknown>;
  if (!ticker || !date || !type) {
    res.status(400).json({ error: "ticker, date, and type are required" });
    return;
  }
  const [row] = await db.insert(big7CatalystsTable).values({
    ticker: String(ticker).toUpperCase(),
    date: String(date),
    type: String(type),
    description: description != null ? String(description) : null,
    impact: String(impact || "medium"),
  }).returning();
  res.status(201).json(row);
}));

router.delete("/big7/catalysts/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(big7CatalystsTable).where(eq(big7CatalystsTable.id, id));
  res.status(204).send();
}));

export default router;
