/**
 * Coaching evidence for staff (roadmap Wave 1).
 *
 *   GET /interventions?trader=&limit=   R9a: the trader's logged curator interventions, newest first (journal.review on
 *                                       that trader: a curator with the «assigned» scope sees only his wards). The
 *                                       effect of each one is not estimated yet (R9b, Wave 2): `effect` is always null.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { assertCap, route } from "../lib/http";
import { listInterventions } from "../lib/interventions/log";

const router: IRouter = Router();

const traderName = z.string().trim().min(1).max(100);

router.get("/interventions", route({
  query: z.object({ trader: traderName, limit: z.coerce.number().int().min(1).max(200).optional() }).passthrough(),
}, async ({ req, query }) => {
  await assertCap(req, "journal.review", { trader: query.trader });
  const rows = await listInterventions(query.trader, query.limit ?? 50);
  return { trader: query.trader, interventions: rows.map((r) => ({ ...r, effect: null })) };
}));

export default router;
