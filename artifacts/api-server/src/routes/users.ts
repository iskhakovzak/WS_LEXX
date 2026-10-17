import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { z } from "zod";
import { hashPassword, verifyPassword, bumpTokenVersion, requireMember, isGuestUser } from "../lib/auth";
import { can, requireCap } from "../lib/permissions";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const USER_COLUMNS = `id, name, role, active,
  COALESCE(theme, 'dark') AS theme,
  COALESCE(banned, false) AS banned,
  banned_at AS "bannedAt",
  banned_reason AS "bannedReason",
  created_at AS "createdAt"`;

function normalizeRole(r: unknown): string {
  if (r === "admin") return "admin";
  if (r === "curator") return "curator";
  return "trader";
}

function parseId(raw: unknown): number | null {
  const s = String(raw ?? "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * User management used to be gated by a shared "admin password" that was
 * hard-coded in the frontend bundle — i.e. any logged-in trader could create
 * users or reset anyone's password. Access is now derived from the caller's
 * JWT and their current role in the DB.
 */
// Permissions matrix (lib/permissions.ts; role from the DB): users.read.team = team list + moderation fields,
// users.manage = create/edit/deactivate traders & curators, users.manage.admins = anything touching admins.

/** Self, or users.manage acting on someone else. */
async function canActOnName(req: Request, name: string): Promise<boolean> {
  if (!req.authUser) return false;
  if (req.authUser.name === name) return true;
  return can(req, "users.manage", { trader: name });
}

/** Ban details (when/why) are moderation data: only staff may see them. `banned` stays: the login screen hides banned users. */
function stripModeration(rows: any[]): any[] {
  return rows.map(({ bannedAt: _ba, bannedReason: _br, ...rest }) => rest);
}

// Public (the login screen lists traders before sign-in), so moderation fields are staff-only.
router.get("/users", asyncHandler(async (req, res): Promise<void> => {
  const { rows } = await pool.query<any>(`
    SELECT ${USER_COLUMNS}
    FROM users
    WHERE active = true
    ORDER BY created_at ASC
  `);
  res.json((await can(req, "users.read.team")) ? rows : stripModeration(rows));
}));

router.get("/users/all", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
  const { rows } = await pool.query<any>(`
    SELECT ${USER_COLUMNS}
    FROM users
    ORDER BY created_at ASC
  `);
  res.json((await can(req, "users.read.team")) ? rows : stripModeration(rows));
}));

router.patch("/users/theme", asyncHandler(async (req, res): Promise<void> => {
  const { name, theme } = req.body as { name?: string; theme?: string };
  if (!name || !theme) { res.status(400).json({ error: "name and theme required" }); return; }
  const allowed = ["dark", "dim", "sepia", "light"];
  if (!allowed.includes(theme)) { res.status(400).json({ error: "Invalid theme" }); return; }
  if (!(await canActOnName(req, name))) { res.status(403).json({ error: "Forbidden" }); return; }
  await pool.query(`UPDATE users SET theme = $1 WHERE name = $2`, [theme, name]);
  res.json({ success: true });
}));

// NOTE: these must be declared before `/users/:id`, otherwise PATCH
// /users/tg-notifications is captured by the `:id` route and always fails.
router.patch("/users/tg-notifications", asyncHandler(async (req, res): Promise<void> => {
  const { name, enabled } = req.body as { name?: string; enabled?: boolean };
  if (!name || typeof enabled !== "boolean") { res.status(400).json({ error: "name and enabled required" }); return; }
  if (!(await canActOnName(req, name))) { res.status(403).json({ error: "Forbidden" }); return; }
  const { rowCount } = await pool.query(`UPDATE users SET tg_notifications_enabled = $1 WHERE name = $2`, [enabled, name]);
  if (!rowCount) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true, enabled });
}));

router.get("/users/tg-notifications", asyncHandler(async (req, res): Promise<void> => {
  const name = typeof req.query.name === "string" ? req.query.name : null;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const { rows } = await pool.query<any>(
    `SELECT COALESCE(tg_notifications_enabled, true) AS tg_notifications_enabled FROM users WHERE name = $1`, [name]
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ enabled: rows[0].tg_notifications_enabled as boolean });
}));

// ─── Self-service profile (Settings → Профиль) ───────────────────────────────

