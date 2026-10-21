/**
 * Mounted by routes/watchlist.ts (no own entry in routes/index.ts).
 *
 *   GET /api/watchlist/view     { scope: "mine" | "desk", canEditDesk } — the remembered list of «Свой / Деска»
 *   PUT /api/watchlist/view     member — { scope } → { scope, canEditDesk } (users.settings.watchlistView)
 *   GET /api/watchlist/quotes   ?tickers=A,B (≤ 200) — the common quote layer (lib/watchlist/quotes): premarket %, gap,
 *                               time-of-day RVOL, float — the numbers /themes shows
 */
import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireMember } from "../lib/auth";
import { AppError, unauthorized } from "../lib/http";
import { watchActor, readWatchView, writeWatchView } from "../lib/watchlist/access";
import { canEditDesk, parseScope } from "../lib/watchlist/scope";
import { LAYER_MAX_TICKERS, layerQuotes } from "../lib/watchlist/quotes";

const router: IRouter = Router();
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/;

router.get("/watchlist/view", asyncHandler(async (req, res): Promise<void> => {
  const a = await watchActor(req);
  if (!a) throw unauthorized();
  const view = a.guest ? { scope: "desk" as const } : await readWatchView(a.id);
  res.json({ ...view, canEditDesk: canEditDesk(a) });
}));

router.put("/watchlist/view", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const a = await watchActor(req);
  if (!a) throw unauthorized();
  const scope = parseScope((req.body as { scope?: unknown } | undefined)?.scope);
  if (!scope || scope === "invalid") throw new AppError("INVALID_FIELD", undefined, { field: "scope" });
  res.json({ ...(await writeWatchView(a.id, { scope })), canEditDesk: canEditDesk(a) });
}));

router.get("/watchlist/quotes", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) throw unauthorized();
  const raw = String(req.query.tickers ?? req.query.symbols ?? "");
  const tickers = [...new Set(raw.split(/[\s,;]+/).map((t) => t.trim().toUpperCase().replace(/^\$/, "")).filter((t) => TICKER_RE.test(t)))];
  if (!tickers.length) throw new AppError("INVALID_TICKER");
  if (tickers.length > LAYER_MAX_TICKERS) throw new AppError("TOO_MANY", undefined, { field: "tickers", max: LAYER_MAX_TICKERS });
  res.json(await layerQuotes(tickers));
}));

export default router;
