/**
 * The lab's multi-trade views (/chart-lab «Наложение» and «Выходы»), read only, bars from the candle archive only:
 *   GET /api/chart-lab/facets?trader=                    setups and tickers of the trader with counts (the picker)
 *   GET /api/chart-lab/overlay?trader=&setup=|ticker=&unit=pct|r   entries aligned at the entry minute (lib/chartLab/overlayMath)
 *   GET /api/chart-lab/exits?trader=&setup=|ticker=      «где лучше выходить» per setup (lib/chartLab/exitMath)
 * Scope: lib/auth scopeTrader — a trader sees their own trades; staff may pick a trader (none picked = their own).
 * At most LAB_MAX_TRADES (the newest) per request; days missing from the archive are counted, never fetched.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { scopeTrader } from "../lib/auth";
import { badRequest, unauthorized } from "../lib/http";
import { labFacets, loadLabBars, loadLabTrades, type LabTrade } from "../lib/chartLab/load";
import { MAX_BAR_SEC, overlayOf, type OverlayUnit } from "../lib/chartLab/overlayMath";
import { aggregateExits, tradeExits, type TradeExits } from "../lib/chartLab/exitMath";
import { TtlCache } from "../lib/hotCache";

const router: IRouter = Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const q = z.object({
  trader: z.string().trim().max(120).optional(),
  setup: z.string().trim().min(1).max(80).optional(),
  ticker: z.string().trim().min(1).max(16).regex(/^[A-Za-z][-A-Za-z0-9.]{0,15}$/).optional(),
  unit: z.enum(["pct", "r"]).optional(),
  from: z.string().regex(YMD).optional(),
  to: z.string().regex(YMD).optional(),
});

const cache = new TtlCache<string, unknown>(120_000);

async function traderOf(req: Parameters<typeof scopeTrader>[0], requested?: string): Promise<string> {
  const scope = await scopeTrader(req, requested);
  if (scope === undefined || !req.authUser) throw unauthorized();
  return scope ?? req.authUser.name;
}

function parse(query: unknown) {
  const raw = Object.fromEntries(Object.entries((query ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  const p = q.safeParse(raw);
  if (!p.success) throw badRequest("BAD_REQUEST", p.error.flatten());
  return p.data;
}

const keyOf = (t: LabTrade) => `${t.ticker}|${t.day}`;

router.get("/chart-lab/facets", asyncHandler(async (req, res) => {
  const f = parse(req.query);
  const trader = await traderOf(req, f.trader);
  res.json({ trader, ...(await labFacets(trader)) });
}));

router.get("/chart-lab/overlay", asyncHandler(async (req, res) => {
  const f = parse(req.query);
  const trader = await traderOf(req, f.trader);
  const unit: OverlayUnit = f.unit ?? "pct";
  const key = `ov|${trader}|${f.setup ?? ""}|${f.ticker ?? ""}|${unit}|${f.from ?? ""}|${f.to ?? ""}`;
  const hit = cache.get(key);
  if (hit) { res.json(hit); return; }
  const trades = await loadLabTrades({ trader, setup: f.setup, ticker: f.ticker, from: f.from, to: f.to });
  const bars = await loadLabBars(trades);
  const overlay = overlayOf(trades.map((t) => {
    const d = bars.get(keyOf(t));
    const result = t.exit == null ? null : unit === "r" ? (t.riskPerShare ? (t.side * (t.exit - t.entry)) / t.riskPerShare : null) : (t.side * (t.exit - t.entry) * 100) / t.entry;
    return { trade: { id: t.id, side: t.side, entry: t.entry, entryAt: t.entryAt, riskPerShare: t.riskPerShare, result }, bars: d?.bars ?? null, barSec: d?.barSec ?? 60 };
  }), unit);
  const body = { trader, setup: f.setup ?? null, ticker: f.ticker ?? null, total: trades.length, withRisk: trades.filter((t) => t.riskPerShare != null).length, ...overlay };
  cache.set(key, body);
  res.json(body);
}));

router.get("/chart-lab/exits", asyncHandler(async (req, res) => {
  const f = parse(req.query);
  const trader = await traderOf(req, f.trader);
  const key = `ex|${trader}|${f.setup ?? ""}|${f.ticker ?? ""}|${f.from ?? ""}|${f.to ?? ""}`;
  const hit = cache.get(key);
  if (hit) { res.json(hit); return; }
  const trades = await loadLabTrades({ trader, setup: f.setup, ticker: f.ticker, from: f.from, to: f.to });
  const bars = await loadLabBars(trades);
  const groups = new Map<string, { rows: TradeExits[]; missing: number; coarse: number }>();
  const all = { rows: [] as TradeExits[], missing: 0, coarse: 0 };
  for (const t of trades) {
    const d = bars.get(keyOf(t)) ?? null;
    const g = groups.get(t.setup ?? "") ?? { rows: [], missing: 0, coarse: 0 };
    if (!d) { g.missing++; all.missing++; }
    else if (d.barSec > MAX_BAR_SEC) { g.coarse++; all.coarse++; }
    else {
      const x = tradeExits({ id: t.id, setup: t.setup, side: t.side, qty: t.qty, entry: t.entry, entryAt: t.entryAt, exit: t.exit, riskPerShare: t.riskPerShare }, d);
      g.rows.push(x);
      all.rows.push(x);
    }
    groups.set(t.setup ?? "", g);
  }
  const bySetup = [...groups.entries()]
    .map(([setup, g]) => aggregateExits(setup, g.rows, g.missing, { coarse: g.coarse }))
    .sort((a, b) => b.trades - a.trades || a.setup.localeCompare(b.setup));
  const body = {
    trader, setup: f.setup ?? null, ticker: f.ticker ?? null, total: trades.length, withRisk: trades.filter((t) => t.riskPerShare != null).length,
    all: aggregateExits("", all.rows, all.missing, { coarse: all.coarse }), bySetup,
  };
  cache.set(key, body);
  res.json(body);
}));

export default router;
