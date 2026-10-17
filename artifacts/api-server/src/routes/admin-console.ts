/**
 * Admin console (K2) — one place for the desk owner: system health, people management, audit search, data quality.
 *
 * Additive router (register in routes/index.ts: `router.use(adminConsoleRouter)`). Rules:
 *   • every mutation goes through requireCap and writes audit_log with the reason the operator typed;
 *   • no hard deletes — «Архив» = users.active=false, «Заморожен» = users.banned=true (both block login);
 *   • no external calls — PropReports health is read from local tables/env names only (never the broker host);
 *   • no secrets in responses — env var NAMES only, never values; passwords are never echoed or logged.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { logAudit } from "../lib/audit";
import { bumpTokenVersion, hashPassword } from "../lib/auth";
import { can, requireCap, resolveActor } from "../lib/permissions";
import { nyDate, addDays } from "../lib/tradingDate";
import { getSettings, setSetting, schedulerStatus, statusConfig } from "../lib/propreports";
import { cleanNameLatin, ensureNameLatin } from "../lib/peopleDirectory";

const router: IRouter = Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const reasonSchema = z.string().trim().min(3, "Укажите причину (минимум 3 символа)").max(2000);
const roleSchema = z.enum(["trader", "curator", "admin"]);

function badRequest(res: Response, err: z.ZodError) {
  res.status(400).json({ error: err.issues[0]?.message ?? "Неверный запрос", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}

/** Run a query that may hit an optional table/column; resolve to an empty result instead of failing the endpoint. */
async function soft<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await pool.query(sql, params)).rows as T[];
  } catch {
    return [];
  }
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

type UserRow = {
  id: number; name: string; role: string; active: boolean; banned: boolean;
  banned_reason: string | null; banned_at: Date | null; created_at: Date | null;
  assigned_curator: string | null; assigned_risk_manager: string | null; assigned_mentor: string | null;
  telegram_linked: boolean;
};

const USER_SELECT = `SELECT u.id, u.name, u.role, u.active, COALESCE(u.banned, false) AS banned, u.banned_reason, u.banned_at,
  u.created_at, u.assigned_curator, u.assigned_risk_manager, u.assigned_mentor,
  (u.telegram_chat_id IS NOT NULL AND u.telegram_chat_id <> '') AS telegram_linked
  FROM users u`;

function statusOf(u: { active: boolean; banned: boolean }): "active" | "frozen" | "archived" {
  if (!u.active) return "archived";
  if (u.banned) return "frozen";
  return "active";
}

async function loadUser(id: number): Promise<UserRow | null> {
  const rows = await soft<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
  return rows[0] ?? null;
}

// ─── Health ─────────────────────────────────────────────────────────────────

