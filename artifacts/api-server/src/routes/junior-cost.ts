/**
 * «Цена джуна до безубытка» (lib/juniorCost/*). Definitions: lib/juniorCost/path.ts header.
 *
 *   GET /junior-cost/trader?trader=   own path, or staff with trades.read.team (scope-aware): the curve, breakeven,
 *                                     price, projection; plus the anonymous desk median when ≥ DESK_AGGREGATE_MIN_TRADERS
 *                                     juniors reached breakeven (lib/moneyVisibility: a sum over fewer reveals people)
 *   GET /junior-cost/desk             staff with trades.read.team: every aggregate (cohorts, «что окупается»), junior rows
 *                                     only of the traders the viewer's scope reads
 * GET never writes. The seat cost and the breakeven window are desk settings (academy.juniorCost.*).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { personalTrader } from "../lib/auth";
import { route } from "../lib/http";
import { readScope } from "../lib/permissions";
import { DESK_AGGREGATE_MIN_TRADERS } from "../lib/moneyVisibility";
import { deskBenchmark, scopeDesk } from "../lib/juniorCost/desk";
import { deskJuniorCost, juniorCostSettings, traderJuniorCost } from "../lib/juniorCost/store";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/junior-cost/trader", route({ query: z.object({ trader: z.string().trim().max(120).optional() }) }, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "trades.read.team");
  const [path, desk] = await Promise.all([
    traderJuniorCost(trader),
    deskJuniorCost().catch((err) => { logger.warn({ err }, "junior-cost: desk benchmark unavailable"); return null; }),
  ]);
  return { trader, settings: juniorCostSettings(), path, desk: desk ? deskBenchmark(desk, DESK_AGGREGATE_MIN_TRADERS) : null };
}));

router.get("/junior-cost/desk", route({ cap: "trades.read.team" }, async ({ req, res }) => {
  const [desk, scope] = await Promise.all([deskJuniorCost(), readScope(req, "trades.read.team")]);
  res.setHeader("Cache-Control", "private, no-store");
  return scopeDesk(desk, scope);
}));

export default router;
