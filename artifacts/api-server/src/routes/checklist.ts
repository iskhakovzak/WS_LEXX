import { Router, type IRouter } from "express";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db, preTradeChecklistTemplateTable, preTradeChecklistResponsesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireMember, scopeTrader, canAccessTrade, GUEST_SCOPE } from "../lib/auth";
import { can, requireCap } from "../lib/permissions";

const router: IRouter = Router();

/**
 * Template management used to be gated by a shared admin password with a hard-coded
 * fallback ("0987") that also shipped in the frontend bundle. Access is now derived
 * from the caller's JWT and their *current* role in the DB (lib/auth requireStaff):
 * only active, non-banned curators/admins may change the team checklist template.
 *
 * Responses are personal pre-trade records: a member reads/writes only their own,
 * staff see everyone's, guests see nothing (scopeTrader → GUEST_SCOPE).
 */

router.get("/checklist-template", asyncHandler(async (req, res): Promise<void> => {
  const includeInactive = req.query.includeInactive === "true";
  let rows = await db
    .select()
    .from(preTradeChecklistTemplateTable)
    .orderBy(preTradeChecklistTemplateTable.sortOrder, preTradeChecklistTemplateTable.id);
  if (!includeInactive) rows = rows.filter((r) => r.active);
  res.json(rows);
}));

router.post("/checklist-template", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "checklist.template.edit"))) return;
  const { label, description, required, sortOrder, active } = req.body as Record<string, unknown>;
  if (!label || typeof label !== "string" || !label.trim()) { res.status(400).json({ error: "Нужен текст пункта (label)" }); return; }
  const [row] = await db.insert(preTradeChecklistTemplateTable).values({
    label: label.trim().slice(0, 500),
    description: description ? String(description).slice(0, 2000) : null,
    required: required !== false,
    sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
    active: active !== false,
  }).returning();
  res.status(201).json(row);
}));

router.patch("/checklist-template/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "checklist.template.edit"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Некорректный id" }); return; }
  const { label, description, required, sortOrder, active } = req.body as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if (typeof label === "string" && label.trim()) update.label = label.trim().slice(0, 500);
  if (description !== undefined) update.description = description ? String(description).slice(0, 2000) : null;
  if (typeof required === "boolean") update.required = required;
  if (typeof sortOrder === "number") update.sortOrder = sortOrder;
  if (typeof active === "boolean") update.active = active;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Нечего обновлять" }); return; }
  const [row] = await db.update(preTradeChecklistTemplateTable)
    .set(update)
    .where(eq(preTradeChecklistTemplateTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Пункт чек-листа не найден" }); return; }
  res.json(row);
}));

router.delete("/checklist-template/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "checklist.template.edit"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Некорректный id" }); return; }
  const [row] = await db.update(preTradeChecklistTemplateTable)
    .set({ active: false })
    .where(eq(preTradeChecklistTemplateTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Пункт чек-листа не найден" }); return; }
  res.json({ success: true });
}));

/**
 * A response always belongs to the caller. Staff may file one on behalf of a trader
 * (body.trader); for everyone else body.trader is ignored. A tradeId may only point at a
 * trade the caller can access, and must not steal a response already linked elsewhere.
 */
router.post("/checklist-responses", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const me = req.authUser!;
  const { ticker, tradeDate, trader, tradeId, responses, passed } = req.body as Record<string, unknown>;
  if (!ticker || typeof ticker !== "string" || !tradeDate || typeof tradeDate !== "string") {
    res.status(400).json({ error: "Нужны ticker и tradeDate" }); return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) { res.status(400).json({ error: "tradeDate должен быть в формате YYYY-MM-DD" }); return; }
  if (!responses) { res.status(400).json({ error: "Нужны ответы (responses)" }); return; }
  const wanted = typeof trader === "string" && trader.trim() ? trader.trim() : "";
  const staff = !!wanted && wanted !== me.name && (await can(req, "trades.write.any", { trader: wanted }));
  const owner = staff ? wanted : me.name;
  let linkedTradeId: number | null = null;
  if (tradeId != null) {
    if (typeof tradeId !== "number" || !Number.isInteger(tradeId)) { res.status(400).json({ error: "Некорректный tradeId" }); return; }
    const access = await canAccessTrade(req, tradeId);
    if (access === null) { res.status(404).json({ error: "Сделка не найдена" }); return; }
    if (!access) { res.status(403).json({ error: "Это не ваша сделка", code: "FORBIDDEN" }); return; }
    linkedTradeId = tradeId;
  }
  const responsesStr = typeof responses === "string" ? responses : JSON.stringify(responses);
  const [row] = await db.insert(preTradeChecklistResponsesTable).values({
    ticker: ticker.toUpperCase().trim(),
    tradeDate,
    trader: owner,
    tradeId: linkedTradeId,
    responses: responsesStr,
    passed: passed === true,
  }).returning();
  res.status(201).json(row);
}));

