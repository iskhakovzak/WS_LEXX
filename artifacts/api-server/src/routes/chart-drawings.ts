/**
 * Chart drawings and the plan overlay of the trade chart (replay / analysis).
 *
 * Drawings — per user (the signed-in user only — no one reads another user's drawings), ONE set per ticker (Волна 2
 * п. 2.12: a level drawn yesterday is on today's chart; lib/chartDrawings.ts). `date` is accepted for older clients and
 * ignored. Contract ChartDrawing in lib/trainer/types.ts, validation in lib/trainer/drawings.ts.
 *   GET /api/chart/drawings?ticker=INTC[&date=…]   → { drawings: ChartDrawing[] } ([] when none)
 *   PUT /api/chart/drawings?ticker=INTC[&date=…]   { drawings } → { drawings } (replaces the ticker's set)
 *
 * Plan overlay — the morning plan's levels and the setup label on the trade chart (lib/chartPlanOverlay.ts):
 *   GET /api/chart/plan-overlay?trade=<id>          a readable trade; the owner's own plan only for the owner and staff
 *                                                   who review them (journal.review), else the desk plan only
 *   GET /api/chart/plan-overlay?ticker=&date=       the viewer's own plan (+ desk plan) of that day
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { route, unauthorized, AppError, forbidden, notFound } from "../lib/http";
import { can, resolveActor } from "../lib/permissions";
import { canAccessTrade } from "../lib/auth";
import { drawingsSchema, normalizeDrawings } from "../lib/trainer/drawings";
import { loadTickerDrawings, saveTickerDrawings } from "../lib/chartDrawings";
import { loadPlanOverlay, tradeForOverlay } from "../lib/chartPlanOverlay";

const router: IRouter = Router();

const tickerSchema = z.string().trim().min(1).max(11).transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z][-A-Z0-9.]{0,10}$/));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({ ticker: tickerSchema, date: day.optional() });

async function userOf(req: Request, write: boolean): Promise<{ id: number; name: string }> {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (write && actor.guest) throw new AppError("GUEST_READ_ONLY");
  return { id: actor.id, name: actor.name };
}

router.get("/chart/drawings", route({ query }, async ({ req, query: q }) => {
  return { drawings: await loadTickerDrawings((await userOf(req, false)).id, q.ticker) };
}));

router.put("/chart/drawings", route({ query, body: z.object({ drawings: drawingsSchema }) }, async ({ req, query: q, body }) => {
  return { drawings: await saveTickerDrawings((await userOf(req, true)).id, q.ticker, normalizeDrawings(body.drawings)) };
}));

const overlayQuery = z.union([
  z.object({ trade: z.coerce.number().int().positive() }),
  z.object({ ticker: tickerSchema, date: day }),
]);

router.get("/chart/plan-overlay", route({ query: overlayQuery }, async ({ req, query: q }) => {
  const me = await userOf(req, false);
  if ("trade" in q) {
    const access = await canAccessTrade(req, q.trade, "read");
    if (access === null) throw notFound("TRADE_NOT_FOUND");
    if (!access) throw forbidden();
    const t = await tradeForOverlay(q.trade);
    if (!t) throw notFound("TRADE_NOT_FOUND");
    // Someone's own day plan is private: the owner and the staff who review them; others see the desk plan only.
    const planOf = t.trader && (t.trader === me.name || (await can(req, "journal.review", { trader: t.trader }))) ? t.trader : null;
    return loadPlanOverlay(planOf, t.ticker, t.date, t.setup);
  }
  return loadPlanOverlay(me.name, q.ticker, q.date, null);
}));

export default router;
