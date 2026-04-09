import { Router, type IRouter } from "express";
import { eq, desc, isNull } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import { logActivity } from "../lib/activity";
import { asyncHandler } from "../lib/asyncHandler";
import {
  ListTradesQueryParams,
  CreateTradeBody,
  GetTradeParams,
  UpdateTradeParams,
  UpdateTradeBody,
  DeleteTradeParams,
  ListTradesResponse,
  GetTradeResponse,
  UpdateTradeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trades", asyncHandler(async (req, res): Promise<void> => {
  const query = ListTradesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { setup, eventType, session, trader, result } = query.data;
  let rows = await db.select().from(tradesTable).where(isNull(tradesTable.deletedAt)).orderBy(desc(tradesTable.createdAt));

  if (setup) rows = rows.filter((r) => r.setup === setup);
  if (eventType) rows = rows.filter((r) => r.eventType === eventType);
  if (session) rows = rows.filter((r) => r.session === session);
  if (trader) rows = rows.filter((r) => r.trader === trader);
  if (result) rows = rows.filter((r) => r.result === result);

  res.json(
    ListTradesResponse.parse(
      rows.map((r) => ({
        ...r,
        entry: r.entry ? Number(r.entry) : null,
        exit: r.exit ? Number(r.exit) : null,
        stop: r.stop ? Number(r.stop) : null,
        pnl: r.pnl ? Number(r.pnl) : null,
        rMultiple: r.rMultiple ? Number(r.rMultiple) : null,
        slippage: r.slippage ? Number(r.slippage) : null,
        relativeVolume: r.relativeVolume ? Number(r.relativeVolume) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    ),
  );
}));

router.post("/trades", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [trade] = await db.insert(tradesTable).values(parsed.data).returning();
  logActivity({ action: "created", section: "trades", entityId: String(trade.id), entityTitle: trade.ticker, trader: trade.trader ?? undefined, details: `${trade.side ?? ""} ${trade.result} ${trade.pnl ? "$" + trade.pnl : ""}`.trim() });
  res.status(201).json(
    GetTradeResponse.parse({
      ...trade,
      entry: trade.entry ? Number(trade.entry) : null,
      exit: trade.exit ? Number(trade.exit) : null,
      stop: trade.stop ? Number(trade.stop) : null,
      pnl: trade.pnl ? Number(trade.pnl) : null,
      rMultiple: trade.rMultiple ? Number(trade.rMultiple) : null,
      slippage: trade.slippage ? Number(trade.slippage) : null,
      relativeVolume: trade.relativeVolume ? Number(trade.relativeVolume) : null,
      createdAt: trade.createdAt.toISOString(),
    }),
  );
}));

router.get("/trades/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetTradeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [trade] = await db.select().from(tradesTable).where(eq(tradesTable.id, params.data.id));
  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  res.json(
    GetTradeResponse.parse({
      ...trade,
      entry: trade.entry ? Number(trade.entry) : null,
      exit: trade.exit ? Number(trade.exit) : null,
      stop: trade.stop ? Number(trade.stop) : null,
      pnl: trade.pnl ? Number(trade.pnl) : null,
      rMultiple: trade.rMultiple ? Number(trade.rMultiple) : null,
      slippage: trade.slippage ? Number(trade.slippage) : null,
      relativeVolume: trade.relativeVolume ? Number(trade.relativeVolume) : null,
      createdAt: trade.createdAt.toISOString(),
    }),
  );
}));

router.patch("/trades/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = UpdateTradeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [trade] = await db
    .update(tradesTable)
    .set(parsed.data)
    .where(eq(tradesTable.id, params.data.id))
    .returning();
  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  logActivity({ action: "updated", section: "trades", entityId: String(trade.id), entityTitle: trade.ticker, trader: trade.trader ?? undefined });
  res.json(
    UpdateTradeResponse.parse({
      ...trade,
      entry: trade.entry ? Number(trade.entry) : null,
      exit: trade.exit ? Number(trade.exit) : null,
      stop: trade.stop ? Number(trade.stop) : null,
      pnl: trade.pnl ? Number(trade.pnl) : null,
      rMultiple: trade.rMultiple ? Number(trade.rMultiple) : null,
      slippage: trade.slippage ? Number(trade.slippage) : null,
      relativeVolume: trade.relativeVolume ? Number(trade.relativeVolume) : null,
      createdAt: trade.createdAt.toISOString(),
    }),
  );
}));

router.delete("/trades/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteTradeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [trade] = await db
    .update(tradesTable)
    .set({ deletedAt: new Date() })
    .where(eq(tradesTable.id, params.data.id))
    .returning();
  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  logActivity({ action: "deleted", section: "trades", entityId: String(trade.id), entityTitle: trade.ticker, trader: trade.trader ?? undefined });
  res.sendStatus(204);
}));

router.post("/trades/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [trade] = await db
    .update(tradesTable)
    .set({ deletedAt: null })
    .where(eq(tradesTable.id, id))
    .returning();
  if (!trade) { res.status(404).json({ error: "Trade not found" }); return; }
  logActivity({ action: "created", section: "trades", entityId: String(trade.id), entityTitle: `${trade.ticker} (восстановлен)`, trader: trade.trader ?? undefined });
  res.json({ success: true });
}));

export default router;
