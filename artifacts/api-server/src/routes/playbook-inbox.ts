/**
 * Playbook inbox marks — «Не для плейбука» (playbook_inbox_dismissed): a trade the trader says fits no setup. It leaves
 * «Сделки без эталона» and counts as handled in «без сетапа» (lib/playbookToday/untagged). Mounted by
 * routes/playbook-spaces.ts (which lists the inbox itself: GET /playbook-tools/inbox).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { isGuest } from "../lib/auth";
import { loadViewer } from "../lib/playbookAccess";
import { tradeTagged } from "../lib/playbookToday/service";
import { AppError, sendError, unauthorized } from "../lib/http";

const router: IRouter = Router();

/**
 * POST   /playbook-tools/inbox/dismiss { tradeIds } — «Не для плейбука»: hide own trades from «Разобрать сделки».
 * DELETE /playbook-tools/inbox/dismiss { tradeIds } — undo. Staff may do it for any trader's trades.
 */
async function inboxDismiss(req: Request, res: Response, on: boolean): Promise<void> {
  if (isGuest(req)) { sendError(res, new AppError("GUEST_READ_ONLY")); return; }
  const v = await loadViewer(req);
  if (!v.name) { sendError(res, unauthorized()); return; }
  const body = req.body as { tradeIds?: unknown };
  const ids = [...new Set((Array.isArray(body.tradeIds) ? body.tradeIds : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 200);
  if (!ids.length) throw new AppError("TRADE_IDS_REQUIRED");
  // Own trades only (staff: any) — the same people who see them in the inbox.
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM trades WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND (trader = $2 OR $3::boolean)`,
    [ids, v.name, v.editAny],
  );
  const allowed = rows.map((r) => r.id);
  if (!allowed.length) throw new AppError("NOT_FOUND");
  if (on) {
    await pool.query(
      `INSERT INTO playbook_inbox_dismissed (trade_id, dismissed_by) SELECT x, $2 FROM UNNEST($1::int[]) AS x ON CONFLICT (trade_id) DO NOTHING`,
      [allowed, v.name],
    );
  } else {
    await pool.query(`DELETE FROM playbook_inbox_dismissed WHERE trade_id = ANY($1::int[])`, [allowed]);
  }
  // «Не для плейбука» counts as tagged (lib/playbookToday/untagged): the header counter and the quest re-read at once.
  await tradeTagged(allowed[0]);
  res.json({ success: true, tradeIds: allowed });
}
router.post("/playbook-tools/inbox/dismiss", asyncHandler((req, res) => inboxDismiss(req, res, true)));
router.delete("/playbook-tools/inbox/dismiss", asyncHandler((req, res) => inboxDismiss(req, res, false)));

export default router;
