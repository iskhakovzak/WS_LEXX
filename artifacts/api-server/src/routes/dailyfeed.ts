import { Router, type IRouter } from "express";
import { eq, desc, isNull } from "drizzle-orm";
import { db, dailyFeedTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import {
  CreateDailyFeedBody,
  GetDailyFeedParams,
  UpdateDailyFeedParams,
  UpdateDailyFeedBody,
  DeleteDailyFeedParams,
  ListDailyFeedResponse,
  GetDailyFeedResponse,
  UpdateDailyFeedResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dailyfeed", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(dailyFeedTable).where(isNull(dailyFeedTable.deletedAt)).orderBy(desc(dailyFeedTable.createdAt));
  res.json(
    ListDailyFeedResponse.parse(
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    ),
  );
}));

router.post("/dailyfeed", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateDailyFeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entry] = await db.insert(dailyFeedTable).values(parsed.data).returning();
  res.status(201).json(
    GetDailyFeedResponse.parse({ ...entry, createdAt: entry.createdAt.toISOString() }),
  );
}));

router.get("/dailyfeed/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetDailyFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db
    .select()
    .from(dailyFeedTable)
    .where(eq(dailyFeedTable.id, params.data.id));
  if (!entry) {
    res.status(404).json({ error: "Daily feed entry not found" });
    return;
  }
  res.json(GetDailyFeedResponse.parse({ ...entry, createdAt: entry.createdAt.toISOString() }));
}));

router.patch("/dailyfeed/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateDailyFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDailyFeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entry] = await db
    .update(dailyFeedTable)
    .set(parsed.data)
    .where(eq(dailyFeedTable.id, params.data.id))
    .returning();
  if (!entry) {
    res.status(404).json({ error: "Daily feed entry not found" });
    return;
  }
  res.json(
    UpdateDailyFeedResponse.parse({ ...entry, createdAt: entry.createdAt.toISOString() }),
  );
}));

router.delete("/dailyfeed/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteDailyFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db
    .update(dailyFeedTable)
    .set({ deletedAt: new Date() })
    .where(eq(dailyFeedTable.id, params.data.id))
    .returning();
  if (!entry) {
    res.status(404).json({ error: "Daily feed entry not found" });
    return;
  }
  res.sendStatus(204);
}));

router.post("/dailyfeed/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [entry] = await db.update(dailyFeedTable).set({ deletedAt: null }).where(eq(dailyFeedTable.id, id)).returning();
  if (!entry) { res.status(404).json({ error: "Daily feed entry not found" }); return; }
  res.json({ success: true });
}));

export default router;
