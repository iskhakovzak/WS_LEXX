/**
 * Simulator (/simulator) — a hidden real chart, bar by bar, with the desk's fees; the server holds the future.
 *
 *   POST /api/sim/games                {mode, difficulty, tf?}   new game (the previous active one is settled first);
 *                                                                tf = 1m | 2m | 5m (intraday; default = the level's)
 *   GET  /api/sim/games/active                                   the active game (bars up to the cursor) or null
 *   GET  /api/sim/games/:id                                      own game; finished ones carry the reveal
 *   POST /api/sim/games/:id/step       {order?, bracket?, advance, until?} act at the current bar's close, then show N
 *                                                                base bars (≤ 400); until "event" stops at the next market
 *                                                                event / bracket fill (lib/sim/events.ts);
 *                                                                order.sizeMode "risk" (no qty) sizes from 1R and the stop
 *   GET  /api/sim/games/:id/context                              250 daily bars before the game day, key levels, «Контекст дня» (context.ts)
 *   POST /api/sim/games/:id/skip                                 skip (no order yet) / finish (traded) (decisions.ts)
 *   POST /api/sim/games/:id/no-trade                             «Не торгую»: a scored decision (decisions.ts, noTrade.ts)
 *   POST /api/sim/series               {mode, difficulty, tf?, size?}  a series of games (series.ts)
 *   GET  /api/sim/series/active                                  the unfinished series or null
 *   GET  /api/sim/series/:id                                     series state
 *   POST /api/sim/series/:id/next                                settle the current game, deal the prepared next one
 *   POST /api/sim/games/:id/undo                                 cancel the last order (same bar only)
 *   POST /api/sim/games/:id/finish                               close the position, play out the rest flat, reveal
 *   GET  /api/sim/me                                             history, bests, streaks, opt-in
 *   GET  /api/sim/leaderboard?week=YYYY-MM-DD                    weekly desk board (opted-in players + the viewer)
 *   PUT  /api/sim/prefs                {leaderboardVisible}
 *   GET  /api/sim/own/candidates                                 «Мои худшие дни»: the viewer's replayable losses
 *   POST /api/sim/own                  {pick, tradeId?, tf?}     new own game (worst of 30 days | random loss | a trade)
 *
 * Members only (guests are read-only and a game writes). Logic: lib/sim/service.ts; engine: lib/sim/engine.ts.
 */
import { Router, type IRouter, type Request } from "express";
import { forgetQuests } from "../lib/quests/cache";
import { forgetTrainerHome } from "../lib/trainer/cache";
import { z } from "zod";
import { route, idParam, unauthorized, AppError } from "../lib/http";
import { resolveActor } from "../lib/permissions";
import * as sim from "../lib/sim/service";
import { createOwnGame, ownCandidates } from "../lib/sim/ownService";
import { gameContext } from "../lib/sim/context";
import { noTrade, skipGame } from "../lib/sim/decisions";
import { SERIES_DEFAULT_SIZE, SERIES_MAX_SIZE, activeSeries, getSeries, nextGame, startSeries } from "../lib/sim/series";

const router: IRouter = Router();

async function viewerOf(req: Request): Promise<sim.Viewer> {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  return { id: actor.id, name: actor.name, staff: actor.role === "curator" || actor.role === "admin" };
}

const mode = z.enum(["intraday", "swing"]);
const difficulty = z.enum(["easy", "medium", "hard"]);
const price = z.number().finite().positive().max(1_000_000);
const tf = z.enum(["1m", "2m", "5m"]).nullish();

router.post("/sim/games", route({ body: z.object({ mode, difficulty, tf }) }, async ({ req, body }) => {
  return sim.createGame(await viewerOf(req), body.mode, body.difficulty, Math.random, body.mode === "intraday" ? body.tf ?? null : null);
}));

router.get("/sim/games/active", route({}, async ({ req }) => {
  return { game: await sim.activeSnapshot(await viewerOf(req)) };
}));