router.get("/admin/console/health", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "admin.audit"))) return;
  const today = nyDate();
  const since24 = new Date(Date.now() - 86_400_000);

  const [lastRunRows, accounts, pending, imported, failedRuns, auditErrors, settings] = await Promise.all([
    soft(`SELECT * FROM propreports_sync_runs ORDER BY started_at DESC LIMIT 1`),
    soft<{ account: string; trader: string | null; last_synced_at: Date | null }>(`SELECT account, trader, last_synced_at FROM propreports_accounts WHERE active = true`),
    soft<{ n: number }>(`SELECT COUNT(*)::int AS n FROM propreports_pending_trades`),
    soft<{ n: number; last: Date | null }>(`SELECT COUNT(*)::int AS n, MAX(synced_at) AS last FROM trades WHERE deleted_at IS NULL AND source = 'propreports'`),
    soft(`SELECT id, started_at, source, status, errors, error_text, file_name FROM propreports_sync_runs
          WHERE started_at >= $1 AND (status NOT IN ('ok', 'running') OR errors > 0) ORDER BY started_at DESC LIMIT 20`, [since24]),
    soft(`SELECT id, actor, action, details, created_at FROM audit_log
          WHERE created_at >= $1 AND (action ILIKE '%error%' OR action ILIKE '%fail%') ORDER BY created_at DESC LIMIT 20`, [since24]),
    getSettings().catch(() => null),
  ]);

  const cfg = statusConfig();
  const sched = schedulerStatus();
  const last = lastRunRows[0];
  const errors: { at: string | null; source: string; text: string }[] = [
    ...failedRuns.map((r: any) => ({
      at: iso(r.started_at),
      source: "propreports",
      text: `Синк #${r.id} (${r.source === "file" ? "файл" : r.source === "api" ? "API" : r.source}): ${r.status}${r.errors ? `, ошибок ${r.errors}` : ""}${r.error_text ? ` — ${String(r.error_text).slice(0, 200)}` : ""}`,
    })),
    ...auditErrors.map((r: any) => ({ at: iso(r.created_at), source: "audit", text: `${r.actor}: ${r.action}` })),
  ];
  if (sched.lastError) errors.push({ at: null, source: "scheduler", text: `Планировщик: ${sched.lastError.slice(0, 200)}` });

  res.json({
    generatedAt: new Date().toISOString(),
    today,
    sync: {
      configured: cfg.configured,
      missingEnv: cfg.missing, // variable NAMES only
      scheduler: sched,
      lastRun: last ? {
        id: Number(last.id), startedAt: iso(last.started_at), finishedAt: iso(last.finished_at), source: last.source, status: last.status,
        fileName: last.file_name ?? null, inserted: Number(last.inserted ?? 0), updated: Number(last.updated ?? 0),
        unchanged: Number(last.unchanged ?? 0), skipped: Number(last.skipped ?? 0), conflicts: Number(last.conflicts ?? 0),
        errors: Number(last.errors ?? 0), errorText: last.error_text ?? null, actor: last.actor ?? null,
      } : null,
      accounts: {
        total: accounts.length,
        mapped: accounts.filter((a) => a.trader).length,
        unmapped: accounts.filter((a) => !a.trader).map((a) => a.account),
      },
      unmatched: settings?.unmatched ?? [],
      pending: pending[0]?.n ?? 0,
      imported: imported[0]?.n ?? 0,
      lastSyncedAt: iso(imported[0]?.last),
    },
    errors24h: { count: errors.length, items: errors.slice(0, 20) },
  });
}));

// ─── People ─────────────────────────────────────────────────────────────────

router.get("/admin/console/people", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.read.team"))) return;
  const since30 = addDays(nyDate(), -30);
  await ensureNameLatin().catch(() => undefined);
  const [users, tiers, accounts, seen, trades, settings, latin] = await Promise.all([
    soft<UserRow>(`${USER_SELECT} ORDER BY u.active DESC, CASE u.role WHEN 'admin' THEN 0 WHEN 'curator' THEN 1 ELSE 2 END, u.name`),
    soft<{ trader: string; tier: string | null }>(`SELECT trader, tier FROM trader_risk_limits`),
    soft<{ id: number; account: string; trader: string | null; last_synced_at: Date | null; active: boolean }>(
      `SELECT id, account, trader, last_synced_at, active FROM propreports_accounts ORDER BY account`),
    soft<{ name: string; at: Date }>(`SELECT name, MAX(at) AS at FROM (
        SELECT trader AS name, MAX(created_at) AS at FROM activity_log WHERE trader IS NOT NULL GROUP BY trader
        UNION ALL SELECT actor, MAX(created_at) FROM audit_log GROUP BY actor
        UNION ALL SELECT trader, MAX(created_at) FROM trades WHERE deleted_at IS NULL AND COALESCE(source, '') <> 'propreports' GROUP BY trader
      ) x WHERE name IS NOT NULL GROUP BY name`),
    soft<{ trader: string; n30: number; last: string | null }>(
      `SELECT trader, COUNT(*) FILTER (WHERE LEFT(date, 10) >= $1)::int AS n30, MAX(LEFT(date, 10)) AS last
         FROM trades WHERE deleted_at IS NULL AND trader IS NOT NULL GROUP BY trader`, [since30]),
    getSettings().catch(() => null),
    soft<{ id: number; name_latin: string | null }>(`SELECT id, name_latin FROM users WHERE name_latin IS NOT NULL`),
  ]);
  const latinBy = new Map(latin.map((l) => [Number(l.id), l.name_latin]));
  const tierBy = new Map(tiers.map((t) => [t.trader, t.tier]));
  const seenBy = new Map(seen.map((s) => [s.name, iso(s.at)]));
  const tradesBy = new Map(trades.map((t) => [t.trader, t]));
  const accBy = new Map<string, string[]>();
  for (const a of accounts) if (a.trader) accBy.set(a.trader, [...(accBy.get(a.trader) ?? []), a.account]);

  res.json({
    people: users.map((u) => ({
      id: u.id,
      name: u.name,
      nameLatin: latinBy.get(Number(u.id)) ?? null,
      role: u.role,
      status: statusOf(u),
      active: u.active,
      banned: u.banned,
      bannedReason: u.banned_reason,
      bannedAt: iso(u.banned_at),
      createdAt: iso(u.created_at),
      tier: tierBy.get(u.name) ?? null,
      curator: u.assigned_curator,
      riskManager: u.assigned_risk_manager,
      mentor: u.assigned_mentor,
      accounts: accBy.get(u.name) ?? [],
      lastSeen: seenBy.get(u.name) ?? null,
      trades30: tradesBy.get(u.name)?.n30 ?? 0,
      lastTrade: tradesBy.get(u.name)?.last ?? null,
      telegramLinked: !!u.telegram_linked,
    })),
    accounts: {
      unmapped: accounts.filter((a) => !a.trader).map((a) => ({ id: a.id, account: a.account, lastSyncedAt: iso(a.last_synced_at) })),
      unmatched: settings?.unmatched ?? [],
    },
  });
}));