/** Caller's own profile: role, assignments, Telegram link state and activity. Never exposes secrets. */
router.get("/users/me/profile", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) { res.status(401).json({ error: "Authentication required" }); return; }
  const { rows } = await pool.query<any>(
    `SELECT id, name, role, active,
            COALESCE(theme, 'dark') AS theme,
            created_at AS "createdAt",
            (telegram_chat_id IS NOT NULL AND telegram_chat_id <> '') AS "telegramLinked",
            telegram_linked_at AS "telegramLinkedAt",
            COALESCE(tg_notifications_enabled, true) AS "tgNotificationsEnabled",
            assigned_curator AS "assignedCurator",
            assigned_risk_manager AS "assignedRiskManager",
            assigned_mentor AS "assignedMentor"
     FROM users WHERE id = $1 LIMIT 1`,
    [me.id],
  );
  const profile = rows[0];
  if (!profile) { res.status(404).json({ error: "Not found" }); return; }
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const { rows: statRows } = await pool
    .query<any>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE LEFT(date, 10) >= $2)::int AS last30,
              MIN(LEFT(date, 10)) AS "firstTrade",
              MAX(LEFT(date, 10)) AS "lastTrade"
       FROM trades WHERE trader = $1 AND deleted_at IS NULL`,
      [profile.name, since],
    )
    .catch(() => ({ rows: [] as any[] }));
  // Staff who have this user assigned to them (who do I look after?).
  const { rows: wards } = await pool.query<{ name: string }>(
    `SELECT name FROM users
     WHERE active = true AND (assigned_curator = $1 OR assigned_risk_manager = $1 OR assigned_mentor = $1)
     ORDER BY name`,
    [profile.name],
  );
  res.json({
    ...profile,
    stats: statRows[0] ?? { total: 0, last30: 0, firstTrade: null, lastTrade: null },
    wards: wards.map((w) => w.name),
  });
}));

// ─── Personal settings (users.settings JSONB) — audit P1-7 ─────────────────────
// GET /users/me/settings → { settings: { tradingDefaults?: {...}, ... } }   (guest/anonymous-safe: {} for a guest)
// PUT /users/me/settings   { tradingDefaults?: {...} | null }  — top-level merge; null removes the key → { settings }
// The column is added idempotently on first use (additive, no migrate.ts change).

let settingsColumnEnsured: Promise<void> | null = null;
function ensureSettingsColumn(): Promise<void> {
  if (!settingsColumnEnsured) {
    settingsColumnEnsured = pool
      .query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`)
      .then(() => undefined)
      .catch((err) => {
        settingsColumnEnsured = null;
        throw err;
      });
  }
  return settingsColumnEnsured;
}
ensureSettingsColumn().catch((err) => logger.warn({ err }, "users: ensure settings column failed at init"));

const boundedNum = (min: number, max: number) => z.coerce.number().finite().min(min).max(max);
/** Mirrors edge-tracker components/settings/trading-defaults.ts (TRADING_DEFAULT_LIMITS). Unknown keys are dropped. */
const TradingDefaultsSchema = z.object({
  accountSize: boundedNum(0, 100_000_000),
  riskMode: z.enum(["pct", "usd"]),
  riskPct: boundedNum(0, 10),
  riskUsd: boundedNum(0, 1_000_000),
  commissionPerShare: boundedNum(0, 1),
  commissionMin: boundedNum(0, 100),
  leverageIntraday: boundedNum(1, 20),
  leverageOvernight: boundedNum(1, 20),
  defaultHorizon: z.enum(["intraday", "overnight", "swing"]),
  updatedAt: z.string().max(40).nullable(),
}).partial();
const SettingsPatch = z.object({
  tradingDefaults: TradingDefaultsSchema.nullable().optional(),
});

