import { Router, type IRouter } from "express";
import { eq, desc, isNull } from "drizzle-orm";
import { db, researchTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import {
  CreateResearchBody,
  GetResearchParams,
  UpdateResearchParams,
  UpdateResearchBody,
  DeleteResearchParams,
  ListResearchResponse,
  GetResearchResponse,
  UpdateResearchResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/research", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(researchTable).where(isNull(researchTable.deletedAt)).orderBy(desc(researchTable.createdAt));
  res.json(
    ListResearchResponse.parse(
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    ),
  );
}));

router.post("/research", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateResearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entry] = await db.insert(researchTable).values(parsed.data).returning();
  res.status(201).json(
    GetResearchResponse.parse({ ...entry, createdAt: entry.createdAt.toISOString() }),
  );
}));

router.get("/research/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetResearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db
    .select()
    .from(researchTable)
    .where(eq(researchTable.id, params.data.id));
  if (!entry) {
    res.status(404).json({ error: "Research not found" });
    return;
  }
  res.json(GetResearchResponse.parse({ ...entry, createdAt: entry.createdAt.toISOString() }));
}));

router.patch("/research/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateResearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateResearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entry] = await db
    .update(researchTable)
    .set(parsed.data)
    .where(eq(researchTable.id, params.data.id))
    .returning();
  if (!entry) {
    res.status(404).json({ error: "Research not found" });
    return;
  }
  res.json(
    UpdateResearchResponse.parse({ ...entry, createdAt: entry.createdAt.toISOString() }),
  );
}));

router.delete("/research/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteResearchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db
    .update(researchTable)
    .set({ deletedAt: new Date() })
    .where(eq(researchTable.id, params.data.id))
    .returning();
  if (!entry) {
    res.status(404).json({ error: "Research not found" });
    return;
  }
  res.sendStatus(204);
}));

router.post("/research/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [entry] = await db.update(researchTable).set({ deletedAt: null }).where(eq(researchTable.id, id)).returning();
  if (!entry) { res.status(404).json({ error: "Research not found" }); return; }
  res.json({ success: true });
}));

export default router;
