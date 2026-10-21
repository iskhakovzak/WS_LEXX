import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import { sendMessage } from "../lib/telegramBot";
import { AppError, notFound } from "../lib/http";
import { requireCap } from "../lib/permissions";
import { logAudit } from "../lib/audit";

/**
 * Admin endpoints of the Telegram integration (force disconnect, broadcast, user assignments). Split out of
 * routes/telegram.ts (size ratchet) and mounted at the end of its router — same paths, same order.
 */
const router: IRouter = Router();

// ─── ADMIN: FORCE DISCONNECT + BROADCAST ─────────────────────────────────────
// On the permissions matrix (lib/permissions; role from the DB, not the token): unlink + broadcast need
// telegram.broadcast (admin by default, sensitive), assignments are read with users.read.team and changed with
// settings.manage (admin-only: assignments decide whom an «assigned» curator sees). Every change is written to the audit log; chat ids never leave the server.

router.delete("/telegram/admin/disconnect/:name", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "telegram.broadcast"))) return;
  const viewer = req.authUser!;
  const { name } = req.params;
  const { rowCount } = await pool.query(
    `UPDATE users SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE name = $1`,
    [name],
  );
  if (!rowCount) throw notFound("USER_NOT_FOUND");
  logger.info({ admin: viewer.name, target: name }, "Admin force-disconnected Telegram");
  await logAudit({ actor: viewer.name, action: "telegram.unlink", targetType: "user", targetId: String(name) });
  res.json({ ok: true, updated: rowCount ?? 0 });
}));

router.post("/telegram/broadcast", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "telegram.broadcast"))) return;
  const viewer = req.authUser!;
  const { message } = req.body as { message?: string };
  if (!message || typeof message !== "string" || !message.trim()) {
    throw new AppError("VALIDATION");
  }
  const text = message.trim().slice(0, 4000);
  // Active, not banned members only (a deactivated or banned account keeps its chat id).
  const { rows } = await pool.query<{ name: string; telegram_chat_id: string }>(
    `SELECT name, telegram_chat_id FROM users
      WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != '' AND active = true AND COALESCE(banned, false) = false`
  );
  let sent = 0;
  let failed = 0;
  for (const user of rows) {
    try {
      await sendMessage(user.telegram_chat_id, text);
      sent++;
    } catch (e: any) {
      logger.warn({ trader: user.name, error: e.message }, "broadcast send failed");
      failed++;
    }
  }
  logger.info({ admin: viewer.name, sent, failed, total: rows.length }, "Telegram broadcast sent");
  await logAudit({ actor: viewer.name, action: "telegram.broadcast", targetType: "users", details: { sent, failed, total: rows.length, length: text.length, preview: text.slice(0, 200) } });
  res.json({ ok: true, sent, failed, total: rows.length });
}));

// ─── ADMIN: USER ASSIGNMENTS ─────────────────────────────────────────────────

router.get("/telegram/assignments", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.read.team"))) return;
  // `telegram_linked` instead of the raw chat id (a chat id lets anyone with the bot token message that person).
  const { rows } = await pool.query(
    `SELECT name, role, active, (telegram_chat_id IS NOT NULL AND telegram_chat_id != '') AS telegram_linked, telegram_linked_at,
            assigned_curator, assigned_risk_manager, assigned_mentor
     FROM users WHERE active = true ORDER BY role, name`,
  );
  res.json(rows);
}));

router.patch("/telegram/assignments/:name", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "settings.manage"))) return;
  const viewer = req.authUser!;
  const { name } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const assigned = [clean(body.assigned_curator), clean(body.assigned_risk_manager), clean(body.assigned_mentor)];
  const named = [...new Set(assigned.filter((v): v is string => !!v))];
  if (named.length) {
    const { rows: staff } = await pool.query<{ name: string }>(
      `SELECT name FROM users WHERE name = ANY($1::text[]) AND role IN ('curator', 'admin') AND active = true`,
      [named],
    );
    if (staff.length !== named.length) throw new AppError("ASSIGNEE_NOT_STAFF");
  }
  const { rows: before } = await pool.query<{ assigned_curator: string | null; assigned_risk_manager: string | null; assigned_mentor: string | null }>(
    `SELECT assigned_curator, assigned_risk_manager, assigned_mentor FROM users WHERE name = $1 LIMIT 1`,
    [name],
  );
  const { rowCount } = await pool.query(
    `UPDATE users SET assigned_curator = $1, assigned_risk_manager = $2, assigned_mentor = $3 WHERE name = $4`,
    [...assigned, name],
  );
  if (!rowCount) throw notFound("USER_NOT_FOUND");
  await logAudit({
    actor: viewer.name, action: "user.assignments.update", targetType: "user", targetId: String(name),
    details: { from: before[0] ?? null, to: { assigned_curator: assigned[0], assigned_risk_manager: assigned[1], assigned_mentor: assigned[2] } },
  });
  res.json({ ok: true });
}));

export default router;