router.get("/users/me/settings", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) { res.status(401).json({ error: "Authentication required" }); return; }
  if (isGuestUser(me)) { res.json({ settings: {} }); return; }
  await ensureSettingsColumn();
  const { rows } = await pool.query<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM users WHERE id = $1 LIMIT 1`,
    [me.id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ settings: rows[0].settings ?? {} });
}));

router.put("/users/me/settings", asyncHandler(async (req, res): Promise<void> => {
  if (!requireMember(req, res)) return;
  const body = SettingsPatch.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  await ensureSettingsColumn();
  const set: Record<string, unknown> = {};
  const drop: string[] = [];
  if (body.data.tradingDefaults === null) drop.push("tradingDefaults");
  else if (body.data.tradingDefaults !== undefined) {
    set.tradingDefaults = { ...body.data.tradingDefaults, updatedAt: body.data.tradingDefaults.updatedAt ?? new Date().toISOString() };
  }
  const { rows } = await pool.query<{ settings: Record<string, unknown> | null }>(
    `UPDATE users SET settings = (COALESCE(settings, '{}'::jsonb) - $2::text[]) || $1::jsonb
      WHERE id = $3 RETURNING settings`,
    [JSON.stringify(set), drop, req.authUser!.id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ settings: rows[0].settings ?? {} });
}));

// Small in-memory limiter so an open session can't be used to brute-force the current password.
const pwAttempts = new Map<number, { count: number; resetAt: number }>();
const PW_MAX_ATTEMPTS = 5;
const PW_WINDOW_MS = 15 * 60_000;

/** Change own password. Requires the current password; revokes all sessions (client must log in again). */
router.post("/users/me/password", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser;
  if (!me) { res.status(401).json({ error: "Authentication required" }); return; }
  const { currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword) {
    res.status(400).json({ error: "currentPassword and newPassword required" }); return;
  }
  if (newPassword.length < 4 || newPassword.length > 200) {
    res.status(400).json({ error: "Password must be 4–200 characters" }); return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ error: "New password must differ from the current one" }); return;
  }
  const now = Date.now();
  const att = pwAttempts.get(me.id);
  if (att && att.resetAt > now && att.count >= PW_MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many attempts, try again later" }); return;
  }
  const { rows } = await pool.query<{ password_hash: string | null }>(
    `SELECT password_hash FROM users WHERE id = $1 AND active = true LIMIT 1`,
    [me.id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  const ok = await verifyPassword(currentPassword, { passwordHash: rows[0].password_hash });
  if (!ok) {
    const cur = att && att.resetAt > now ? att : { count: 0, resetAt: now + PW_WINDOW_MS };
    cur.count++;
    pwAttempts.set(me.id, cur);
    res.status(400).json({ error: "Current password is incorrect" }); return;
  }
  pwAttempts.delete(me.id);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hashPassword(newPassword), me.id]);
  await bumpTokenVersion(me.id);
  res.json({ success: true, reloginRequired: true });
}));

// ─── Team overview (Settings → Команда, curator/admin) ───────────────────────

/**
 * One row per user with role, status, assignments, Telegram link state (boolean only — chat ids
 * are not exposed) and 30-day activity. Optional risk tier when the risk desk table exists.
 */
router.get("/users/team", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.read.team", null, "Curator or admin role required"))) return;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const { rows } = await pool.query<any>(
    `SELECT u.id, u.name, u.role, u.active,
            COALESCE(u.banned, false) AS banned,
            u.created_at AS "createdAt",
            (u.telegram_chat_id IS NOT NULL AND u.telegram_chat_id <> '') AS "telegramLinked",
            COALESCE(u.tg_notifications_enabled, true) AS "tgNotificationsEnabled",
            u.assigned_curator AS "assignedCurator",
            u.assigned_risk_manager AS "assignedRiskManager",
            u.assigned_mentor AS "assignedMentor",
            COALESCE(t.trades30, 0)::int AS "trades30",
            t.last_trade AS "lastTrade"
     FROM users u
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE LEFT(tr.date, 10) >= $1) AS trades30,
              MAX(LEFT(tr.date, 10)) AS last_trade
       FROM trades tr
       WHERE tr.trader = u.name AND tr.deleted_at IS NULL
     ) t ON true
     ORDER BY u.active DESC, CASE u.role WHEN 'admin' THEN 0 WHEN 'curator' THEN 1 ELSE 2 END, u.name`,
    [since],
  );
  const { rows: tiers } = await pool
    .query<{ trader: string; tier: string | null }>(`SELECT trader, tier FROM trader_risk_limits`)
    .catch(() => ({ rows: [] as { trader: string; tier: string | null }[] }));
  const tierBy = new Map(tiers.map((t) => [t.trader, t.tier]));
  res.json(rows.map((r) => ({ ...r, riskTier: tierBy.get(r.name) ?? null })));
}));

router.post("/users", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.manage", null, "Curator or admin role required"))) return;
  const adminMgr = await can(req, "users.manage.admins");
  const { name, password, role } = req.body as Record<string, unknown>;
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanPassword = typeof password === "string" ? password : "";
  if (!cleanName || !cleanPassword.trim()) { res.status(400).json({ error: "name and password required" }); return; }
  if (cleanName.length > 100) { res.status(400).json({ error: "Name too long" }); return; }
  if (cleanPassword.length < 4) { res.status(400).json({ error: "Password must be at least 4 characters" }); return; }
  const userRole = normalizeRole(role);
  if (userRole === "admin" && !adminMgr) { res.status(403).json({ error: "Only admin can create admins" }); return; }
  try {
    const passwordHash = await hashPassword(cleanPassword);
    const { rows } = await pool.query<any>(
      `INSERT INTO users (name, password_hash, role) VALUES ($1, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [cleanName, passwordHash, userRole]
    );
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "User with this name already exists" }); return; }
    throw e;
  }
}));

