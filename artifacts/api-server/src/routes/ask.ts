/**
 * «Спроси журнал» — the compact trade book the client-side question engine runs on (no AI, GET only).
 *
 *   GET /ask/book           ?mine=1 | ?trader=<name>
 *        { cols, rows (tuples in `cols` order), truncated, scope (trader name | null = whole desk), redacted }
 *
 * Scope via lib/auth scopeTrader — the same rule as /trades and /trades/page: a trader always gets their own book
 * (any ?trader= is ignored), staff get the whole desk or the trader they ask for, a guest gets nothing, anonymous → 401.
 * `mine=1` asks for the viewer's own book (the page's default — small and fast; staff widen to the desk explicitly).
 * $ (pnl / fees / qty / riskUsd) of trades the viewer may not see are nulled (lib/playbookPrivacy) — lib/askBook.
 */
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { GUEST_SCOPE, scopeTrader } from "../lib/auth";
import { loadMoneyViewer } from "../lib/playbookAccess";
import { askBookQuery, askBookResponse, type AskBookDbRow } from "../lib/askBook";

const router: IRouter = Router();

router.get("/ask/book", asyncHandler(async (req, res) => {
  const mine = req.query.mine === "1" || req.query.mine === "true";
  const traderParam = typeof req.query.trader === "string" ? req.query.trader.slice(0, 120) : undefined;
  const mv = await loadMoneyViewer(req);
  const scope = await scopeTrader(req, mine ? (mv.name ?? undefined) : traderParam);
  if (scope === undefined) { res.status(401).json({ error: "Требуется вход" }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  // Guests read no trades; staff without a trader name asking for «mine» own none.
  if (scope === GUEST_SCOPE || (mine && !mv.name)) {
    res.json(askBookResponse([], mv, mine ? mv.name : null));
    return;
  }
  const q = askBookQuery(scope);
  const { rows } = await pool.query<AskBookDbRow>(q.sql, q.params);
  res.json(askBookResponse(rows, mv, scope));
}));

export default router;
