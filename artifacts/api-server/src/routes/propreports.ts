/**
 * PropReports integration endpoints (all under /api/propreports, auth required).
 *
 *   GET  /status                       config state (env var NAMES only, never values), scheduler, accounts, last run, inbox size
 *   GET  /accounts                     broker account → trader mapping (traders: own only)
 *   PUT  /accounts                     [curator] upsert mappings  body: { accounts: [{ account, trader, active, notes }] }
 *   POST /accounts/refresh             [curator] pull the account list from the API (503 when not configured)
 *   POST /import?dryRun=1              multipart "file" (Fills CSV or Trades report XLS/CSV), fields: kind=auto|fills|trades, account
 *                                      dryRun → preview only (no writes); traders may import only their own accounts
 *   POST /sync                         [curator] { from, to, dryRun }  pull fills over the API and apply (503 when not configured)
 *   GET  /runs?limit=                  sync history
 *   GET  /reconcile                    inbox: broker trips that collide with a manual trade (traders: own only)
 *   POST /reconcile/:tradeId/merge     [curator] { pendingId } → broker numbers into the manual trade
 *   POST /reconcile/pending/:id/keep   [curator] insert the broker trip as a separate trade
 *   DELETE /reconcile/pending/:id      [curator] drop the pending record (trade stays manual)
 *   GET  /daily?trader=&from=&to=      per-day aggregate of broker-sourced trades (contract documented at the handler)
 *   GET  /performance?trader=&account= aggregate "Trade Performance" reports (summary list + latest full report), traders: own only
 *   GET  /performance/:id              one stored report with full data
 *   DELETE /performance/:id            [curator] remove a stored report
 *   POST /import with a Trade Performance XLS → kind="performance": stored as broker statistics (no journal trades)
 *   GET  /check                        [curator] read-only connection probe (action=version); records API v2 / legacy mode
 *   GET  /groups                       [curator] PropReports groups (API) — or group names derived from the accounts list
 *   GET  /settings                     fee columns (include/exclude/rename), chosen group, unmatched accounts, last check
 *   PUT  /settings                     [curator] { groupId?, fees?: { columns, confirm }, unmatched? }
 *   PUT  /accounts also accepts aliases: string[] — raw account names that map to this account
 */
import { Router, type IRouter, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import multer from "multer";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../lib/auth";
import { can, requireCap } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { closeDateSql, closedSql, netPnlSql, resultSql } from "../lib/tradeMath";
import { addDays, nyDate } from "../lib/tradingDate";
import {
  parseFillsCsv, isFillsCsv, parseTradesReportBuffer, reportTradesToRoundTrips,
  buildRoundTrips, summarizeTrips, planSync, applySync, listPending, mergePending, keepPendingSeparate, dismissPending,
  loadAccountMappings, getClient, getConfiguredClient, effectiveGroupId, isConfigured, statusConfig, startScheduler, schedulerStatus, PropReportsError,
  getSettings, setSetting, feeLabel, orderedFeeKeys, type DetectedFeeColumn, type IntegrationSettings, type TradesReportDiagnostics,
  performanceSheetRows, isPerformanceReport, parsePerformanceRows, performanceFileMeta,
  savePerformanceReport, listPerformanceReports, getPerformanceReport, deletePerformanceReport, traderForAccount,
  type RoundTrip, type SyncPlan,
} from "../lib/propreports";
import { notifyUser, notifyUsers } from "../lib/notifyUtils";
import { notifLinks } from "../lib/notificationCore";
import { inBackground, staffOrFallback } from "../lib/notifyEvents";
import { syncNotice, unmatchedNotice, type SyncCounts } from "../lib/notifyEventsCore";

const router: IRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Access via the permissions matrix (lib/permissions.ts; role from the DB, not the token):
 * `staff` = propreports.read.team (desk-wide reads), mutations gate on propreports.configure (account mapping,
 * settings) and propreports.sync (sync run, reconcile decisions, report deletion).
 */
async function viewer(req: Request): Promise<{ name: string; staff: boolean }> {
  return { name: req.authUser!.name, staff: await can(req, "propreports.read.team") };
}

function badRequest(res: Response, parsed: z.SafeParseError<unknown>): void {
  res.status(400).json({ error: "Некорректный запрос", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата YYYY-MM-DD");

const NOT_CONFIGURED = { error: "PropReports API не настроено: задайте PROPREPORTS_DOMAIN и PROPREPORTS_TOKEN (или PROPREPORTS_USER + PROPREPORTS_PASSWORD) в .env.local и перезапустите сервер" };

const ALLOWED_EXT = new Set([".csv", ".txt", ".xls", ".xlsx"]);
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error("Допустимы только файлы .csv, .txt, .xls, .xlsx"));
    cb(null, true);
  },
});
const uploadFile: RequestHandler = (req, res, next) => {
  uploader.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const msg = err instanceof Error ? err.message : "upload failed";
    res.status(msg.toLowerCase().includes("file too large") ? 413 : 400).json({ error: msg });
  });
};

