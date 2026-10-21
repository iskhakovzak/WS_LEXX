/**
 * PropReports accuracy endpoints (phase 3): broker adjustments and the nightly per-account reconciliation.
 *
 *   GET  /propreports/adjustments/daily?trader=&from=&to=   per day: trade net, fees, transfers, other, net with
 *                                                          adjustments, equity change (+ totals, latest 500 rows);
 *                                                          traders: own book; staff: any trader or the whole desk
 *   GET  /propreports/adjustments/backfill                 [read.team] history backfill state
 *   POST /propreports/adjustments/backfill { from, to }    [sync] queue a history range (the tick walks it in chunks)
 *   GET  /propreports/reconcile-broker?view=&trader=&from=&to=
 *                                                          [read.team] per account per day, our net vs the broker
 *                                                          report: view=open (default: mismatches not acknowledged) |
 *                                                          all (every mismatch) | everything (ok rows too)
 *   POST /propreports/reconcile-broker/:id/acknowledge { note? }
 *                                                          [sync] mark a mismatch explained (re-opens by itself when
 *                                                          the difference moves by more than $1)
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, scopeTrader } from "../lib/auth";
import { AppError, idParam, notFound, route, unauthorized } from "../lib/http";
import { logAudit } from "../lib/audit";
import { addDays, nyDate } from "../lib/tradingDate";
import { adjustmentDays } from "../lib/propreports/adjustments";
import { adjustmentsBackfillState, requestAdjustmentsBackfill } from "../lib/propreports/steps/adjustments";
import { acknowledgeReconcileDay, listReconcileDays } from "../lib/propreports/reconcile-broker-store";
import { reconcileRunState } from "../lib/propreports/steps/reconcile";

const router: IRouter = Router();

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_RANGE_DAYS = 400;

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

router.get("/propreports/adjustments/daily", requireAuth, route({
  query: z.object({ trader: z.string().trim().max(120).optional(), from: ymd.optional(), to: ymd.optional() }),
}, async ({ query, req }) => {
  const scope = await scopeTrader(req, query.trader, "propreports.read.team");
  if (scope === undefined) throw unauthorized();
  const to = query.to ?? nyDate();
  const from = query.from ?? addDays(to, -29);
  if (from > to || spanDays(from, to) > MAX_RANGE_DAYS) throw new AppError("INVALID_RANGE", undefined, { max: MAX_RANGE_DAYS });
  return adjustmentDays(scope, from, to);
}));

router.get("/propreports/adjustments/backfill", requireAuth, route({ cap: "propreports.read.team" }, async () => {
  return { backfill: await adjustmentsBackfillState() };
}));

router.post("/propreports/adjustments/backfill", requireAuth, route({
  cap: "propreports.sync",
  body: z.object({ from: ymd, to: ymd }),
}, async ({ body, actor }) => {
  if (body.from > body.to || spanDays(body.from, body.to) > 3 * 366) throw new AppError("INVALID_RANGE", undefined, { max: 3 * 366 });
  const backfill = await requestAdjustmentsBackfill(body.from, body.to, actor.name);
  await logAudit({ actor: actor.name, action: "propreports.adjustments.backfill", targetType: "propreports_adjustments", details: { from: body.from, to: body.to } });
  return { backfill };
}));

router.get("/propreports/reconcile-broker", requireAuth, route({
  cap: "propreports.read.team",
  query: z.object({
    view: z.enum(["open", "all", "everything"]).optional(),
    trader: z.string().trim().max(120).optional(),
    from: ymd.optional(),
    to: ymd.optional(),
  }),
}, async ({ query }) => {
  const [list, run] = await Promise.all([
    listReconcileDays({ view: query.view ?? "open", trader: query.trader || null, from: query.from ?? null, to: query.to ?? null }),
    reconcileRunState(),
  ]);
  return { ...list, run };
}));

router.post("/propreports/reconcile-broker/:id/acknowledge", requireAuth, route({
  cap: "propreports.sync",
  params: z.object({ id: idParam }),
  body: z.object({ note: z.string().trim().max(500).optional() }),
}, async ({ params, body, actor }) => {
  const ok = await acknowledgeReconcileDay(params.id, actor.name, body.note || null);
  if (!ok) throw notFound();
  await logAudit({ actor: actor.name, action: "propreports.reconcile.acknowledge", targetType: "propreports_reconcile_days", targetId: String(params.id), details: { note: body.note ?? null } });
  return { ok: true };
}));

export default router;
