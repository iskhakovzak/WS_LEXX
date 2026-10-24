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
 *   GET  /curator/stuck?scope=          R6: «Застряли» — the roster's traders whose latest snapshot is a plateau (not at
 *                                       the stage's pace yet): tenure, pace vs target with the 80% interval, severity,
 *                                       escalation, the diagnosis pack. journal.review; scope = mine | desk as in
 *                                       /curator/today (lib/curatorRoster). Staff-only: a junior never sees it.
 *   POST /curator/stuck/:trader/one-on-one   «Назначить разбор 1:1 по шаблону»: a 1:1 on the next trading day with
 *                                       the diagnosis-pack agenda + one intervention row (plateau_review). 404
 *                                       TRADER_NOT_FOUND when the trader has no current plateau snapshot.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { assertCap, notFound, route } from "../lib/http";
import { listInterventions } from "../lib/interventions/log";
import { personalTrader } from "../lib/auth";
import { edgeMapView } from "../lib/edgeMapStore";
import { loadRoster } from "../lib/curatorRoster";
import { scheduleReview, stuckList } from "../lib/plateauStore";
import { langOf } from "../i18n";

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

router.get("/curator/stuck", route({
  cap: "journal.review",
  query: z.object({ scope: z.enum(["mine", "desk", "group", "all"]).optional() }).passthrough(),
}, async ({ req, query }) => {
  const roster = await loadRoster(req, query.scope);
  return { scope: roster.scope, items: await stuckList(roster.traders) };
}));

router.post("/curator/stuck/:trader/one-on-one", route({
  cap: "journal.review",
  params: z.object({ trader: traderName }),
}, async ({ req, res, params, actor }) => {
  await assertCap(req, "journal.review", { trader: params.trader });
  const out = await scheduleReview(params.trader, actor.name, langOf(req));
  if (!out) throw notFound("TRADER_NOT_FOUND");
  res.status(201).json(out);
}));

export default router;