/**
 * After a real (non-dry) import / API sync: `sync` summary to the actor who ran it (an explicit result receipt —
 * the inbox keeps it after the page is closed) and `sync_unmatched` when broker accounts are not mapped to a
 * trader — to the actor, plus the trader's staff when the actor is a trader importing their own file.
 * Background only: never delays or fails the import response.
 */
function notifySyncOutcome(opts: { actor: string; actorIsStaff: boolean; label: string; context: string | null; result: SyncCounts & { runId: number }; unmapped: string[] }): void {
  inBackground("propreports.sync", async () => {
    const n = syncNotice(opts.result, opts.label, opts.context);
    await notifyUser({
      userName: opts.actor, type: "sync", source: "propreports", severity: n.severity,
      title: n.title, message: n.message, link: notifLinks.integrations(), entityType: "propreports_run", entityId: opts.result.runId || null,
    });
    const u = unmatchedNotice(opts.unmapped);
    if (u) {
      const recipients = opts.actorIsStaff ? [opts.actor] : [opts.actor, ...(await staffOrFallback(opts.actor))];
      await notifyUsers(recipients, {
        type: "sync_unmatched", source: "propreports", actor: opts.actorIsStaff ? null : opts.actor,
        title: u.title, message: u.message, link: notifLinks.integrations(), entityType: "propreports_run", entityId: opts.result.runId || null,
      });
    }
  });
}

/** Compact, JSON-safe preview of a plan (full trips are large; the UI shows executions on expand). */
function serializePlan(plan: SyncPlan, extra: Record<string, unknown>) {
  const trips = plan.items.map((i) => i.trip);
  return {
    ...extra,
    counts: plan.counts,
    unmappedAccounts: plan.unmappedAccounts,
    inactiveAccounts: plan.inactiveAccounts,
    dateFrom: plan.dateFrom,
    dateTo: plan.dateTo,
    feeColumns: plan.feeColumns,
    resolvedAccounts: plan.resolvedAccounts,
    summary: summarizeTrips(trips),
    items: plan.items.slice(0, 3000).map((i) => ({
      externalId: i.externalId,
      action: i.action,
      reason: i.reason ?? null,
      trader: i.trader,
      account: i.account,
      tradeId: i.tradeId,
      pendingId: i.pendingId,
      changes: i.changes,
      candidates: i.candidates,
      trip: tripView(i.trip),
    })),
    truncated: plan.items.length > 3000,
  };
}

function tripView(t: RoundTrip) {
  return {
    symbol: t.symbol, side: t.side, date: t.date, exitDate: t.exitDate, openedAt: t.openedAt, closedAt: t.closedAt,
    horizon: t.horizon, session: t.session, qty: t.qty, openQty: t.openQty, avgEntry: t.avgEntry, avgExit: t.avgExit,
    grossPnl: t.grossPnl, fees: t.fees, totalFees: t.totalFees, netPnl: t.netPnl, result: t.result, holdTime: t.holdTime,
    fillCount: t.fillCount, open: t.open, fromReport: !!t.fromReport, executions: t.executions,
  };
}

export interface FeeColumnView { key: string; header: string | null; label: string; known: boolean; heuristic: boolean; include: boolean; lastSeenAt: string | null; customLabel: string | null }

/** Union of detected and configured fee columns, in canonical order, for the «Комиссии» block. */
function feeColumnsView(settings: IntegrationSettings): FeeColumnView[] {
  const keys = new Set<string>([...settings.fees.detected.map((c) => c.key), ...Object.keys(settings.fees.columns)]);
  return orderedFeeKeys(keys).map((key) => {
    const d = settings.fees.detected.find((c) => c.key === key);
    const c = settings.fees.columns[key];
    return {
      key,
      header: c?.header ?? d?.header ?? null,
      label: c?.label || feeLabel(key, settings.fees),
      known: c?.known ?? d?.known ?? false,
      heuristic: c?.heuristic ?? d?.heuristic ?? false,
      include: c?.include !== false,
      lastSeenAt: c?.lastSeenAt ?? null,
      customLabel: c?.label ?? null,
    };
  });
}

