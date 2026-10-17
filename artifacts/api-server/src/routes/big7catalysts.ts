import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, big7CatalystsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
const VALID_IMPACT = new Set(["low", "medium", "high"]);

router.get("/big7/catalysts", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(big7CatalystsTable).orderBy(desc(big7CatalystsTable.date));
  res.json(rows);
}));

router.post("/big7/catalysts", asyncHandler(async (req, res): Promise<void> => {
  const { ticker, date, type, description, impact } = req.body as Record<string, unknown>;
  if (!ticker || !date || !type || !String(ticker).trim()) {
    res.status(400).json({ error: "ticker, date, and type are required" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(String(date)))) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }
  const tickerStr = String(ticker).trim().toUpperCase().replace(/^\$/, "");
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(tickerStr)) {
    res.status(400).json({ error: "invalid ticker" });
    return;
  }
  const [row] = await db.insert(big7CatalystsTable).values({
    ticker: tickerStr,
    date: String(date),
    type: String(type).slice(0, 40),
    description: description != null && String(description).trim() !== "" ? String(description).slice(0, 500) : null,
    impact: VALID_IMPACT.has(String(impact)) ? String(impact) : "medium",
  }).returning();
  res.status(201).json(row);
}));

// PATCH /api/big7/catalysts/:id — edit date / type / description / impact (ticker too).
router.patch("/big7/catalysts/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  const { ticker, date, type, description, impact } = req.body as Record<string, unknown>;
  const patch: Partial<typeof big7CatalystsTable.$inferInsert> = {};
  if (ticker !== undefined) {
    const t = String(ticker).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) { res.status(400).json({ error: "invalid ticker" }); return; }
    patch.ticker = t;
  }
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(String(date)))) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    patch.date = String(date);
  }
  if (type !== undefined) {
    const t = String(type).trim();
    if (!t || t.length > 40) { res.status(400).json({ error: "invalid type" }); return; }
    patch.type = t;
  }
  if (description !== undefined) {
    patch.description = description != null && String(description).trim() !== "" ? String(description).slice(0, 500) : null;
  }
  if (impact !== undefined) {
    if (!VALID_IMPACT.has(String(impact))) { res.status(400).json({ error: "impact must be low|medium|high" }); return; }
    patch.impact = String(impact);
  }
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "nothing to update" }); return; }
  const [row] = await db.update(big7CatalystsTable).set(patch).where(eq(big7CatalystsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
}));

router.delete("/big7/catalysts/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(big7CatalystsTable).where(eq(big7CatalystsTable.id, id));
  res.status(204).send();
}));

export default router;
