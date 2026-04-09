import { Router, type IRouter } from "express";
import { eq, desc, isNull } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import {
  ListEventsQueryParams,
  CreateEventBody,
  GetEventParams,
  UpdateEventParams,
  UpdateEventBody,
  DeleteEventParams,
  ListEventsResponse,
  GetEventResponse,
  UpdateEventResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeEvent(e: typeof eventsTable.$inferSelect) {
  return {
    ...e,
    percentMove: e.percentMove ? Number(e.percentMove) : null,
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/events", asyncHandler(async (req, res): Promise<void> => {
  const query = ListEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { ticker, eventType } = query.data;
  let rows = await db.select().from(eventsTable).where(isNull(eventsTable.deletedAt)).orderBy(desc(eventsTable.createdAt));
  if (ticker) rows = rows.filter((r) => r.ticker === ticker);
  if (eventType) rows = rows.filter((r) => r.eventType === eventType);
  res.json(ListEventsResponse.parse(rows.map(serializeEvent)));
}));

router.post("/events", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [event] = await db.insert(eventsTable).values(parsed.data).returning();
  res.status(201).json(GetEventResponse.parse(serializeEvent(event)));
}));

router.get("/events/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, params.data.id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(GetEventResponse.parse(serializeEvent(event)));
}));

router.patch("/events/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [event] = await db
    .update(eventsTable)
    .set(parsed.data)
    .where(eq(eventsTable.id, params.data.id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(UpdateEventResponse.parse(serializeEvent(event)));
}));

router.delete("/events/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [event] = await db
    .update(eventsTable)
    .set({ deletedAt: new Date() })
    .where(eq(eventsTable.id, params.data.id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.sendStatus(204);
}));

router.post("/events/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.update(eventsTable).set({ deletedAt: null }).where(eq(eventsTable.id, id)).returning();
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  res.json({ success: true });
}));

export default router;
