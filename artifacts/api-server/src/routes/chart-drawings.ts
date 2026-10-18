/**
 * Chart drawings on a ticker-day (replay / analysis; lib/trainer/drawings.ts, contract ChartDrawing in
 * lib/trainer/types.ts). Per user (the signed-in user only — no one reads another user's drawings).
 *
 *   GET /api/chart/drawings?ticker=INTC&date=2026-10-16   → { drawings: ChartDrawing[] } ([] when none)
 *   PUT /api/chart/drawings?ticker=INTC&date=2026-10-16   { drawings } → { drawings } (replaces the set)
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { route, unauthorized, AppError } from "../lib/http";
import { resolveActor } from "../lib/permissions";
import { drawingsSchema, loadDrawings, normalizeDrawings, saveDrawings } from "../lib/trainer/drawings";

const router: IRouter = Router();

const query = z.object({
  ticker: z.string().trim().min(1).max(11).transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z][-A-Z0-9.]{0,10}$/)),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function userOf(req: Request, write: boolean): Promise<number> {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (write && actor.guest) throw new AppError("GUEST_READ_ONLY");
  return actor.id;
}

router.get("/chart/drawings", route({ query }, async ({ req, query: q }) => {
  return { drawings: await loadDrawings(await userOf(req, false), q.ticker, q.date) };
}));

router.put("/chart/drawings", route({ query, body: z.object({ drawings: drawingsSchema }) }, async ({ req, query: q, body }) => {
  return { drawings: await saveDrawings(await userOf(req, true), q.ticker, q.date, normalizeDrawings(body.drawings)) };
}));

export default router;
