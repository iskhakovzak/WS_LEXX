/**
 * «Мой разбор» (Волна 2 п. 2.9) — lib/myReview.ts.
 *
 *   GET /my-review?days=30   the viewer's OWN trades only (any ?trader= is ignored — staff open /analytics for others):
 *                            where I earn (top 3 setups / tickers / hours), where I lose (costliest patterns + worst 3),
 *                            one rule for tomorrow; `edge` = the edge-map verdicts (R4) the page shows as «где
 *                            зарабатываю / теряю» (≤ 3 each, $ per active day with an 80% interval). days ∈ [7, 90], default 30. A guest gets an empty review.
 *                            excludeImx=1 leaves close-auction (IMX) trades out; `imx` = their count / net either way.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { assertCap, route } from "../lib/http";
import { isGuestUser } from "../lib/auth";
import { addDays, nyDate } from "../lib/tradingDate";
import { clampDays, myReview, type MyReview } from "../lib/myReview";

const router: IRouter = Router();

const query = z.object({ days: z.string().max(4).optional(), excludeImx: z.string().max(5).optional() }).passthrough();

/** The answer for a viewer without trades of his own (a guest). */
export function emptyReview(days: number, now = new Date()): MyReview {
  const to = nyDate(now);
  return {
    trader: "", days, from: addDays(to, -(days - 1)), to,
    totals: { trades: 0, net: 0, r: null, winRate: null },
    earn: { setup: [], ticker: [], hour: [] },
    lose: { patterns: [], setup: [], ticker: [], hour: [] },
    edge: null,
    rule: null,
    generatedAt: now.toISOString(),
  };
}

router.get("/my-review", route({ query }, async ({ req, query: q, res }) => {
  res.setHeader("Cache-Control", "private, no-cache");
  const days = clampDays(q.days);
  if (isGuestUser(req.authUser)) return emptyReview(days);
  const me = req.authUser?.name ?? "";
  await assertCap(req, "trades.read.own", { trader: me });
  return myReview(me, days, undefined, { excludeImx: q.excludeImx === "1" || q.excludeImx === "true" }); // «Исключить IMX» (lib/imxSummary)
}));

export default router;
