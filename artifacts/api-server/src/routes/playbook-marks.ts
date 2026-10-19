/**
 * Checklist marks of a setup (playbook_checklist_marks). Mounted by routes/playbook.ts.
 *
 *   GET /playbook/:id/marks              { shared, personal } — readers of the setup only (404 otherwise)
 *   PUT /playbook/:id/marks/:itemId      { scope, done } — readers only; `personal` = the caller's own tick, `shared` =
 *                                        the tick everyone sees: only those who may edit the setup (canEditSetupRow:
 *                                        office → curators, personal → owner / staff) or curators (playbook.edit.any).
 *                                        DEV-04: a trainee could flip the desk-wide marks of any setup id.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { isGuest, requireAuth } from "../lib/auth";
import { canEditSetupRow, canReadPure, loadSetupAccess, loadViewer } from "../lib/playbookAccess";
import { AppError, badRequest, notFound, sendError } from "../lib/http";

const router: IRouter = Router();

/** 404 unless the caller may read setup `id`; the setup's access row otherwise. */
async function readable(req: Request, res: Response, id: number) {
  if (!Number.isInteger(id) || id <= 0) { sendError(res, badRequest("INVALID_ID")); return null; }
  const row = await loadSetupAccess(id);
  if (!row || !canReadPure(await loadViewer(req), row)) { sendError(res, notFound()); return null; }
  return row;
}

router.get("/playbook/:id/marks", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!(await readable(req, res, id))) return;
  const trader = req.authUser?.name ?? "";
  const { rows } = await pool.query<{ item_id: string; scope: string; trader: string; done: boolean }>(
    `SELECT item_id, scope, trader, done
     FROM playbook_checklist_marks
     WHERE playbook_id = $1 AND (scope = 'shared' OR (scope = 'personal' AND trader = $2))`,
    [id, trader]
  );
  const shared: Record<string, boolean> = {};
  const personal: Record<string, boolean> = {};
  for (const r of rows) {
    if (r.scope === "shared") shared[r.item_id] = r.done;
    else if (r.scope === "personal" && r.trader === trader) personal[r.item_id] = r.done;
  }
  res.json({ shared, personal });
}));

router.put("/playbook/:id/marks/:itemId", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const itemId = String(req.params.itemId);
  if (!itemId || itemId.length > 200) throw badRequest("INVALID_ID");
  const row = await readable(req, res, id);
  if (!row) return;
  const { scope, done } = req.body as { scope?: string; done?: boolean };
  if (scope !== "shared" && scope !== "personal") throw new AppError("INVALID_FIELD", undefined, { field: "scope" });
  if (typeof done !== "boolean") throw new AppError("FIELD_REQUIRED", undefined, { field: "done" });
  if (isGuest(req)) throw new AppError("GUEST_READ_ONLY");
  if (scope === "shared" && !(await canEditSetupRow(req, row)) && !(await loadViewer(req)).editAny) throw new AppError("SETUP_EDITOR_ONLY");
  const sessionTrader = req.authUser?.name ?? "";
  if (scope === "personal" && !sessionTrader) throw new AppError("TRADER_REQUIRED");
  const traderKey = scope === "personal" ? sessionTrader : "";
  await pool.query(
    `INSERT INTO playbook_checklist_marks (playbook_id, item_id, scope, trader, done, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (playbook_id, item_id, scope, trader)
     DO UPDATE SET done = EXCLUDED.done, updated_at = NOW()`,
    [id, itemId, scope, traderKey, done]
  );
  res.json({ ok: true });
}));

export default router;