router.get("/sim/games/:id", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  return sim.gameSnapshot(await viewerOf(req), params.id);
}));

router.post("/sim/games/:id/step", route({
  params: z.object({ id: idParam }),
  body: z.object({
    order: z.object({
      kind: z.enum(["buy", "sell", "flat"]),
      qty: z.number().int().min(1).max(1_000_000).optional(),
      sizeMode: z.enum(["risk"]).nullish(),
    }).nullish(),
    bracket: z.object({ stop: price.nullable(), target: price.nullable() }).nullish(),
    advance: z.number().int().min(0).max(400).default(1),
    until: z.enum(["event"]).nullish(),
  }),
}, async ({ req, params, body }) => {
  const viewer = await viewerOf(req);
  const out = await sim.step(viewer, params.id, body);
  if (out.done) gameEnded(viewer);
  return out;
}));

/** A game just ended (own replay / «Задача дня» / free game): quests, achievements and the trainer home read it. */
function gameEnded(viewer: sim.Viewer): void {
  forgetQuests(viewer.name);
  forgetTrainerHome(viewer.id);
}

router.post("/sim/games/:id/undo", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  return sim.undo(await viewerOf(req), params.id);
}));

router.post("/sim/games/:id/finish", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const viewer = await viewerOf(req);
  const out = await sim.finish(viewer, params.id);
  gameEnded(viewer); // own-day replay / daily challenge quests and achievements
  return out;
}));

router.get("/sim/games/:id/context", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  return gameContext(await viewerOf(req), params.id);
}));

router.post("/sim/games/:id/skip", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const viewer = await viewerOf(req);
  const out = await skipGame(viewer, params.id);
  gameEnded(viewer);
  return out;
}));

router.post("/sim/games/:id/no-trade", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const viewer = await viewerOf(req);
  const out = await noTrade(viewer, params.id);
  gameEnded(viewer);
  return out;
}));

router.post("/sim/series", route({
  body: z.object({ mode, difficulty, tf, size: z.number().int().min(1).max(SERIES_MAX_SIZE).default(SERIES_DEFAULT_SIZE) }),
}, async ({ req, body }) => {
  const viewer = await viewerOf(req);
  const out = await startSeries(viewer, body.mode, body.difficulty, body.mode === "intraday" ? body.tf ?? null : null, body.size);
  gameEnded(viewer); // the previous active game was settled
  return out;
}));

router.get("/sim/series/active", route({}, async ({ req }) => {
  return activeSeries(await viewerOf(req));
}));

router.get("/sim/series/:id", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  return getSeries(await viewerOf(req), params.id);
}));

router.post("/sim/series/:id/next", route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  const viewer = await viewerOf(req);
  const out = await nextGame(viewer, params.id);
  gameEnded(viewer);
  return out;
}));

router.get("/sim/me", route({}, async ({ req }) => {
  return sim.myStats(await viewerOf(req));
}));

router.get("/sim/leaderboard", route({ query: z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }, async ({ req, query }) => {
  return sim.leaderboard(await viewerOf(req), query.week ?? null);
}));

router.put("/sim/prefs", route({ body: z.object({ leaderboardVisible: z.boolean() }) }, async ({ req, body }) => {
  return sim.updatePrefs(await viewerOf(req), body.leaderboardVisible);
}));

router.get("/sim/own/candidates", route({}, async ({ req }) => {
  return ownCandidates(await viewerOf(req));
}));

router.post("/sim/own", route({
  body: z.object({ pick: z.enum(["worst", "random", "trade"]), tradeId: idParam.optional(), tf })
    .refine((b) => b.pick !== "trade" || b.tradeId != null, { message: "tradeId", path: ["tradeId"] }),
}, async ({ req, body }) => {
  return createOwnGame(await viewerOf(req), body.pick, body.tradeId ?? null, Math.random, body.tf ?? null);
}));

export default router;
