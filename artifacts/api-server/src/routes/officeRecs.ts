/**
 * «Рекомендации офису» — GET /office-stats/recommendations (same audience as /office-stats: any signed-in member;
 * guests 403, anonymous 401; the /office section gate of lib/access/sections covers the prefix).
 *
 *   { role, asOf, computedAt, window: { from, to, days }, recs: OfficeRec[], hidden: { id, until, kind }[] }
 *
 * The desk-wide result is cached (lib/officeRecs/store) and redacted per viewer here (lib/officeRecs/redact):
 * partners see $ and names, curators names within their team.read scope and no $, traders anonymised desk aggregates.
 * «Скрыть на неделю» lives in the viewer's own users.settings.officeRecsHidden (PUT /users/me/settings).
 */
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { AppError, sendError, unauthorized } from "../lib/http";
import { readScope, resolveActor } from "../lib/permissions";
import { nyDate } from "../lib/tradingDate";
import { deskRecs } from "../lib/officeRecs/store";
import { activeHidden, redactRecs, splitHidden, type RecViewer } from "../lib/officeRecs/redact";

const router: IRouter = Router();

router.get("/office-stats/recommendations", asyncHandler(async (req, res) => {
  if (!req.authUser) { sendError(res, unauthorized()); return; }
  const actor = await resolveActor(req);
  if (!actor) { sendError(res, unauthorized()); return; }
  if (actor.guest) { sendError(res, new AppError("GUEST_UNAVAILABLE")); return; }
  const role: RecViewer["role"] = actor.role === "admin" ? "admin" : actor.role === "curator" ? "curator" : "trader";
  const [result, scope, settings] = await Promise.all([
    deskRecs(),
    role === "curator" ? readScope(req, "team.read") : Promise.resolve(null),
    pool.query<{ settings: Record<string, unknown> | null }>(`SELECT settings FROM users WHERE id = $1`, [actor.id]).then((r) => r.rows[0]?.settings ?? {}).catch(() => ({} as Record<string, unknown>)),
  ]);
  const visible = redactRecs(result.recs, { role, scope });
  const { recs, hidden } = splitHidden(visible, activeHidden((settings as Record<string, unknown>).officeRecsHidden, nyDate()));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ role, asOf: result.asOf, computedAt: result.computedAt, window: result.window, recs, hidden });
}));

export default router;
