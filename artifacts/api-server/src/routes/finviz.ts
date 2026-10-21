/**
 * Finviz Elite data for the desk (lib/finviz/*; shapes in lib/finviz/types.ts, contract for the web in
 * components/finviz). Every read answers from the DB (filled by the finviz.* jobs) — no Finviz call per request.
 *
 *   GET  /api/finviz/status                         FinvizStatus (enabled = FINVIZ_AUTH set + desk switch on)
 *   GET  /api/finviz/screener?preset=               ScreenerResponse (latest ok run of the preset)
 *   GET  /api/finviz/ticker/:symbol                 TickerSnapshot | null (a miss queues the ticker for the next run)
 *   GET  /api/finviz/earnings?from=&to=             EarningsRow[] (default today … +14 days, span ≤ 31 days)
 *   GET  /api/finviz/earnings/today?tickers=A,B     EarningsRow[] of the given tickers: today, or next trading day bmo
 *   POST /api/finviz/refresh { kind? }              staff (gameplan.publish | dailyfeed.manage), cooldown per kind
 *
 * Reads: any signed-in member (global auth gate). The token never leaves the server.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { AppError, route } from "../lib/http";
import { nyDate } from "../lib/tradingDate";
import { nextTradingDay } from "../lib/finviz/jobs";
import { finvizEnabled } from "../lib/finviz/presets";
import { readEarnings, readEarningsSoon, readScreener, readSnapshot, readStatus } from "../lib/finviz/read";
import { runRefresh, startRefresh } from "../lib/finviz/refresh";
import { requestTicker, shiftDay } from "../lib/finviz/store";
import { REFRESH_KINDS, SCREENER_PRESETS } from "../lib/finviz/types";

const router: IRouter = Router();

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const SymbolParam = z.string().trim().transform((s) => s.toUpperCase().replace(/^\$/, "")).pipe(z.string().regex(TICKER));
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)));
const MAX_SPAN_DAYS = 31;

router.get("/finviz/status", route({}, async () => readStatus(finvizEnabled())));

router.get("/finviz/screener", route({ query: z.object({ preset: z.enum(SCREENER_PRESETS) }) }, async ({ query }) =>
  readScreener(query.preset)));

router.get("/finviz/ticker/:symbol", route({ params: z.object({ symbol: SymbolParam }) }, async ({ params }) => {
  const snap = await readSnapshot(params.symbol);
  if (!snap && finvizEnabled()) await requestTicker(params.symbol);
  return snap ?? null;
}));

const EarningsQuery = z.object({ from: Day.optional(), to: Day.optional() }).transform((q, ctx) => {
  const from = q.from ?? nyDate();
  const to = q.to ?? shiftDay(from, 14);
  const span = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  if (span < 0 || span > MAX_SPAN_DAYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: `0…${MAX_SPAN_DAYS} days after from` });
    return z.NEVER;
  }
  return { from, to };
});

router.get("/finviz/earnings/today", route({
  query: z.object({ tickers: z.string().max(1200).optional() }),
}, async ({ query }) => {
  const tickers = [...new Set((query.tickers ?? "").split(",").map((t) => t.trim().toUpperCase().replace(/^\$/, "")).filter((t) => TICKER.test(t)))];
  if (tickers.length > 100) throw new AppError("VALIDATION", 400, undefined, [{ path: "query.tickers", message: "≤ 100 tickers" }]);
  if (!tickers.length) return [];
  const today = nyDate();
  return readEarningsSoon(tickers, today, await nextTradingDay(today));
}));

router.get("/finviz/earnings", route({ query: EarningsQuery }, async ({ query }) => readEarnings(query.from, query.to)));

router.post("/finviz/refresh", route({
  cap: ["gameplan.publish", "dailyfeed.manage"],
  body: z.object({ kind: z.enum(REFRESH_KINDS).default("screener") }),
}, async ({ body, res }) => {
  if (!finvizEnabled()) throw new AppError("FINVIZ_NOT_CONFIGURED");
  startRefresh(body.kind, res);
  return runRefresh(body.kind);
}));

export default router;