type ActionKind = "freeze" | "unfreeze" | "archive" | "restore" | "sessions" | "curator" | "role";
type ActionResult = { ok: true; name: string } | { ok: false; status: number; error: string; name?: string };

/**
 * Applies one people action with the same safety rules as the legacy admin routes:
 * nobody acts on themselves (except a session reset), admins are touched only with users.manage.admins,
 * curators are frozen only by someone who may manage admins (mirrors POST /admin/users/:id/ban).
 */
async function applyAction(
  req: Request,
  actor: { id: number; name: string },
  adminMgr: boolean,
  id: number,
  kind: ActionKind,
  reason: string,
  extra: { curator?: string | null; role?: string; bulk?: boolean } = {},
): Promise<ActionResult> {
  const u = await loadUser(id);
  if (!u) return { ok: false, status: 404, error: "Пользователь не найден" };
  const self = u.id === actor.id;
  if (self && kind !== "sessions" && kind !== "curator") return { ok: false, status: 400, error: "Нельзя применить к себе", name: u.name };
  if (u.role === "admin" && !adminMgr) return { ok: false, status: 403, error: "Админов меняет только администратор", name: u.name };
  const base = { name: u.name, reason, ...(extra.bulk ? { bulk: true } : {}) };

  switch (kind) {
    case "freeze": {
      if (u.role === "admin") return { ok: false, status: 403, error: "Админа нельзя заморозить", name: u.name };
      if (u.role === "curator" && !adminMgr) return { ok: false, status: 403, error: "Куратора замораживает только админ", name: u.name };
      if (u.banned) return { ok: false, status: 409, error: "Уже заморожен", name: u.name };
      await pool.query(`UPDATE users SET banned = true, banned_at = NOW(), banned_reason = $1 WHERE id = $2`, [reason, id]);
      await bumpTokenVersion(id);
      await logAudit({ actor: actor.name, action: "user.freeze", targetType: "user", targetId: String(id), details: base });
      break;
    }
    case "unfreeze": {
      if (!u.banned) return { ok: false, status: 409, error: "Не заморожен", name: u.name };
      await pool.query(`UPDATE users SET banned = false, banned_at = NULL, banned_reason = NULL WHERE id = $1`, [id]);
      await logAudit({ actor: actor.name, action: "user.unfreeze", targetType: "user", targetId: String(id), details: base });
      break;
    }
    case "archive": {
      if (!u.active) return { ok: false, status: 409, error: "Уже в архиве", name: u.name };
      if (u.role === "curator" && !adminMgr) return { ok: false, status: 403, error: "Куратора архивирует только админ", name: u.name };
      await pool.query(`UPDATE users SET active = false WHERE id = $1`, [id]);
      await bumpTokenVersion(id);
      await logAudit({ actor: actor.name, action: "user.archive", targetType: "user", targetId: String(id), details: base });
      break;
    }
    case "restore": {
      if (u.active) return { ok: false, status: 409, error: "Уже активен", name: u.name };
      await pool.query(`UPDATE users SET active = true WHERE id = $1`, [id]);
      await logAudit({ actor: actor.name, action: "user.restore", targetType: "user", targetId: String(id), details: base });
      break;
    }
    case "sessions": {
      await bumpTokenVersion(id);
      await logAudit({ actor: actor.name, action: "user.sessions.reset", targetType: "user", targetId: String(id), details: base });
      break;
    }
    case "curator": {
      const curator = extra.curator ?? null;
      if (curator) {
        const rows = await soft<{ name: string }>(
          `SELECT name FROM users WHERE name = $1 AND active = true AND COALESCE(banned, false) = false AND role IN ('curator', 'admin')`, [curator]);
        if (!rows[0]) return { ok: false, status: 400, error: `«${curator}» — не активный куратор`, name: u.name };
        if (curator === u.name) return { ok: false, status: 400, error: "Нельзя назначить куратором самого себя", name: u.name };
      }
      if ((u.assigned_curator ?? null) === curator) return { ok: false, status: 409, error: "Куратор уже назначен", name: u.name };
      await pool.query(`UPDATE users SET assigned_curator = $1 WHERE id = $2`, [curator, id]);
      await logAudit({ actor: actor.name, action: "user.curator.assign", targetType: "user", targetId: String(id), details: { ...base, from: u.assigned_curator, to: curator } });
      break;
    }
    case "role": {
      const role = roleSchema.safeParse(extra.role);
      if (!role.success) return { ok: false, status: 400, error: "Неизвестная роль", name: u.name };
      if (role.data === u.role) return { ok: false, status: 409, error: "Роль не изменилась", name: u.name };
      if (role.data === "admin" && !adminMgr) return { ok: false, status: 403, error: "Роль «Админ» выдаёт только администратор", name: u.name };
      await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [role.data, id]);
      await bumpTokenVersion(id); // role lives in the JWT — force re-login
      await logAudit({ actor: actor.name, action: "user.role.change", targetType: "user", targetId: String(id), details: { ...base, from: u.role, role: role.data } });
      break;
    }
  }
  return { ok: true, name: u.name };
}

