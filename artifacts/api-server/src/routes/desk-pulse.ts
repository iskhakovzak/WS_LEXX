/**
 * «Пульс деска: что работает в сезоне» (lib/deskPulse). Desk-level aggregates only — never a person's row.
 *
 *   GET /desk-pulse   every signed-in member: the setup family × timing cells of the last pulse.windowDays (count, win
 *                     rate, net without the top 3, median R, «outliers», greyed below the minimum sample). Staff
 *                     (trades.read.team) see every number; a trader sees a cell's numbers only when it spans at least
 *                     three people (lib/moneyVisibility) and never the $ median of one trade.
 * GET never writes.
 */
import { Router, type IRouter } from "express";
import { route } from "../lib/http";
import { can } from "../lib/permissions";
import { pulseView } from "../lib/deskPulse/store";

const router: IRouter = Router();

router.get("/desk-pulse", route({}, async ({ req }) => {
  const staff = await can(req, "trades.read.team");
  return { ...(await pulseView(staff)), staff };
}));

export default router;