async function lastRun() {
  const { rows } = await pool.query(`SELECT * FROM propreports_sync_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ? runView(rows[0]) : null;
}

function runView(r: any) {
  return {
    id: Number(r.id),
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    source: r.source,
    status: r.status,
    fileName: r.file_name ?? null,
    dateFrom: r.date_from ?? null,
    dateTo: r.date_to ?? null,
    inserted: Number(r.inserted ?? 0),
    updated: Number(r.updated ?? 0),
    unchanged: Number(r.unchanged ?? 0),
    skipped: Number(r.skipped ?? 0),
    conflicts: Number(r.conflicts ?? 0),
    errors: Number(r.errors ?? 0),
    errorText: r.error_text ?? null,
    actor: r.actor ?? null,
    details: r.details ?? null,
  };
}

// ─── status ─────────────────────────────────────────────────────────────────

router.get("/propreports/status", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  const cfg = statusConfig();
  const accounts = (await loadAccountMappings()).filter((a) => v.staff || a.trader === v.name);
  const pendingCount = await pool.query(`SELECT COUNT(*)::int AS n FROM propreports_pending_trades WHERE $1::text IS NULL OR trader = $1`, [v.staff ? null : v.name]);
  const imported = await pool.query(
    `SELECT COUNT(*)::int AS n, MAX(synced_at) AS last FROM trades WHERE deleted_at IS NULL AND source = 'propreports' AND ($1::text IS NULL OR trader = $1)`,
    [v.staff ? null : v.name],
  );
  const legacy = await pool.query(
    `SELECT COUNT(*)::int AS n FROM trades WHERE deleted_at IS NULL AND external_id IS NULL AND context_snapshot ->> 'source' = 'propreports' AND ($1::text IS NULL OR trader = $1)`,
    [v.staff ? null : v.name],
  );
  const settings = await getSettings();
  const last = v.staff ? await lastRun() : null;
  const okRuns = await pool.query(`SELECT COUNT(*)::int AS n FROM propreports_sync_runs WHERE status IN ('ok', 'partial')`);
  const unmappedAccounts = accounts.filter((a) => !a.trader).map((a) => a.account);
  const feeView = feeColumnsView(settings);
  const group = effectiveGroupId(settings.groupId);
  const conn = settings.connection;
  const wizard = {
    env: {
      ok: cfg.configured,
      detail: cfg.configured ? `${cfg.domain} · ${cfg.authMode === "token" ? "токен API" : "логин/пароль"}` : `В .env.local не задано: ${cfg.missing.join(", ")}`,
    },
    connection: {
      ok: conn.ok === true,
      detail: conn.ok === true
        ? `${conn.mode === "v2" ? "API v2 (токен)" : "legacy-логин"}${conn.version ? ` · версия ${conn.version}` : ""}`
        : conn.ok === false ? `Ошибка: ${conn.error ?? "неизвестно"}` : "Не проверено",
    },
    accounts: {
      ok: accounts.length > 0 && unmappedAccounts.length === 0 && settings.unmatched.length === 0,
      detail: accounts.length === 0
        ? "Счета ещё не добавлены"
        : `${accounts.filter((a) => a.trader).length}/${accounts.length} привязано${unmappedAccounts.length ? ` · без трейдера: ${unmappedAccounts.length}` : ""}${settings.unmatched.length ? ` · несопоставлено: ${settings.unmatched.length}` : ""}`,
    },
    fees: {
      ok: !!settings.fees.confirmedAt,
      detail: feeView.length
        ? `${feeView.length} колонок, учитываются ${feeView.filter((c) => c.include).length}${settings.fees.confirmedAt ? " · подтверждено" : " · не подтверждено"}`
        : "Колонки появятся после первого импорта/синка",
    },
    firstSync: {
      ok: imported.rows[0].n > 0 || okRuns.rows[0].n > 0,
      detail: imported.rows[0].n > 0 ? `${imported.rows[0].n} сделок из брокера` : "Ещё не было ни одного импорта",
    },
  };
  res.json({
    connection: conn,
    settings: { groupId: settings.groupId, effectiveGroupId: group.groupId, groupSource: group.source, feesConfirmedAt: settings.fees.confirmedAt, feeColumns: feeView, unmatched: settings.unmatched },
    wizard,
    viewer: { name: v.name, staff: v.staff },
    config: cfg, // names only — statusConfig never returns secret values
    scheduler: schedulerStatus(),
    accounts: {
      total: accounts.length,
      mapped: accounts.filter((a) => a.trader).length,
      unmapped: accounts.filter((a) => !a.trader).map((a) => a.account),
      lastSyncedAt: accounts.reduce<string | null>((m, a) => (a.lastSyncedAt && (!m || a.lastSyncedAt > m) ? a.lastSyncedAt : m), null),
    },
    trades: { imported: imported.rows[0].n, lastSyncedAt: imported.rows[0].last ? new Date(imported.rows[0].last).toISOString() : null, legacyWithoutId: legacy.rows[0].n },
    pendingCount: pendingCount.rows[0].n,
    lastRun: v.staff ? await lastRun() : null,
  });
}));

// ─── accounts ───────────────────────────────────────────────────────────────

router.get("/propreports/accounts", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  const accounts = await loadAccountMappings();
  res.json(v.staff ? accounts : accounts.filter((a) => a.trader === v.name));
}));

const accountsBody = z.object({
  accounts: z.array(z.object({
    account: z.string().trim().min(1).max(120),
    trader: z.string().trim().max(120).nullable().optional(),
    active: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    accountId: z.string().trim().max(64).nullable().optional(),
    accountName: z.string().trim().max(200).nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  })).min(1).max(500),
});

router.put("/propreports/accounts", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.configure", null, "Только куратор может менять привязку счетов"))) return;
  const parsed = accountsBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);
  const traders = [...new Set(parsed.data.accounts.map((a) => a.trader).filter((t): t is string => !!t))];
  if (traders.length) {
    const { rows } = await pool.query(`SELECT name FROM users WHERE name = ANY($1::text[]) AND active = true`, [traders]);
    const known = new Set(rows.map((r: any) => r.name));
    const unknown = traders.filter((t) => !known.has(t));
    if (unknown.length) { res.status(400).json({ error: `Неизвестные трейдеры: ${unknown.join(", ")}` }); return; }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const a of parsed.data.accounts) {
      await client.query(
        `INSERT INTO propreports_accounts (account, account_id, account_name, trader, active, notes, aliases)
         VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), $6, COALESCE($7::text[], '{}'))
         ON CONFLICT (account) DO UPDATE SET
           trader = $4,
           active = COALESCE($5, propreports_accounts.active),
           notes = COALESCE($6, propreports_accounts.notes),
           account_id = COALESCE($2, propreports_accounts.account_id),
           account_name = COALESCE($3, propreports_accounts.account_name),
           aliases = COALESCE($7::text[], propreports_accounts.aliases),
           updated_at = NOW()`,
        [a.account, a.accountId ?? null, a.accountName ?? null, a.trader ?? null, a.active ?? null, a.notes ?? null, a.aliases ? [...new Set(a.aliases.filter((x) => x !== a.account))] : null],
      );
    }
    await client.query("COMMIT");
    // names that are now mapped (as account or alias) leave the «unmatched» list
    const settings = await getSettings();
    if (settings.unmatched.length) {
      const covered = new Set<string>();
      for (const a of parsed.data.accounts) { covered.add(a.account.toLowerCase()); for (const al of a.aliases ?? []) covered.add(al.toLowerCase()); }
      const rest = settings.unmatched.filter((u) => !covered.has(u.toLowerCase()));
      if (rest.length !== settings.unmatched.length) await setSetting("unmatched", rest);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await logAudit({ actor: v.name, action: "propreports.accounts.update", targetType: "propreports_accounts", details: { accounts: parsed.data.accounts.map((a) => a.account) } });
  res.json(await loadAccountMappings());
}));

router.delete("/propreports/accounts/:id", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.configure", null, "Только куратор"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const { rowCount } = await pool.query(`DELETE FROM propreports_accounts WHERE id = $1`, [id]);
  if (!rowCount) { res.status(404).json({ error: "Счёт не найден" }); return; }
  await logAudit({ actor: v.name, action: "propreports.accounts.delete", targetType: "propreports_accounts", targetId: String(id) });
  res.json({ ok: true });
}));

router.post("/propreports/accounts/refresh", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.configure", null, "Только куратор"))) return;
  const client = await getConfiguredClient();
  if (!client) { res.status(503).json(NOT_CONFIGURED); return; }
  let list;
  try {
    list = await client.accounts();
  } catch (e) {
    res.status(e instanceof PropReportsError && e.status ? 502 : 500).json({ error: e instanceof Error ? e.message : String(e) });
    return;
  }
  for (const a of list) {
    await pool.query(
      `INSERT INTO propreports_accounts (account, account_id, account_name) VALUES ($1, $2, $3)
       ON CONFLICT (account) DO UPDATE SET account_id = EXCLUDED.account_id, account_name = COALESCE(EXCLUDED.account_name, propreports_accounts.account_name), updated_at = NOW()`,
      [a.account, a.accountId || null, a.accountName],
    );
  }
  await logAudit({ actor: v.name, action: "propreports.accounts.refresh", targetType: "propreports_accounts", details: { count: list.length } });
  res.json({ fetched: list.length, accounts: await loadAccountMappings() });
}));

// ─── file import ────────────────────────────────────────────────────────────

const importFields = z.object({
  kind: z.enum(["auto", "fills", "trades", "performance"]).default("auto"),
  account: z.string().trim().max(120).optional(),
  trader: z.string().trim().max(120).optional(),
  periodFrom: ymd.optional(),
  periodTo: ymd.optional(),
});

/**
 * Trade Performance (aggregate) report: no individual trades, so nothing goes to `trades`.
 * Dry run → parsed summary + suggested trader; apply → upsert into propreports_performance_reports.
 */
async function handlePerformanceImport(req: Request, res: Response, v: { name: string; staff: boolean }, dryRun: boolean, fields: z.infer<typeof importFields>, rows: unknown[][]): Promise<void> {
  const file = req.file!;
  const report = parsePerformanceRows(rows);
  if (!report.totals) { res.status(400).json({ error: "Не удалось прочитать отчёт Trade Performance", issues: report.issues.slice(0, 20) }); return; }
  const meta = performanceFileMeta(file.originalname);
  const account = fields.account?.trim() || meta.account;
  if (!account) { res.status(400).json({ error: "Не удалось определить брокерский счёт по имени файла — укажите поле account" }); return; }
  const periodFrom = fields.periodFrom ?? meta.periodFrom;
  const periodTo = fields.periodTo ?? meta.periodTo;
  if (!periodFrom || !periodTo) { res.status(400).json({ error: "Не удалось определить период отчёта по имени файла — укажите periodFrom и periodTo" }); return; }
  const mapped = await traderForAccount(account);
  const trader = fields.trader?.trim() || mapped.trader || null;
  if (!v.staff && trader !== v.name) { res.status(403).json({ error: "Этот счёт не сопоставлен с вами — обратитесь к куратору" }); return; }
  if (trader) {
    const { rows: u } = await pool.query(`SELECT 1 FROM users WHERE name = $1 LIMIT 1`, [trader]);
    if (!u.length) { res.status(400).json({ error: `Трейдер «${trader}» не найден` }); return; }
  }
  const base = {
    kind: "performance" as const, fileName: file.originalname, account, trader, traderSource: fields.trader?.trim() ? "manual" : mapped.trader ? `mapping:${mapped.how}` : null,
    periodFrom, periodTo, summary: report.summary, issues: report.issues.slice(0, 20),
    bySide: report.bySide, byTime: report.byTime, byWeekday: report.byWeekday, perTradeAverages: report.perTradeAverages, symbols: report.bySymbol.length,
    note: "Это агрегированный отчёт: сделки в журнал из него не создаются. Для сделок нужен экспорт Trades или Fills.",
  };
  if (dryRun) { res.json({ dryRun: true, ...base }); return; }
  if (!trader) { res.status(400).json({ error: "Выберите трейдера, которому принадлежит счёт", ...base }); return; }
  const saved = await savePerformanceReport({ account, trader, periodFrom, periodTo, fileName: file.originalname, uploadedBy: v.name, report });
  res.json({ dryRun: false, ...base, reportId: saved.row.id, replaced: saved.replaced, uploadedAt: saved.row.uploadedAt });
}

router.post("/propreports/import", requireAuth, uploadFile, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  const dryRun = ["1", "true", "yes"].includes(String(req.query.dryRun ?? "").toLowerCase());
  const parsed = importFields.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed);
  const file = req.file;
  if (!file) { res.status(400).json({ error: "Файл не передан (поле file)" }); return; }
  const ext = (file.originalname.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();

  let trips: RoundTrip[] = [];
  let kind: "fills" | "trades";
  const diagnostics: Record<string, unknown> = {};
  let feeColumns: DetectedFeeColumn[] = [];
  const text = ext === ".xls" || ext === ".xlsx" ? null : file.buffer.toString("utf8");
  if (parsed.data.kind === "performance" || (parsed.data.kind === "auto" && (text == null || !isFillsCsv(text)))) {
    let rows: unknown[][] = [];
    try { rows = performanceSheetRows(file.buffer); } catch { rows = []; }
    if (parsed.data.kind === "performance" || isPerformanceReport(rows)) {
      await handlePerformanceImport(req, res, v, dryRun, parsed.data, rows);
      return;
    }
  }
  const wantFills = parsed.data.kind === "fills" || (parsed.data.kind === "auto" && text != null && isFillsCsv(text));
  if (wantFills) {
    if (text == null) { res.status(400).json({ error: "Fills ожидается в формате CSV" }); return; }
    kind = "fills";
    const p = parseFillsCsv(text);
    if (!p.fills.length) { res.status(400).json({ error: "В файле не найдено ни одной сделки (fills)", issues: p.issues.slice(0, 20), columns: p.columns }); return; }
    const built = buildRoundTrips(p.fills);
    trips = built.trips;
    feeColumns = p.feeColumns;
    Object.assign(diagnostics, {
      fills: p.fills.length, skippedRows: p.skipped, issues: p.issues.slice(0, 50), issueCount: p.issues.length, columns: p.columns,
      orphanFills: built.orphanFills.slice(0, 50).map((f) => ({ account: f.account, symbol: f.symbol, side: f.side, qty: f.qty, price: f.price, dateTime: f.dateTime, line: f.line })),
      orphanCount: built.orphanFills.length,
    });
  } else {
    kind = "trades";
    // The Trades export has no account column; PropReports names the file "<account>-<from>-to-<to>-trades.xls".
    const account = parsed.data.account?.trim() || performanceFileMeta(file.originalname).account || "";
    if (!account) { res.status(400).json({ error: "Для отчёта Trades укажите брокерский счёт (account): в файле нет колонки счёта, а в имени файла номер не найден" }); return; }
    let report;
    const diag: TradesReportDiagnostics = {};
    try { report = parseTradesReportBuffer(file.buffer, diag); } catch (e) { res.status(400).json({ error: `Не удалось прочитать файл: ${e instanceof Error ? e.message : String(e)}` }); return; }
    if (!report.length) { res.status(400).json({ error: "Не распознан ни один ряд отчёта Trades (ожидаются колонки Opened, Closed, Held, Symbol, Type, Entry, Exit, Qty, Gross … Net)" }); return; }
    trips = reportTradesToRoundTrips(report, account);
    feeColumns = diag.feeColumns ?? [];
    Object.assign(diagnostics, { reportRows: report.length, feesByType: report.some((r) => r.fees) });
  }

  const plan = await planSync(trips, { onlyTrader: v.staff ? null : v.name });
  if (dryRun) {
    res.json(serializePlan(plan, { dryRun: true, kind, fileName: file.originalname, ...diagnostics }));
    return;
  }
  const result = await applySync(plan, { actor: v.name, source: "file", fileName: file.originalname, feeColumns, details: { kind, ...diagnostics, issues: undefined, orphanFills: undefined, columns: undefined } });
  notifySyncOutcome({ actor: v.name, actorIsStaff: v.staff, label: "Импорт", context: file.originalname, result, unmapped: plan.unmappedAccounts });
  res.status(result.errors && !result.inserted && !result.updated ? 500 : 200).json({ ...result, kind, counts: plan.counts, unmappedAccounts: plan.unmappedAccounts, ...diagnostics });
}));

// ─── API sync ───────────────────────────────────────────────────────────────

const syncBody = z.object({
  from: ymd,
  to: ymd,
  dryRun: z.boolean().optional(),
  accountIds: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
}).refine((b) => b.from <= b.to, { message: "from должно быть ≤ to", path: ["to"] });

router.post("/propreports/sync", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "Запуск синхронизации доступен только куратору"))) return;
  if (!isConfigured()) { res.status(503).json(NOT_CONFIGURED); return; }
  const parsed = syncBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);
  const { from, to, dryRun, accountIds } = parsed.data;
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > 92) { res.status(400).json({ error: "Диапазон не больше 92 дней за один запуск" }); return; }
  const client = (await getConfiguredClient())!;
  let pulled;
  try {
    pulled = await client.fills(from, to, accountIds?.length ? { accountIds } : {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dryRun) {
      await pool.query(
        `INSERT INTO propreports_sync_runs (source, status, date_from, date_to, actor, errors, error_text, finished_at) VALUES ('api', 'error', $1, $2, $3, 1, $4, NOW())`,
        [from, to, v.name, msg],
      );
    }
    res.status(502).json({ error: msg });
    return;
  }
  const built = buildRoundTrips(pulled.fills);
  const plan = await planSync(built.trips);
  const diagnostics = { fills: pulled.fills.length, issueCount: pulled.issues.length, issues: pulled.issues.slice(0, 50), orphanCount: built.orphanFills.length };
  if (dryRun) {
    res.json(serializePlan(plan, { dryRun: true, kind: "fills", source: "api", from, to, ...diagnostics }));
    return;
  }
  const result = await applySync(plan, { actor: v.name, source: "api", dateFrom: from, dateTo: to, feeColumns: pulled.feeColumns, details: { fills: pulled.fills.length, orphanCount: built.orphanFills.length, accountIds: accountIds ?? null, groupId: client.defaultGroupId } });
  notifySyncOutcome({ actor: v.name, actorIsStaff: v.staff, label: "Синхронизация", context: from === to ? from : `${from} — ${to}`, result, unmapped: plan.unmappedAccounts });
  res.status(result.errors && !result.inserted && !result.updated ? 500 : 200).json({ ...result, counts: plan.counts, unmappedAccounts: plan.unmappedAccounts, ...diagnostics });
}));

// ─── runs ───────────────────────────────────────────────────────────────────

// Desk-wide history (scheduled/API syncs, unmapped account numbers) is staff-only (propreports.read.team);
// everyone else sees just the runs they started themselves (their own file imports).
router.get("/propreports/runs", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const { rows } = await pool.query(
    `SELECT * FROM propreports_sync_runs WHERE ($2::text IS NULL OR actor = $2) ORDER BY started_at DESC LIMIT $1`,
    [limit, v.staff ? null : v.name],
  );
  res.json(rows.map(runView));
}));

// ─── reconcile inbox ────────────────────────────────────────────────────────

router.get("/propreports/reconcile", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  res.json(await listPending(v.staff ? null : v.name));
}));

router.post("/propreports/reconcile/:tradeId/merge", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "Объединять сделки может только куратор"))) return;
  const tradeId = Number(req.params.tradeId);
  const parsed = z.object({ pendingId: z.number().int().positive() }).safeParse(req.body);
  if (!Number.isInteger(tradeId) || !parsed.success) { res.status(400).json({ error: "Нужны tradeId и pendingId" }); return; }
  const out = await mergePending(parsed.data.pendingId, tradeId, v.name);
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  res.json({ ok: true, tradeId: out.tradeId });
}));

router.post("/propreports/reconcile/pending/:id/keep", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "Только куратор"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const out = await keepPendingSeparate(id, v.name);
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  res.json({ ok: true, tradeId: out.tradeId });
}));

router.delete("/propreports/reconcile/pending/:id", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "Только куратор"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const ok = await dismissPending(id, v.name);
  if (!ok) { res.status(404).json({ error: "Запись не найдена" }); return; }
  res.json({ ok: true });
}));

// ─── daily aggregate ────────────────────────────────────────────────────────
/**
 * GET /api/propreports/daily?trader=&from=&to=
 * Broker-sourced trades (source='propreports' OR legacy context_snapshot.source='propreports'), grouped by the
 * day the P&L was realised: COALESCE(exit_date, date). Open positions are counted but their P&L is not.
 * Response: { trader, from, to, days: [{ date, trades, wins, losses, breakeven, open, gross, fees, net, qty }], totals: {…} }
 * gross = Σ pnl (broker gross); fees = Σ |fees|; net = Σ (pnl − |fees|) — lib/tradeMath.ts netPnlSql, closeDateSql, resultSql;
 * default range = last 30 New York calendar days (lib/tradingDate.ts nyDate).
 * Traders may only query themselves; curators any trader (omit `trader` for everyone).
 */
router.get("/propreports/daily", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  const q = z.object({ trader: z.string().trim().max(120).optional(), from: ymd.optional(), to: ymd.optional() }).safeParse(req.query);
  if (!q.success) return badRequest(res, q);
  let trader = q.data.trader || null;
  if (!v.staff) {
    if (trader && trader !== v.name) { res.status(403).json({ error: "Можно смотреть только свои данные" }); return; }
    trader = v.name;
  }
  const to = q.data.to ?? nyDate();
  const from = q.data.from ?? addDays(to, -30);
  // Shared definitions (lib/tradeMath.ts): result buckets, close date, net = pnl − |fees|.
  const { rows } = await pool.query(
    `SELECT ${closeDateSql("t")} AS day,
            COUNT(*)::int AS trades,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'win')::int AS wins,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'loss')::int AS losses,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'be')::int AS breakeven,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'open')::int AS open,
            COALESCE(SUM(t.pnl) FILTER (WHERE ${closedSql("t")}), 0)::float8 AS gross,
            COALESCE(SUM(ABS(COALESCE(t.fees, 0))) FILTER (WHERE ${closedSql("t")}), 0)::float8 AS fees,
            COALESCE(SUM(${netPnlSql("t")}) FILTER (WHERE ${closedSql("t")}), 0)::float8 AS net,
            COALESCE(SUM(t.qty), 0)::float8 AS qty
       FROM trades t
      WHERE t.deleted_at IS NULL
        AND (t.source = 'propreports' OR t.context_snapshot ->> 'source' = 'propreports')
        AND ($1::text IS NULL OR t.trader = $1)
        AND ${closeDateSql("t")} >= $2 AND ${closeDateSql("t")} <= $3
      GROUP BY 1 ORDER BY 1 ASC`,
    [trader, from, to],
  );
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const days = rows.map((r: any) => ({
    date: String(r.day), trades: r.trades, wins: r.wins, losses: r.losses, breakeven: r.breakeven, open: r.open,
    gross: r2(r.gross), fees: r2(r.fees), net: r2(r.net), qty: r.qty,
  }));
  const totals = days.reduce(
    (a, d) => ({ trades: a.trades + d.trades, wins: a.wins + d.wins, losses: a.losses + d.losses, breakeven: a.breakeven + d.breakeven, open: a.open + d.open, gross: r2(a.gross + d.gross), fees: r2(a.fees + d.fees), net: r2(a.net + d.net) }),
    { trades: 0, wins: 0, losses: 0, breakeven: 0, open: 0, gross: 0, fees: 0, net: 0 },
  );
  res.json({ trader, from, to, days, totals });
}));

// ─── self-configuration: connection check, groups, settings ─────────────────

router.get("/propreports/check", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!v.staff) { res.status(403).json({ error: "Только куратор" }); return; }
  const client = await getConfiguredClient();
  if (!client) { res.status(503).json({ ...NOT_CONFIGURED, connection: { checkedAt: new Date().toISOString(), ok: false, mode: null, version: null, error: NOT_CONFIGURED.error } }); return; }
  const result = await client.checkConnection(); // read-only: action=version
  await logAudit({ actor: v.name, action: "propreports.check", details: { ok: result.ok, mode: result.mode, version: result.version } });
  res.json(result);
}));

router.get("/propreports/groups", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!v.staff) { res.status(403).json({ error: "Только куратор" }); return; }
  const settings = await getSettings();
  const effective = effectiveGroupId(settings.groupId);
  const client = await getConfiguredClient();
  if (!client) { res.status(503).json({ ...NOT_CONFIGURED, groups: [], effective }); return; }
  try {
    const groups = await client.groups();
    res.json({ groups, source: "api", effective });
  } catch (e) {
    // some installations have no "groups" action: derive names from the accounts list (IDs unknown)
    try {
      const list = await client.accounts();
      const names = [...new Set(list.flatMap((a) => a.groups))].sort();
      res.json({ groups: names.map((name) => ({ groupId: null, name })), source: "accounts", effective, warning: e instanceof Error ? e.message : String(e) });
    } catch (e2) {
      res.status(502).json({ error: e2 instanceof Error ? e2.message : String(e2), groups: [], effective });
    }
  }
}));

router.get("/propreports/settings", requireAuth, asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  res.json({ groupId: settings.groupId, effective: effectiveGroupId(settings.groupId), feeColumns: feeColumnsView(settings), feesConfirmedAt: settings.fees.confirmedAt, unmatched: settings.unmatched, connection: settings.connection });
}));

const settingsBody = z.object({
  groupId: z.string().trim().regex(/^-?\d{1,12}$/, "groupId — число").nullable().optional(),
  fees: z.object({
    columns: z.record(z.string().min(1).max(64), z.object({ include: z.boolean(), label: z.string().trim().max(60).nullable().optional() })).optional(),
    confirm: z.boolean().optional(),
  }).optional(),
  unmatched: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
});

router.put("/propreports/settings", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.configure", null, "Только куратор"))) return;
  const parsed = settingsBody.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed);
  const settings = await getSettings();
  if (parsed.data.groupId !== undefined) await setSetting("groupId", parsed.data.groupId);
  if (parsed.data.fees) {
    const columns = { ...settings.fees.columns };
    for (const [key, c] of Object.entries(parsed.data.fees.columns ?? {})) {
      columns[key] = { ...columns[key], include: c.include, label: c.label === undefined ? columns[key]?.label ?? null : c.label };
    }
    await setSetting("fees", { ...settings.fees, columns, confirmedAt: parsed.data.fees.confirm ? new Date().toISOString() : settings.fees.confirmedAt });
  }
  if (parsed.data.unmatched) await setSetting("unmatched", [...new Set(parsed.data.unmatched)]);
  await logAudit({ actor: v.name, action: "propreports.settings.update", details: { groupId: parsed.data.groupId, feeKeys: Object.keys(parsed.data.fees?.columns ?? {}), confirm: parsed.data.fees?.confirm ?? false } });
  const fresh = await getSettings();
  res.json({ groupId: fresh.groupId, effective: effectiveGroupId(fresh.groupId), feeColumns: feeColumnsView(fresh), feesConfirmedAt: fresh.fees.confirmedAt, unmatched: fresh.unmatched, connection: fresh.connection });
}));

// ─── Trade Performance reports (aggregate broker statistics) ────────────────

/**
 * GET /api/propreports/performance?trader=&account=&id=
 * { reports: [{ id, account, traderName, periodFrom, periodTo, fileName, uploadedBy, uploadedAt, summary }],
 *   latest: full report row (data included) — the newest by period, or the one requested via id }
 */
router.get("/propreports/performance", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  const q = z.object({ trader: z.string().trim().max(120).optional(), account: z.string().trim().max(120).optional(), id: z.coerce.number().int().positive().optional() }).safeParse(req.query);
  if (!q.success) return badRequest(res, q);
  let trader = q.data.trader || null;
  if (!v.staff) {
    if (trader && trader !== v.name) { res.status(403).json({ error: "Можно смотреть только свои данные" }); return; }
    trader = v.name;
  }
  const reports = await listPerformanceReports({ trader, account: q.data.account || null });
  let latest = null;
  const wantId = q.data.id ?? reports[0]?.id;
  if (wantId) {
    const full = await getPerformanceReport(wantId);
    if (full && (v.staff || full.traderName === v.name)) latest = full;
  }
  res.json({ trader, reports, latest });
}));

router.get("/propreports/performance/:id", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Некорректный id" }); return; }
  const row = await getPerformanceReport(id);
  if (!row || (!v.staff && row.traderName !== v.name)) { res.status(404).json({ error: "Отчёт не найден" }); return; }
  res.json(row);
}));

router.delete("/propreports/performance/:id", requireAuth, asyncHandler(async (req, res) => {
  const v = await viewer(req);
  if (!(await requireCap(req, res, "propreports.sync", null, "Удаление доступно только куратору"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Некорректный id" }); return; }
  const ok = await deletePerformanceReport(id, v.name);
  if (!ok) { res.status(404).json({ error: "Отчёт не найден" }); return; }
  res.json({ ok: true });
}));

// Scheduled sync is opt-in: no-op unless PROPREPORTS_SYNC_MINUTES and the API env vars are set.
startScheduler();

export default router;
