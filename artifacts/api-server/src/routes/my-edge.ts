/**
 * «Мой edge и рынок» (analytics tab) — one trader's strengths / leaks, results by market context, this period vs the
 * previous one, and today's market line. GET only, no tables created, stored / cached data only (lib/myEdge/*).
 *
 *   GET /my-edge/strengths ?trader=&from=&to=&horizon=&side=&account=&source=&setup=&ticker=&x*…(«Разрезы»)
 *   GET /my-edge/market    same query
 *   GET /my-edge/compare   same query + prevFrom & prevTo (required)
 *   GET /my-edge/today     ?trader=
 *
 * Scope: lib/auth scopeTrader — a member always gets their own book; staff the named trader (default: themselves —
 * this tab is about ONE person, the «Вся команда» view asks to pick someone). Money is the viewer's own or staff's.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { scopeTrader } from "../lib/auth";
import { badRequest, unauthorized } from "../lib/http";
import { FACET_QUERY, facetFiltersOf } from "../lib/tradesPageParams";
import { facetCacheKey } from "../lib/tradeFacetsFilter";
import { compare, market, strengths, today } from "../lib/myEdge/service";
import type { MeLoadFilters } from "../lib/myEdge/load";

const router: IRouter = Router();

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const baseSchema = z.object({
  trader: z.string().trim().max(120).optional(),
  from: YMD.optional(),
  to: YMD.optional(),
  horizon: z.enum(["intraday", "overnight", "swing"]).optional(),
  side: z.string().trim().max(20).optional(),
  account: z.string().trim().max(120).optional(),
  source: z.enum(["manual", "propreports"]).optional(),
  setup: z.string().trim().max(200).optional(),
  ticker: z.string().trim().max(20).optional(),
  ...FACET_QUERY,
});
const compareSchema = baseSchema.extend({ prevFrom: YMD, prevTo: YMD });

function clean(q: Request["query"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.trim() !== "") out[k] = s;
  }
  return out;
}

type Base = z.infer<typeof baseSchema>;

async function scoped(req: Request, q: Base): Promise<{ trader: string; filters: MeLoadFilters; key: string }> {
  const scope = await scopeTrader(req, q.trader);
  if (scope === undefined || !req.authUser) throw unauthorized();
  const trader = scope ?? req.authUser.name;
  const facets = facetFiltersOf(q);
  const filters: MeLoadFilters = {
    from: q.from, to: q.to, horizon: q.horizon, side: q.side, account: q.account, source: q.source, setup: q.setup, ticker: q.ticker, facets,
  };
  const key = JSON.stringify([trader, q.from, q.to, q.horizon, q.side, q.account, q.source, q.setup, q.ticker, facetCacheKey(facets)]);
  return { trader, filters, key };
}

function parse<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const parsed = schema.safeParse(clean(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  return parsed.data;
}

router.get("/my-edge/strengths", asyncHandler(async (req, res) => {
  const { trader, filters, key } = await scoped(req, parse(baseSchema, req));
  res.json({ ...(await strengths(trader, filters, key)), generatedAt: new Date().toISOString() });
}));

router.get("/my-edge/market", asyncHandler(async (req, res) => {
  const { trader, filters, key } = await scoped(req, parse(baseSchema, req));
  res.json({ ...(await market(trader, filters, key)), generatedAt: new Date().toISOString() });
}));

router.get("/my-edge/compare", asyncHandler(async (req, res) => {
  const q = parse(compareSchema, req);
  const { trader, filters, key } = await scoped(req, q);
  res.json({ ...(await compare(trader, filters, { from: q.prevFrom, to: q.prevTo }, key)), generatedAt: new Date().toISOString() });
}));

router.get("/my-edge/today", asyncHandler(async (req, res) => {
  const q = parse(z.object({ trader: z.string().trim().max(120).optional() }), req);
  const scope = await scopeTrader(req, q.trader);
  if (scope === undefined || !req.authUser) throw unauthorized();
  res.json({ ...(await today(scope ?? req.authUser.name)), generatedAt: new Date().toISOString() });
}));

export default router;