async function actorOf(req: Request): Promise<{ id: number; name: string } | null> {
  const a = await resolveActor(req);
  return a ? { id: a.id, name: a.name } : null;
}

const singleBodies: Record<Exclude<ActionKind, "curator" | "role">, z.ZodTypeAny> = {
  freeze: z.object({ reason: reasonSchema }),
  unfreeze: z.object({ reason: reasonSchema }),
  archive: z.object({ reason: reasonSchema }),
  restore: z.object({ reason: reasonSchema }),
  sessions: z.object({ reason: reasonSchema }),
};

for (const kind of Object.keys(singleBodies) as (keyof typeof singleBodies)[]) {
  const path = kind === "sessions" ? "/admin/console/people/:id/sessions/reset" : `/admin/console/people/:id/${kind}`;
  router.post(path, asyncHandler(async (req, res): Promise<void> => {
    if (!(await requireCap(req, res, "users.manage"))) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Неверный id" }); return; }
    const parsed = singleBodies[kind].safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error); return; }
    const actor = await actorOf(req);
    if (!actor) { res.status(401).json({ error: "Требуется вход" }); return; }
    const r = await applyAction(req, actor, await can(req, "users.manage.admins"), id, kind, parsed.data.reason);
    if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
    res.json({ ok: true, name: r.name });
  }));
}

