/**
 * Analyst actions → catalyst strength (lib/catalyst/analystSignal + analystStore). The analyst page block «Сила
 * катализатора»: which tickers have a cluster of same-direction calls or a big target change for the plan day, each
 * with its release times and whether it is in my watchlist / my plan / already marked. The strength is only suggested:
 * the trader confirms it with the existing PUT /catalysts/mark (the plan / watchlist taps read the same suggestion
 * through GET /catalysts/day hints).
 *
 *   GET /analyst-actions/signals?date=YYYY-MM-DD   own view (staff too: their own plan / watchlist), any member
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { resolveActor } from "../lib/permissions";
import { AppError, route, unauthorized } from "../lib/http";
import { nyDate } from "../lib/tradingDate";
import { prevSessionDay } from "../lib/catalyst/store";
import { signalsBoard } from "../lib/catalyst/analystStore";

const router: IRouter = Router();
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get("/analyst-actions/signals", route({ query: z.object({ date: YMD.optional() }) }, async ({ req, query }) => {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_NO_PERSONAL");
  const day = query.date ?? nyDate();
  return signalsBoard(actor.name, day, await prevSessionDay(day));
}));

export default router;
