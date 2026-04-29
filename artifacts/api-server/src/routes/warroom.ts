import { Router, type IRouter } from "express";
import { eq, desc, isNull, and } from "drizzle-orm";
import { db, warRoomSessionsTable, warRoomLevelsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.get("/warroom/active", asyncHandler(async (req, res): Promise<void> => {
  const trader = req.query.trader ? String(req.query.trader) : undefined;
  const conditions = [isNull(warRoomSessionsTable.endedAt)];
  if (trader) conditions.push(eq(warRoomSessionsTable.trader, trader));
  const [session] = await db.select().from(warRoomSessionsTable)
    .where(and(...conditions))
    .orderBy(desc(warRoomSessionsTable.createdAt))
    .limit(1);
  if (!session) { res.json(null); return; }
  const levels = await db.select().from(warRoomLevelsTable)
    .where(eq(warRoomLevelsTable.sessionId, session.id));
  res.json({ ...session, levels });
}));

router.get("/warroom/sessions", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(warRoomSessionsTable)
    .orderBy(desc(warRoomSessionsTable.createdAt))
    .limit(50);
  res.json(rows);
}));

router.post("/warroom/sessions", asyncHandler(async (req, res): Promise<void> => {
  const { trader, eventName, eventTime, notes, checklist } = req.body as Record<string, unknown>;
  if (!eventName || !eventTime) {
    res.status(400).json({ error: "eventName and eventTime are required" });
    return;
  }
  const [row] = await db.insert(warRoomSessionsTable).values({
    trader: trader != null ? String(trader) : null,
    eventName: String(eventName),
    eventTime: new Date(String(eventTime)),
    notes: notes != null ? String(notes) : null,
    checklist: checklist != null ? checklist as { text: string; done: boolean }[] : null,
  }).returning();
  res.status(201).json(row);
}));

router.patch("/warroom/sessions/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { notes, checklist, endedAt } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (notes !== undefined) updates.notes = notes != null ? String(notes) : null;
  if (checklist !== undefined) updates.checklist = checklist;
  if (endedAt !== undefined) updates.endedAt = endedAt ? new Date(String(endedAt)) : null;
  const [row] = await db.update(warRoomSessionsTable).set(updates)
    .where(eq(warRoomSessionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
}));

router.post("/warroom/sessions/:id/levels", asyncHandler(async (req, res): Promise<void> => {
  const sessionId = Number(req.params.id);
  const { ticker, price, label, type } = req.body as Record<string, unknown>;
  if (!ticker || price === undefined || !label || !type) {
    res.status(400).json({ error: "ticker, price, label, and type are required" });
    return;
  }
  const [row] = await db.insert(warRoomLevelsTable).values({
    sessionId,
    ticker: String(ticker).toUpperCase(),
    price: String(price),
    label: String(label),
    type: String(type),
  }).returning();
  res.status(201).json(row);
}));

router.delete("/warroom/levels/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(warRoomLevelsTable).where(eq(warRoomLevelsTable.id, id));
  res.status(204).send();
}));

export default router;