router.get("/checklist-responses", asyncHandler(async (req, res): Promise<void> => {
  const { tradeId, ticker, trader, tradeDate } = req.query as Record<string, string | undefined>;
  const scope = await scopeTrader(req, trader);
  if (scope === undefined) { res.status(401).json({ error: "Требуется вход", code: "AUTH_REQUIRED" }); return; }
  if (scope === GUEST_SCOPE) { res.json([]); return; }
  const conditions = [];
  if (tradeId) {
    const id = Number(tradeId);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Некорректный tradeId" }); return; }
    // Lookup by trade: ownership of the trade decides (legacy responses may have trader = null).
    const access = await canAccessTrade(req, id);
    if (!access) { res.json([]); return; }
    conditions.push(eq(preTradeChecklistResponsesTable.tradeId, id));
  } else if (scope !== null) {
    conditions.push(eq(preTradeChecklistResponsesTable.trader, scope));
  }
  if (ticker) conditions.push(eq(preTradeChecklistResponsesTable.ticker, ticker.toUpperCase()));
  if (tradeDate) conditions.push(eq(preTradeChecklistResponsesTable.tradeDate, tradeDate));
  let q = db.select().from(preTradeChecklistResponsesTable).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  const rows = await q.orderBy(desc(preTradeChecklistResponsesTable.createdAt)).limit(100);
  res.json(rows);
}));

router.patch("/checklist-responses/:id/link", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Некорректный id" }); return; }
  const { tradeId } = req.body as Record<string, unknown>;
  if (typeof tradeId !== "number" || !Number.isInteger(tradeId)) { res.status(400).json({ error: "Нужен tradeId" }); return; }
  const [existing] = await db
    .select({ id: preTradeChecklistResponsesTable.id, trader: preTradeChecklistResponsesTable.trader, tradeId: preTradeChecklistResponsesTable.tradeId })
    .from(preTradeChecklistResponsesTable)
    .where(eq(preTradeChecklistResponsesTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Чек-лист не найден" }); return; }
  const staff = await can(req, "trades.write.any", existing.trader ? { trader: existing.trader } : undefined);
  if (!staff && existing.trader && existing.trader !== req.authUser!.name) {
    res.status(403).json({ error: "Это не ваш чек-лист", code: "FORBIDDEN" }); return;
  }
  if (existing.tradeId != null && existing.tradeId !== tradeId) {
    res.status(409).json({ error: "Этот чек-лист уже привязан к другой сделке", code: "CHECKLIST_ALREADY_LINKED" }); return;
  }
  const access = await canAccessTrade(req, tradeId);
  if (access === null) { res.status(404).json({ error: "Сделка не найдена" }); return; }
  if (!access) { res.status(403).json({ error: "Это не ваша сделка", code: "FORBIDDEN" }); return; }
  const [row] = await db.update(preTradeChecklistResponsesTable)
    .set({ tradeId, ...(existing.trader ? {} : { trader: req.authUser!.name }) })
    .where(eq(preTradeChecklistResponsesTable.id, id))
    .returning();
  res.json(row);
}));

/**
 * Used by routes/trades.ts and tradeideas.ts to find the checklist that covers a trade.
 * By tradeId first; otherwise the latest UNLINKED response for that trader/ticker/date —
 * a response already attached to another trade is never re-used (audit §2.2).
 */
export async function findChecklistResponseFor(opts: {
  ticker: string;
  tradeDate: string;
  trader?: string | null;
  tradeId?: number | null;
}): Promise<{ id: number; passed: boolean } | null> {
  if (opts.tradeId) {
    const [r] = await db
      .select({ id: preTradeChecklistResponsesTable.id, passed: preTradeChecklistResponsesTable.passed })
      .from(preTradeChecklistResponsesTable)
      .where(eq(preTradeChecklistResponsesTable.tradeId, opts.tradeId))
      .limit(1);
    if (r) return r;
  }
  const conditions = [
    eq(preTradeChecklistResponsesTable.ticker, opts.ticker.toUpperCase()),
    eq(preTradeChecklistResponsesTable.tradeDate, opts.tradeDate),
    isNull(preTradeChecklistResponsesTable.tradeId),
  ];
  if (opts.trader) conditions.push(eq(preTradeChecklistResponsesTable.trader, opts.trader));
  const [r] = await db
    .select({ id: preTradeChecklistResponsesTable.id, passed: preTradeChecklistResponsesTable.passed })
    .from(preTradeChecklistResponsesTable)
    .where(and(...conditions))
    .orderBy(desc(preTradeChecklistResponsesTable.createdAt))
    .limit(1);
  return r ?? null;
}

export default router;