router.post("/admin/console/people/:id/curator", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.manage"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Неверный id" }); return; }
  const parsed = z.object({ curator: z.string().trim().max(120).nullable(), reason: reasonSchema }).safeParse(req.body ?? {});
  if (!parsed.success) { badRequest(res, parsed.error); return; }
  const actor = await actorOf(req);
  if (!actor) { res.status(401).json({ error: "Требуется вход" }); return; }
  const r = await applyAction(req, actor, await can(req, "users.manage.admins"), id, "curator", parsed.data.reason, { curator: parsed.data.curator || null });
  if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
  res.json({ ok: true, name: r.name });
}));

/** Latin alias for cross-script search (users.name_latin): {nameLatin: string | null}. Not a rename — names stay identifiers. */
router.post("/admin/console/people/:id/name-latin", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.manage"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Неверный id" }); return; }
  const cleaned = cleanNameLatin((req.body ?? {}).nameLatin);
  if (!cleaned.ok) { res.status(400).json({ error: cleaned.error }); return; }
  const actor = await actorOf(req);
  if (!actor) { res.status(401).json({ error: "Требуется вход" }); return; }
  await ensureNameLatin();
  const u = await loadUser(id);
  if (!u) { res.status(404).json({ error: "Пользователь не найден" }); return; }
  if (u.role === "admin" && u.id !== actor.id && !(await can(req, "users.manage.admins"))) { res.status(403).json({ error: "Админов меняет только администратор" }); return; }
  const { rows } = await pool.query<{ prev: string | null }>(
    `UPDATE users u SET name_latin = $1 FROM (SELECT name_latin AS prev FROM users WHERE id = $2) p WHERE u.id = $2 RETURNING p.prev`, [cleaned.value, id]);
  const prev = rows[0]?.prev ?? null;
  if (prev !== cleaned.value) {
    await logAudit({ actor: actor.name, action: "user.name_latin", targetType: "user", targetId: String(id), details: { name: u.name, from: prev, to: cleaned.value } });
  }
  res.json({ ok: true, name: u.name, nameLatin: cleaned.value });
}));

router.post("/admin/console/people/:id/role", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.manage"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Неверный id" }); return; }
  const parsed = z.object({ role: roleSchema, reason: reasonSchema }).safeParse(req.body ?? {});
  if (!parsed.success) { badRequest(res, parsed.error); return; }
  const actor = await actorOf(req);
  if (!actor) { res.status(401).json({ error: "Требуется вход" }); return; }
  const r = await applyAction(req, actor, await can(req, "users.manage.admins"), id, "role", parsed.data.reason, { role: parsed.data.role });
  if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
  res.json({ ok: true, name: r.name, role: parsed.data.role });
}));

router.post("/admin/console/people/bulk", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.manage"))) return;
  const parsed = z.object({
    ids: z.array(z.number().int()).min(1).max(200),
    action: z.enum(["freeze", "unfreeze", "archive", "restore", "sessions", "curator"]),
    curator: z.string().trim().max(120).nullable().optional(),
    reason: reasonSchema,
  }).safeParse(req.body ?? {});
  if (!parsed.success) { badRequest(res, parsed.error); return; }
  const actor = await actorOf(req);
  if (!actor) { res.status(401).json({ error: "Требуется вход" }); return; }
  const adminMgr = await can(req, "users.manage.admins");
  const done: string[] = [];
  const skipped: { id: number; name?: string; error: string }[] = [];
  for (const id of [...new Set(parsed.data.ids)]) {
    const r = await applyAction(req, actor, adminMgr, id, parsed.data.action, parsed.data.reason, { curator: parsed.data.curator ?? null, bulk: true });
    if (r.ok) done.push(r.name); else skipped.push({ id, name: r.name, error: r.error });
  }
  res.json({ ok: true, done, skipped });
}));