router.patch("/users/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await requireCap(req, res, "users.manage", null, "Curator or admin role required"))) return;
  const adminMgr = await can(req, "users.manage.admins");
  const { rows: targetRows } = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
  const target = targetRows[0];
  if (!target) { res.status(404).json({ error: "Not found" }); return; }
  if (target.role === "admin" && !adminMgr) { res.status(403).json({ error: "Only admin can modify admins" }); return; }

  const { name, password, role, active } = req.body as Record<string, unknown>;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  // `active` lets staff re-activate a user deactivated via DELETE (or deactivate, same rules as DELETE).
  let activeChanged = false;
  if (active !== undefined) {
    if (typeof active !== "boolean") { res.status(400).json({ error: "active must be boolean" }); return; }
    if (!active && id === req.authUser?.id) { res.status(400).json({ error: "Cannot deactivate yourself" }); return; }
    fields.push(`active = $${i++}`); vals.push(active);
    activeChanged = !active;
  }
  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName || cleanName.length > 100) { res.status(400).json({ error: "Invalid name" }); return; }
    fields.push(`name = $${i++}`); vals.push(cleanName);
  }
  let passwordChanged = false;
  if (password !== undefined) {
    const p = String(password);
    if (p.length < 4) { res.status(400).json({ error: "Password must be at least 4 characters" }); return; }
    fields.push(`password_hash = $${i++}`); vals.push(await hashPassword(p));
    passwordChanged = true;
  }
  let roleChanged = false;
  if (role !== undefined) {
    const newRole = normalizeRole(role);
    if (newRole === "admin" && !adminMgr) { res.status(403).json({ error: "Only admin can grant admin role" }); return; }
    if (id === req.authUser?.id && newRole !== target.role) { res.status(400).json({ error: "Cannot change your own role" }); return; }
    fields.push(`role = $${i++}`); vals.push(newRole);
    roleChanged = newRole !== target.role;
  }
  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  vals.push(id);
  try {
    const { rows } = await pool.query<any>(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i}
       RETURNING ${USER_COLUMNS}`,
      vals
    );
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    // Invalidate existing sessions so a reset password / new role takes effect immediately.
    if (passwordChanged || roleChanged || activeChanged) await bumpTokenVersion(id);
    res.json(rows[0]);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "User with this name already exists" }); return; }
    throw e;
  }
}));

router.delete("/users/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await requireCap(req, res, "users.manage", null, "Curator or admin role required"))) return;
  const adminMgr = await can(req, "users.manage.admins");
  if (id === req.authUser?.id) { res.status(400).json({ error: "Cannot deactivate yourself" }); return; }
  const { rows: targetRows } = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
  if (!targetRows[0]) { res.status(404).json({ error: "Not found" }); return; }
  if (targetRows[0].role === "admin" && !adminMgr) { res.status(403).json({ error: "Only admin can deactivate admins" }); return; }
  await pool.query(`UPDATE users SET active = false WHERE id = $1`, [id]);
  await bumpTokenVersion(id);
  res.json({ success: true });
}));

export default router;
