/**
 * Catalyst direction × strength (lib/catalyst/*, migration 0276): the two quick taps of the morning plan and the
 * watchlist, the prefill suggestions, and the catalyst slice of the analytics «Эдж» tab.
 *
 *   GET /catalysts/day?date=&tickers=&trader=   own day (staff: a trader's with journal.read.team) — the marks of the
 *                                                day and the suggested direction per shown ticker (event / earnings / gap)
 *   PUT /catalysts/mark                          the caller's own mark — { date, ticker, direction, strength, kind?,
 *                                                source, suggested } (both taps null = cleared). Staff mark their own day too.
 *   GET /catalysts/edge?trader=&from=&to=        own book (staff: trades.read.team) — P&L / win rate / expectancy / count
 *                                                by strength × direction and per setup × strength, the insight line
 * Trades are never touched: PropReports trades link to a mark by (trader, entry day, ticker) when they are read.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { personalTrader } from "../lib/auth";
import { resolveActor } from "../lib/permissions";
import { AppError, route, unauthorized } from "../lib/http";
import { addDays, nyDate } from "../lib/tradingDate";
import { DIRECTIONS, KINDS, MARK_SOURCES, STRENGTHS, normTicker } from "../lib/catalyst/model";
import { dayHintsOf, edgeOf, marksOf, saveMark } from "../lib/catalyst/store";

const router: IRouter = Router();

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Ticker = z.string().trim().max(12).transform((v, ctx) => {
  const t = normTicker(v);
  if (!t) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ticker" });
  return t ?? "";
});
/** How far ahead a mark may be set (the evening plan for the next session / a long weekend). */
const MAX_AHEAD_DAYS = 4;
/** A window longer than this is cut to its last part (the analytics «Всё время» on a big book). */
const MAX_EDGE_DAYS = 730;

router.get("/catalysts/day", route({
  query: z.object({ date: YMD.optional(), tickers: z.string().max(2000).optional(), trader: z.string().trim().max(120).optional() }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "journal.read.team");
  const date = query.date ?? nyDate();
  const tickers = [...new Set((query.tickers ?? "").split(",").map(normTicker).filter((t): t is string => !!t))].slice(0, 60);
  const [marks, hints] = await Promise.all([marksOf(trader, date, date), dayHintsOf(date, tickers)]);
  return { trader, date, marks, hints };
}));

router.put("/catalysts/mark", route({
  body: z.object({
    date: YMD,
    ticker: Ticker,
    direction: z.enum(DIRECTIONS).nullable(),
    strength: z.enum(STRENGTHS).nullable(),
    kind: z.enum(KINDS).nullish(),
    source: z.enum(MARK_SOURCES).default("plan"),
    suggested: z.boolean().default(false),
  }),
}, async ({ req, body }) => {
  const actor = await resolveActor(req);
  if (!actor) throw unauthorized();
  if (actor.guest) throw new AppError("GUEST_READ_ONLY");
  if (Number.isNaN(Date.parse(`${body.date}T12:00:00Z`))) throw new AppError("INVALID_DATE");
  if (body.date > addDays(nyDate(), MAX_AHEAD_DAYS)) throw new AppError("DAY_IN_FUTURE");
  return saveMark(actor.name, body.date, body.ticker, {
    direction: body.direction, strength: body.strength, kind: body.kind ?? null, source: body.source,
    suggested: body.suggested && body.direction != null,
  });
}));

router.get("/catalysts/edge", route({
  query: z.object({ trader: z.string().trim().max(120).optional(), from: YMD.optional(), to: YMD.optional() }),
}, async ({ req, query }) => {
  const trader = await personalTrader(req, query.trader, "trades.read.team");
  const to = query.to ?? nyDate();
  const floor = addDays(to, -MAX_EDGE_DAYS);
  const from = query.from && query.from > floor ? query.from : floor;
  return { trader, from, to, ...(await edgeOf(trader, from, to)) };
}));

export default router;
