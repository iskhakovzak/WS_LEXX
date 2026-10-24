/**
 * Coaching evidence for staff (roadmap Wave 1).
 *
 *   GET /interventions?trader=&limit=   R9a: the trader's logged curator interventions, newest first (journal.review on
 *                                       that trader: a curator with the «assigned» scope sees only his wards). The
 *                                       effect of each one is not estimated yet (R9b, Wave 2): `effect` is always null.
 *   GET /edge/map?trader=               R4: the latest edge-map verdicts — at most 3 «где зарабатываю» (STRENGTH) and 3
 *                                       «где теряю» (LEAK) rows, each θ in $ per active day with its 80% interval. Own
 *                                       data for anyone; another trader with journal.read.team (curators: their scope).
 *                                       Raw slice tables never leave the server.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { assertCap, route } from "../lib/http";
import { listInterventions } from "../lib/interventions/log";
import { personalTrader } from "../lib/auth";
import { edgeMapView } from "../lib/edgeMapStore";

const router: IRouter = Router();

const traderName = z.string().trim().min(1).max(100);

router.get("/interventions", route({
  query: z.object({ trader: traderName, limit: z.coerce.number().int().min(1).max(200).optional() }).passthrough(),
}, async ({ req, query }) => {
  await assertCap(req, "journal.review", { trader: query.trader });
  const rows = await listInterventions(query.trader, query.limit ?? 50);
  return { trader: query.trader, interventions: rows.map((r) => ({ ...r, effect: null })) };
}));

router.get("/edge/map", route({ query: z.object({ trader: traderName.optional() }).passthrough() }, async ({ req, query, res }) => {
  const trader = await personalTrader(req, query.trader);
  res.setHeader("Cache-Control", "private, no-cache");
  return edgeMapView(trader);
}));

export default router;
