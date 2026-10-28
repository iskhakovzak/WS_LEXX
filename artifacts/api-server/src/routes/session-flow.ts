/**
 * Session flow (lib/sessionFlow/*): re-entries, chases, the give-back from the day's peak and the green-to-red cross —
 * all derived from PropReports fills, nothing typed in.
 *
 *   GET /session-flow/stats?trader=&from=&to=   own book (staff: trades.read.team) — re-entry buckets 1 / 2 / 3 / 4+,
 *                                               the chase trades, the flagged give-back days and green-to-red days
 * GET never writes.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { personalTrader } from "../lib/auth";
import { route } from "../lib/http";
import { addDays, nyDate } from "../lib/tradingDate";
import { flowStats } from "../lib/sessionFlow/stats";

const router: IRouter = Router();

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A window longer than this is cut to its last part. */
const MAX_DAYS = 730;
/** Without `from`: the last 90 calendar days. */
const DEFAULT_DAYS = 90;

router.get("/session-flow/stats", route({
  query: z.object({ trader: z.string().trim().max(120).optional(), from: YMD.optional(), to: YMD.optional() }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "trades.read.team");
  const to = query.to ?? nyDate();
  const floor = addDays(to, -MAX_DAYS);
  const from = !query.from ? addDays(to, -DEFAULT_DAYS) : query.from > floor ? query.from : floor;
  return flowStats(trader, from, to);
}));

export default router;
