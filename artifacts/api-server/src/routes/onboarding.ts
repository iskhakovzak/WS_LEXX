/**
 * First-visit onboarding (lib/people/onboarding; edge-tracker lib/onboarding, components/onboarding).
 *
 *   GET  /users/me/onboarding          → { stage, closedDays, activeDays, accountDays, signals }   (guest: settled, no signals)
 *   POST /users/:id/onboarding/reset   → { ok, onboarding } users.manage (+ users.manage.admins for an admin / another curator)
 *
 * `signals` tick the «Первые шаги» checklist from real data (nothing is ticked by hand): own quick-unlock code (or, before
 * the screen lock exists, no issued secret left to replace), a saved «Вид», Telegram linked, a plan written, a day
 * closed. The seen / dismissed state itself lives in users.settings.onboarding (PUT /users/me/settings { onboarding }).
 * Counts are capped (CAP): the rule only needs «0», «< 5» and «< 20».
 */
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { isGuestUser } from "../lib/auth";
import { can, requireCap } from "../lib/permissions";
import { AppError, badRequest, notFound, unauthorized } from "../lib/http";
import { logAudit } from "../lib/audit";
import { onboardingStage, resetState } from "../lib/people/onboarding";

const router: IRouter = Router();

const CAP = 40;
const DAY_MS = 86_400_000;

type Row = { d: string };
const noRows = { rows: [] as Row[] };
/** An optional table / column missing on this database (42P01 / 42703) reads as «no data». */
const optional = (err: unknown) => {
  const code = (err as { code?: string })?.code;
  if (code === "42P01" || code === "42703") return noRows;
  throw err;
};

async function daySet(sqls: { sql: string; arg: unknown }[]): Promise<number> {
  const results = await Promise.all(sqls.map(({ sql, arg }) => pool.query<Row>(sql, [arg]).catch(optional)));
  const days = new Set<string>();
  for (const r of results) for (const row of r.rows) if (row.d) days.add(String(row.d).slice(0, 10));
  return Math.min(days.size, CAP);
}

router.get("/users/me/onboarding", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) throw unauthorized();
  if (isGuestUser(me)) {
    res.json({ stage: "settled", closedDays: 0, activeDays: 0, accountDays: 0, signals: null });
    return;
  }
  const { rows } = await pool.query<{ name: string; created_at: Date; must_change: boolean | null; tg: boolean; settings: Record<string, unknown> | null }>(
    `SELECT name, created_at, must_change_secret AS must_change, telegram_chat_id IS NOT NULL AS tg, settings FROM users WHERE id = $1`,
    [me.id],
  );
  const u = rows[0];
  if (!u) throw notFound();
  const name = u.name;
  const [closedDays, activeDays, quick, plan] = await Promise.all([
    daySet([
      { sql: `SELECT date AS d FROM eod_days WHERE trader = $1 AND closed_at IS NOT NULL LIMIT ${CAP}`, arg: name },
      { sql: `SELECT date AS d FROM daily_reviews WHERE trader = $1 AND reviewed_at IS NOT NULL LIMIT ${CAP}`, arg: name },
    ]),
    daySet([
      { sql: `SELECT DISTINCT left(date, 10) AS d FROM trades WHERE COALESCE(trader, '') = $1 AND deleted_at IS NULL LIMIT ${CAP}`, arg: name },
      { sql: `SELECT DISTINCT ny_day AS d FROM usage_events WHERE user_id = $1 LIMIT ${CAP}`, arg: me.id },
    ]),
    // The screen lock's quick-unlock code (migration 0245); null when the column is not there yet.
    pool.query<{ set: boolean }>(`SELECT quick_code_hash IS NOT NULL AS set FROM users WHERE id = $1`, [me.id])
      .then((r) => r.rows[0]?.set ?? null)
      .catch((err) => { optional(err); return null; }),
    pool.query<{ one: number }>(
      `SELECT 1 AS one FROM trader_plans WHERE trader = $1 AND deleted_at IS NULL AND doc IS NOT NULL AND doc::text NOT IN ('{}', 'null') LIMIT 1`,
      [name],
    ).then((r) => r.rows.length > 0).catch((err) => { optional(err); return false; }),
  ]);
  const accountDays = Math.max(0, Math.floor((Date.now() - new Date(u.created_at).getTime()) / DAY_MS));
  const settings = u.settings ?? {};
  res.json({
    stage: onboardingStage({ guest: false, closedDays, activeDays, accountDays }),
    closedDays,
    activeDays,
    accountDays,
    signals: {
      secret: quick ?? !u.must_change,
      quickCode: quick != null,
      look: settings.appearance != null,
      telegram: !!u.tg,
      plan,
      closedDay: closedDays > 0,
    },
  });
}));

router.post("/users/:id/onboarding/reset", asyncHandler(async (req, res): Promise<void> => {
  const raw = String(req.params.id ?? "");
  const id = /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  if (id === null) throw badRequest("INVALID_ID");
  if (!(await requireCap(req, res, "users.manage", null, "STAFF_ONLY"))) return;
  const adminMgr = await can(req, "users.manage.admins");
  const { rows } = await pool.query<{ role: string; name: string; settings: Record<string, unknown> | null }>(
    `SELECT role, name, settings FROM users WHERE id = $1`,
    [id],
  );
  const target = rows[0];
  if (!target) throw notFound();
  // Same rule as PATCH /users/:id: an admin, or another curator, is managed by an admin only.
  if (target.role === "admin" && !adminMgr) throw new AppError("ADMIN_ONLY");
  if (target.role === "curator" && id !== req.authUser?.id && !adminMgr) throw new AppError("ADMIN_ONLY");
  const next = resetState(target.settings?.onboarding);
  const { rows: updated } = await pool.query<{ settings: Record<string, unknown> | null }>(
    `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('onboarding', $1::jsonb) WHERE id = $2 RETURNING settings`,
    [JSON.stringify(next), id],
  );
  await logAudit({ actor: req.authUser?.name ?? "?", action: "user.onboarding_reset", targetType: "user", targetId: String(id), details: { name: target.name } });
  res.json({ ok: true, onboarding: (updated[0]?.settings ?? {}).onboarding ?? next });
}));

export default router;
