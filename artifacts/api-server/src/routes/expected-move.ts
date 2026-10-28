/**
 * Expected move on earnings (lib/expectedMove/*, migration 0278) for the earnings calendar and the watchlist.
 *
 *   GET /expected-move?tickers=A,B&date=   any signed-in member — per ticker the next report (≤ 10 days) or the last one
 *                                          (≤ 7 days back): EM %, its source (implied snapshot / historical average),
 *                                          prior close, the EM levels and, after the report, the move and «EM broken»
 * GET never writes (the implied snapshot is taken by the job «em.snapshot»). Market data only: no person in it.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { route, unauthorized } from "../lib/http";
import { nyDate } from "../lib/tradingDate";
import { expectedMoves } from "../lib/expectedMove/store";

const router: IRouter = Router();

router.get("/expected-move", route({
  query: z.object({ tickers: z.string().max(2000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
}, async ({ req, query }) => {
  if (!req.authUser) throw unauthorized();
  const tickers = query.tickers.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const date = query.date ?? nyDate();
  return { date, items: await expectedMoves(tickers, date) };
}));

export default router;
