/**
 * PropReports background tick + history backfill (under /api/propreports, auth required):
 *
 *   GET  /tick                  [staff] per-step state, last tick summary, outbox counts, lease
 *   POST /tick/run              [propreports.sync] run one tick now (≤ 45 s; the same tick as the heartbeat)
 *   GET  /backfill              [staff] history backfills (newest first) with progress
 *   POST /backfill              [propreports.sync] { from, to } queue a history backfill (7-day windows; 409 BACKFILL_RUNNING)
 *   POST /backfill/:id/cancel   [propreports.sync] stop a running backfill (data already pulled stays)
 *
 * The heartbeat itself is routes/cron.ts (POST|GET /api/cron/tick, Bearer CRON_SECRET).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../lib/auth";
import { can, requireCap } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { nyDate } from "../lib/tradingDate";
import { AppError, notFound, sendErrorWith } from "../lib/http";
import { isConfigured, statusConfig } from "../lib/propreports/client";
import { getCursor } from "../lib/propreports/tick/cursor";
import { leaseInfo, TICK_LEASE } from "../lib/propreports/tick/lease";
import { loadStepStates, runTick } from "../lib/propreports/tick/runner";
import { TICK_STEPS } from "../lib/propreports/tick/steps";
import { BackfillConflictError, MAX_RANGE_DAYS, cancelBackfill, listBackfills, startBackfill } from "../lib/propreports/tick/backfill";

const router: IRouter = Router();

async function viewer(req: Request): Promise<{ name: string; staff: boolean }> {
  return { name: req.authUser!.name, staff: await can(req, "propreports.read.team") };
}

function badRequest(_res: Response, parsed: z.SafeParseError<unknown>): never {
  throw parsed.error;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const notConfigured = () => new AppError("PROPREPORTS_NOT_CONFIGURED");

router.get("/propreports/tick", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!v.staff) throw new AppError("STAFF_ONLY");
  const [states, last, lease, outbox] = await Promise.all([
    loadStepStates(),
    getCursor("tick:last"),
    leaseInfo(TICK_LEASE),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE done_at IS NULL AND failed_at IS NULL)::int AS pending,
              COUNT(*) FILTER (WHERE failed_at IS NOT NULL AND failed_at > NOW() - interval '7 days')::int AS failed,
              MIN(created_at) FILTER (WHERE done_at IS NULL AND failed_at IS NULL) AS oldest
         FROM propreports_outbox`,
    ),
  ]);
  const o = outbox.rows[0] ?? {};
  res.json({
    cronConfigured: statusConfig().cronConfigured,
    steps: TICK_STEPS.map((s) => states.get(s.name) ?? { name: s.name, lastRunAt: null, lastOkAt: null, lastDone: null, lastNote: null, lastError: null, lastMs: null, runs: 0 }),
    last,
    lease,
    outbox: { pending: Number(o.pending ?? 0), failed: Number(o.failed ?? 0), oldestPendingAt: o.oldest ? new Date(o.oldest).toISOString() : null },
  });
}));

router.post("/propreports/tick/run", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "STAFF_ONLY"))) return;
  const summary = await runTick({ trigger: "manual" });
  await logAudit({ actor: v.name, action: "propreports.tick.run", details: { skipped: summary.skipped ?? null, steps: summary.steps.filter((s) => s.ran).map((s) => s.name) } });
  res.json(summary);
}));

router.get("/propreports/backfill", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!v.staff) throw new AppError("STAFF_ONLY");
  const items = await listBackfills(10);
  res.json({ active: items.find((b) => b.status === "running") ?? null, items, maxRangeDays: MAX_RANGE_DAYS });
}));

const backfillBody = z.object({ from: ymd, to: ymd }).refine((b) => b.from <= b.to, { message: "from must be ≤ to", path: ["to"] });

router.post("/propreports/backfill", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "STAFF_ONLY"))) return;
  if (!isConfigured()) throw notConfigured();
  const parsed = backfillBody.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed);
  const { from, to } = parsed.data;
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new AppError("RANGE_TOO_LONG", undefined, { max: MAX_RANGE_DAYS });
  const today = nyDate();
  if (from > today) throw new AppError("INVALID_DATE");
  let created;
  try {
    created = await startBackfill({ from, to: to > today ? today : to, actor: v.name });
  } catch (e) {
    if (e instanceof BackfillConflictError) { sendErrorWith(res, new AppError("BACKFILL_RUNNING"), { active: e.active }); return; }
    throw e;
  }
  await logAudit({ actor: v.name, action: "propreports.backfill.start", targetType: "propreports_backfills", targetId: String(created.id), details: { from: created.dateFrom, to: created.dateTo } });
  res.status(201).json(created);
}));

router.post("/propreports/backfill/:id/cancel", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "STAFF_ONLY"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("INVALID_ID");
  const row = await cancelBackfill(id);
  if (!row) throw notFound();
  await logAudit({ actor: v.name, action: "propreports.backfill.cancel", targetType: "propreports_backfills", targetId: String(id) });
  res.json(row);
}));

export default router;
