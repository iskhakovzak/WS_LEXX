/**
 * «Тренажёр» (owner 2026-10-18: one trainer instead of three) — lib/trainer/*, contract lib/trainer/types.ts.
 *
 *   GET  /api/trainer/home                         TrainerHome (daily state, «Мои дни», «Найди вход» setups, stats)
 *   GET  /api/trainer/daily                        DailyChallengeState of the current challenge (ranking / reveal)
 *   POST /api/trainer/daily/start                  the viewer's game of the current challenge: a sim Snapshot (new,
 *                                                  resumed or finished); played via /api/sim/games/:id/step
 *   POST /api/trainer/daily/practice               the closed challenge (weekend / after the close) as an unranked game
 *   GET  /api/trainer/drill/next?setupId=          FindEntryDrill (no ticker / date / reference entry before the answer)
 *   POST /api/trainer/drill/:id/answer {barIndex, price}  FindEntryAnswer (stored; feeds setup mastery)
 *
 * Members only (guests are read-only and the trainer writes). Every action drops the viewer's quests cache (daily
 * challenge played, drills answered) and the trainer home cache.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { route, idParam, unauthorized, AppError } from "../lib/http";
import { resolveActor } from "../lib/permissions";
import { forgetQuests } from "../lib/quests/cache";
import { setDrillSource } from "../lib/gamification/mastery";
import type { Viewer } from "../lib/sim/service";
import { trainerHome } from "../lib/trainer/home";
import { dailyState, startDaily, startDailyPractice } from "../lib/trainer/daily";
import { answerDrill, nextDrill } from "../lib/trainer/drillService";
import { drillMasteryCounts } from "../lib/trainer/drillStore";

// Setup mastery (G-SERVER lib/gamification/mastery) counts passed «Найди вход» drills from the trainer's store.
setDrillSource(drillMasteryCounts);

const router: IRouter = Router();

async function viewerOf(req: Request): Promise<Viewer> {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  return { id: actor.id, name: actor.name, staff: actor.role === "curator" || actor.role === "admin" };
}

router.get("/trainer/home", route({}, async ({ req }) => trainerHome(await viewerOf(req))));

router.get("/trainer/daily", route({}, async ({ req }) => dailyState(await viewerOf(req))));

router.post("/trainer/daily/start", route({}, async ({ req }) => startDaily(await viewerOf(req))));

router.post("/trainer/daily/practice", route({}, async ({ req }) => startDailyPractice(await viewerOf(req))));

router.get("/trainer/drill/next", route({ query: z.object({ setupId: idParam.optional() }) }, async ({ req, query }) => {
  return nextDrill(await viewerOf(req), query.setupId ?? null);
}));

router.post("/trainer/drill/:id/answer", route({
  params: z.object({ id: idParam }),
  body: z.object({ barIndex: z.number().int().min(0).max(5000), price: z.number().finite().positive().max(1_000_000) }),
}, async ({ req, params, body }) => {
  const viewer = await viewerOf(req);
  const out = await answerDrill(viewer, params.id, body);
  forgetQuests(viewer.name); // «Найди вход» drills answered → quests / achievements / mastery
  return out;
}));

export default router;
