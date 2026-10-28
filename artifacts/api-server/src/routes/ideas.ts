/**
 * Idea tiers and setup checklists of the morning plan (lib/sessionFlow/ideaStore.ts, migration 0280). Plans are where
 * manual input belongs: tier, «authored», the setup and its checklist ticks. Trades are never touched — they link to an
 * idea by (trader, NY entry day, ticker, side) when they are read.
 *
 *   GET /ideas/day?date=&tickers=&trader=   own day (staff: a trader's with journal.read.team) — the ideas with their
 *                                            checklist score, the suggested risk and the limits; suggestions for the rest
 *   PUT /ideas/mark                          the caller's own idea — { date, ticker, side?, tier?, authored?, setupId?,
 *                                            checks?, source? } (the score is computed on the server)
 *   GET /ideas/stats?trader=&from=&to=       own book (staff: trades.read.team) — by tier, by checklist band, authored,
 *                                            the missed tier 1–2 ideas
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { personalTrader } from "../lib/auth";
import { resolveActor } from "../lib/permissions";
import { AppError, route, unauthorized } from "../lib/http";
import { addDays, nyDate } from "../lib/tradingDate";
import { normTicker } from "../lib/catalyst/model";
import { dayView, ideaStats, saveIdea } from "../lib/sessionFlow/ideaStore";

const router: IRouter = Router();

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_AHEAD_DAYS = 4;
const MAX_STATS_DAYS = 730;

router.get("/ideas/day", route({
  query: z.object({ date: YMD.optional(), tickers: z.string().max(2000).optional(), trader: z.string().trim().max(120).optional() }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "journal.read.team");
  const tickers = [...new Set((query.tickers ?? "").split(",").map(normTicker).filter((t): t is string => !!t))].slice(0, 60);
  return dayView(trader, query.date ?? nyDate(), tickers);
}));

router.put("/ideas/mark", route({
  body: z.object({
    date: YMD,
    ticker: z.string().trim().max(12),
    side: z.enum(["long", "short"]).nullish(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
    authored: z.boolean().optional(),
    setupId: z.number().int().positive().nullish(),
    checks: z.record(z.string().max(64), z.boolean()).optional().refine((c) => !c || Object.keys(c).length <= 40, "checks"),
    source: z.enum(["plan", "watchlist"]).optional(),
  }),
}, async ({ req, body }) => {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  const ticker = normTicker(body.ticker);
  if (!ticker) throw new AppError("INVALID_TICKER");
  if (body.date > addDays(nyDate(), MAX_AHEAD_DAYS)) throw new AppError("DAY_IN_FUTURE");
  return saveIdea(actor.name, body.date, ticker, {
    side: body.side, tier: body.tier, authored: body.authored, setupId: body.setupId, checks: body.checks, source: body.source,
  });
}));

router.get("/ideas/stats", route({
  query: z.object({ trader: z.string().trim().max(120).optional(), from: YMD.optional(), to: YMD.optional() }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "trades.read.team");
  const to = query.to ?? nyDate();
  const floor = addDays(to, -MAX_STATS_DAYS);
  const from = !query.from ? addDays(to, -90) : query.from > floor ? query.from : floor;
  return ideaStats(trader, from, to);
}));

export default router;