router.post("/admin/console/people", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.manage"))) return;
  const parsed = z.object({
    name: z.string().trim().min(1, "Укажите имя").max(100),
    password: z.string().min(4, "Пароль — минимум 4 символа").max(200),
    role: roleSchema.default("trader"),
    curator: z.string().trim().max(120).nullable().optional(),
    reason: reasonSchema,
  }).safeParse(req.body ?? {});
  if (!parsed.success) { badRequest(res, parsed.error); return; }
  const actor = await actorOf(req);
  if (!actor) { res.status(401).json({ error: "Требуется вход" }); return; }
  const { name, password, role, curator, reason } = parsed.data;
  if (role === "admin" && !(await can(req, "users.manage.admins"))) { res.status(403).json({ error: "Админа создаёт только администратор" }); return; }
  if (curator) {
    const rows = await soft(`SELECT 1 FROM users WHERE name = $1 AND active = true AND role IN ('curator', 'admin')`, [curator]);
    if (!rows[0]) { res.status(400).json({ error: `«${curator}» — не активный куратор` }); return; }
  }
  try {
    const hash = await hashPassword(password);
    const { rows } = await pool.query<{ id: number; name: string }>(
      `INSERT INTO users (name, password_hash, role, assigned_curator) VALUES ($1, $2, $3, $4) RETURNING id, name`,
      [name, hash, role, curator || null],
    );
    const u = rows[0]!;
    await logAudit({ actor: actor.name, action: "user.create", targetType: "user", targetId: String(u.id), details: { name: u.name, role, curator: curator || null, reason } });
    res.status(201).json({ ok: true, id: u.id, name: u.name });
  } catch (e: any) {
    if (e?.code === "23505") { res.status(409).json({ error: "Пользователь с таким именем уже есть" }); return; }
    throw e;
  }
}));

// Match a PropReports account seen in imports to a user. Mapping table only — the parser/import logic is untouched.
router.post("/admin/console/accounts/map", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "propreports.configure"))) return;
  const parsed = z.object({
    account: z.string().trim().min(1).max(120),
    trader: z.string().trim().min(1).max(120),
    reason: reasonSchema,
  }).safeParse(req.body ?? {});
  if (!parsed.success) { badRequest(res, parsed.error); return; }
  const actor = await actorOf(req);
  if (!actor) { res.status(401).json({ error: "Требуется вход" }); return; }
  const { account, trader, reason } = parsed.data;
  const known = await soft(`SELECT 1 FROM users WHERE name = $1 AND active = true`, [trader]);
  if (!known[0]) { res.status(400).json({ error: `Неизвестный или архивный пользователь: ${trader}` }); return; }
  const prev = await soft<{ trader: string | null }>(`SELECT trader FROM propreports_accounts WHERE account = $1`, [account]);
  await pool.query(
    `INSERT INTO propreports_accounts (account, trader) VALUES ($1, $2)
     ON CONFLICT (account) DO UPDATE SET trader = $2, updated_at = NOW()`,
    [account, trader],
  );
  const settings = await getSettings().catch(() => null);
  if (settings?.unmatched.length) {
    const rest = settings.unmatched.filter((u) => u.toLowerCase() !== account.toLowerCase());
    if (rest.length !== settings.unmatched.length) await setSetting("unmatched", rest);
  }
  await logAudit({ actor: actor.name, action: "propreports.account.map", targetType: "propreports_accounts", targetId: account, details: { account, trader, from: prev[0]?.trader ?? null, reason } });
  res.json({ ok: true, account, trader });
}));

// ─── Audit search ───────────────────────────────────────────────────────────

