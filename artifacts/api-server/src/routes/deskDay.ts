// «Деск на тикере» — one ticker-day across the desk (lib/deskDay.ts, lib/deskDayStore.ts).
//
//   GET /desk-day/:ticker/:date           every trade of the ticker on that NY date: legs, side, result, R, hold time,
//                                         takeaways. $ / share counts only for trades the viewer may see money for
//                                         (lib/playbookPrivacy: own trades; staff all).
//   GET /desk-day/:ticker/:date/summary   { ticker, date, traders, traded, others } — cheap count for entry points.
//   GET /desk-day/counts?date=&tickers=   the same for several tickers of one day (day report).
//
// Signed-in members only (trades.read.own: every role but guest). Names: staff always see them; traders see day aliases
// unless their stage sees names (lib/access/names.ts; lib/deskDay.ts — views). Candles: GET /candles/:ticker/day/:date.
// While names are hidden, a trader's `trader` perspective in the counts is always themselves — otherwise «did X trade
// this ticker?» probes across tickers would map aliases back to names.
import { Router, type IRouter } from "express";
import { z } from "zod";
import { parseDateStrict } from "../lib/candleDay";
import { loadMoneyViewer } from "../lib/playbookAccess";
import { deskDayCounts, loadDeskDay } from "../lib/deskDayStore";
import { route } from "../lib/http";
import type { Actor } from "../lib/permissions";
import { namesVisible } from "../lib/access/names";
import { recordQuestEvent } from "../lib/quests/store";
import { forgetQuests } from "../lib/quests/cache";
import { nyDate } from "../lib/tradingDate";

const router: IRouter = Router();

const tickerSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-]{0,10}$/);
const daySchema = z.string().refine((s) => parseDateStrict(s) != null, "YYYY-MM-DD");
const traderSchema = z.string().trim().min(1).max(120).optional();
const CAP = "trades.read.own" as const;

/** Whose perspective «others» is counted from (see the header). */
async function perspective(actor: Actor, trader: string | undefined): Promise<string> {
  const staff = actor.role === "curator" || actor.role === "admin";
  if (!trader || !(await namesVisible({ name: actor.name, staff }))) return actor.name;
  return trader;
}

router.get("/desk-day/counts", route({
  cap: CAP,
  query: z.object({
    date: daySchema,
    tickers: z.string().transform((s) => [...new Set(s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))])
      .pipe(z.array(tickerSchema).min(1).max(50)),
    trader: traderSchema,
  }),
}, async ({ query, actor, res }) => {
  res.setHeader("Cache-Control", "private, no-cache");
  return { date: query.date, items: await deskDayCounts(query.tickers, query.date, await perspective(actor, query.trader)) };
}));

router.get("/desk-day/:ticker/:date/summary", route({
  cap: CAP,
  params: z.object({ ticker: tickerSchema, date: daySchema }),
  query: z.object({ trader: traderSchema }),
}, async ({ params, query, actor, res }) => {
  res.setHeader("Cache-Control", "private, no-cache");
  const [c] = await deskDayCounts([params.ticker], params.date, await perspective(actor, query.trader));
  return { date: params.date, ...c };
}));

router.get("/desk-day/:ticker/:date", route({
  cap: CAP,
  params: z.object({ ticker: tickerSchema, date: daySchema }),
}, async ({ params, req, res, actor }) => {
  res.setHeader("Cache-Control", "private, no-cache");
  const out = await loadDeskDay(params.ticker, params.date, await loadMoneyViewer(req));
  // Onboarding quest «open Desk on a ticker» (lib/quests: counts only a ticker-day the viewer traded). Never throws.
  if (await recordQuestEvent(actor.name, "desk_day_open", `${params.ticker}|${params.date}`, nyDate())) forgetQuests(actor.name);
  return out;
}));

export default router;