router.get("/admin/console/audit", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "admin.audit"))) return;
  const str = (k: string, max = 120) => (typeof req.query[k] === "string" ? String(req.query[k]).trim().slice(0, max) : "");
  const actor = str("actor");
  const action = str("action");
  const targetType = str("targetType");
  const targetId = str("targetId");
  const q = str("q", 100);
  const from = str("from", 10);
  const to = str("to", 10);
  const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("$?", `$${params.length}`)); };
  if (actor) add(`actor = $?`, actor);
  if (action) {
    if (action.endsWith(".*")) add(`action LIKE $?`, `${action.slice(0, -2).replace(/[\\%_]/g, (m) => `\\${m}`)}.%`);
    else add(`action = $?`, action);
  }
  if (targetType) add(`target_type = $?`, targetType);
  if (targetId) add(`target_id = $?`, targetId);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    params.push(like);
    const p = `$${params.length}`;
    where.push(`(actor ILIKE ${p} OR action ILIKE ${p} OR COALESCE(target_id, '') ILIKE ${p} OR COALESCE(details, '') ILIKE ${p})`);
  }
  // Day boundaries are New York trading days (desk convention).
  if (YMD.test(from)) add(`(created_at AT TIME ZONE 'America/New_York')::date >= $?::date`, from);
  if (YMD.test(to)) add(`(created_at AT TIME ZONE 'America/New_York')::date <= $?::date`, to);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [items, total, facets] = await Promise.all([
    pool.query(`SELECT id, actor, action, target_type AS "targetType", target_id AS "targetId", details, created_at AS "createdAt"
                FROM audit_log ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, params),
    pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log ${whereSql}`, params),
    pool.query<{ kind: string; v: string; n: number }>(
      `SELECT 'actor' AS kind, actor AS v, COUNT(*)::int AS n FROM audit_log GROUP BY actor
       UNION ALL SELECT 'action', action, COUNT(*)::int FROM audit_log GROUP BY action
       UNION ALL SELECT 'targetType', target_type, COUNT(*)::int FROM audit_log WHERE target_type IS NOT NULL GROUP BY target_type`),
  ]);
  const facet = (k: string) => facets.rows.filter((r) => r.kind === k).sort((a, b) => b.n - a.n).slice(0, 200).map((r) => ({ value: r.v, count: r.n }));
  res.json({
    items: items.rows.map((r: any) => ({ ...r, createdAt: iso(r.createdAt) })),
    total: total.rows[0]?.n ?? 0,
    limit,
    offset,
    facets: { actors: facet("actor"), actions: facet("action"), targetTypes: facet("targetType") },
  });
}));

// ─── Data quality ───────────────────────────────────────────────────────────

router.get("/admin/console/data-quality", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "propreports.read.team"))) return;
  const today = nyDate();
  const DATE_OK = `date ~ '^\\d{4}-\\d{2}-\\d{2}'`;

  const [noTrader, unknownTrader, dupGroups, dateMismatch, weekend, future, exitBefore, unmappedBroker, pending, legacy] = await Promise.all([
    soft(`SELECT id, ticker, LEFT(date, 10) AS date, trader, source, broker_account AS "brokerAccount" FROM trades
          WHERE deleted_at IS NULL AND (trader IS NULL OR BTRIM(trader) = '') ORDER BY date DESC LIMIT 500`),
    soft(`SELECT t.id, t.ticker, LEFT(t.date, 10) AS date, t.trader, t.source, t.broker_account AS "brokerAccount" FROM trades t
          WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND BTRIM(t.trader) <> ''
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.name = t.trader) ORDER BY t.date DESC LIMIT 500`),
    soft(`SELECT trader, ticker, LEFT(date, 10) AS date, side, COUNT(*)::int AS n, ARRAY_AGG(id ORDER BY id) AS ids FROM trades
          WHERE deleted_at IS NULL AND trader IS NOT NULL
          GROUP BY trader, ticker, LEFT(date, 10), side, entry, exit, pnl, COALESCE(qty, 0)
          HAVING COUNT(*) > 1 ORDER BY LEFT(date, 10) DESC LIMIT 500`),
    soft(`SELECT id, ticker, LEFT(date, 10) AS date, trader, LEFT(context_snapshot ->> 'openedAt', 10) AS "openedDate" FROM trades
          WHERE deleted_at IS NULL AND context_snapshot ->> 'openedAt' ~ '^\\d{4}-\\d{2}-\\d{2}'
            AND LEFT(context_snapshot ->> 'openedAt', 10) <> LEFT(date, 10) ORDER BY date DESC LIMIT 500`),
    soft(`SELECT id, ticker, LEFT(date, 10) AS date, trader FROM trades
          WHERE deleted_at IS NULL AND ${DATE_OK} AND EXTRACT(ISODOW FROM LEFT(date, 10)::date) IN (6, 7) ORDER BY date DESC LIMIT 500`),
    soft(`SELECT id, ticker, LEFT(date, 10) AS date, trader FROM trades
          WHERE deleted_at IS NULL AND ${DATE_OK} AND LEFT(date, 10) > $1 ORDER BY date DESC LIMIT 500`, [today]),
    soft(`SELECT id, ticker, LEFT(date, 10) AS date, exit_date AS "exitDate", trader FROM trades
          WHERE deleted_at IS NULL AND exit_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(exit_date, 10) < LEFT(date, 10) ORDER BY date DESC LIMIT 500`),
    soft(`SELECT t.broker_account AS account, COUNT(*)::int AS n FROM trades t
          WHERE t.deleted_at IS NULL AND t.source = 'propreports' AND t.broker_account IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM propreports_accounts a WHERE a.trader IS NOT NULL AND (a.account = t.broker_account OR t.broker_account = ANY(a.aliases)))
          GROUP BY t.broker_account ORDER BY n DESC LIMIT 100`),
    soft<{ n: number }>(`SELECT COUNT(*)::int AS n FROM propreports_pending_trades`),
    soft<{ n: number }>(`SELECT COUNT(*)::int AS n FROM trades WHERE deleted_at IS NULL AND external_id IS NULL AND context_snapshot ->> 'source' = 'propreports'`),
  ]);

  const dupExtra = dupGroups.reduce((s: number, g: any) => s + (Number(g.n) - 1), 0);
  const sample = <T,>(rows: T[]) => rows.slice(0, 25);
  const checks = [
    { key: "no_trader", label: "Сделки без трейдера", severity: "high", count: noTrader.length, sample: sample(noTrader),
      hint: "Сделка не попадёт ни в чей журнал и статистику. Привяжите счёт к трейдеру во вкладке «Интеграции → Счета»." },
    { key: "unknown_trader", label: "Трейдер не найден среди пользователей", severity: "medium", count: unknownTrader.length, sample: sample(unknownTrader),
      hint: "Имя в сделке не совпадает ни с одной учёткой (переименование или опечатка в привязке счёта)." },
    { key: "unmapped_account", label: "Сделки со счетов без привязки", severity: "high", count: unmappedBroker.reduce((s: number, r: any) => s + Number(r.n), 0), sample: sample(unmappedBroker),
      hint: "Счёт брокера есть в сделках, но не привязан к трейдеру." },
    { key: "duplicates", label: "Возможные дубликаты", severity: "medium", count: dupExtra, groups: dupGroups.length, sample: sample(dupGroups),
      hint: "Одинаковые трейдер, тикер, дата, сторона, вход, выход и P&L. Разберите в «Интеграции → Сверка»." },
    { key: "ny_date_mismatch", label: "Дата сделки ≠ дата открытия (NY)", severity: "medium", count: dateMismatch.length, sample: sample(dateMismatch),
      hint: "Торговая дата должна совпадать с датой открытия по Нью-Йорку. Обычно это ручная правка или старый импорт." },
    { key: "weekend", label: "Сделки в выходные", severity: "low", count: weekend.length, sample: sample(weekend),
      hint: "Рынок США закрыт в субботу и воскресенье — вероятно, дата записана не по NY." },
    { key: "future", label: "Сделки с датой в будущем", severity: "medium", count: future.length, sample: sample(future), hint: `Сегодня по NY: ${today}.` },
    { key: "exit_before_entry", label: "Дата выхода раньше даты входа", severity: "low", count: exitBefore.length, sample: sample(exitBefore), hint: "Проверьте exit_date у многодневных сделок." },
    { key: "pending_reconcile", label: "Ждут сверки", severity: "medium", count: pending[0]?.n ?? 0, sample: [], hint: "Сделки брокера, совпавшие с ручными — решите в «Интеграции → Сверка»." },
    { key: "legacy_no_id", label: "Старый импорт без ID брокера", severity: "low", count: legacy[0]?.n ?? 0, sample: [], hint: "Получат ID при следующем импорте того же периода." },
  ];
  res.json({ generatedAt: new Date().toISOString(), today, checks });
}));

export default router;
