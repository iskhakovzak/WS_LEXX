/**
 * Risk desk v2: per-trader limits (trader_risk_limits) + live usage computed from trades.
 *
 *   GET  /risk/me                 caller's limits, today/week/drawdown usage, stop state, alerts, P&L source
 *   GET  /risk/desk               curator/admin: one row per trader + desk banner (red-day stops)
 *   GET  /risk/limits/:trader     self or curator/admin
 *   PUT  /risk/limits/:trader     curator/admin only (zod, upsert, sets updated_by, writes limit change log); buyingPower
 *                                 (BP, per trader): junior 25 000 – 800 000 $, above junior no cap (BUYING_POWER_RANGE)
 *   GET  /risk/limits/:trader/history   limit change log
 *   GET  /risk/history            ?trader=&days=60 — daily net P&L, equity, drawdown, red-day streak
 *   GET  /risk/positions          ?trader= — open book with horizon / days held / $ at risk / exposure / sector / ATR
 *   GET  /risk/overnight          ?trader=&all=1 — overnight book (15:45 ET key): carried positions by trader,
 *                                 limits, sector/ATR from cache, Big7 catalysts in the holding window
 *   GET  /risk/alerts             ?trader=&days=14 — red-day stop / warn records (also mirrored to notifications)
 *   GET  /risk/check              ?riskUsd&exposureUsd&horizon&ticker — pre-trade check of a hypothetical position
 *
 * Risk processes (curator cabinet, additive):
 *   GET  /risk/templates          tiers as limit templates + per-trader drift from the template
 *   POST /risk/templates/apply    {items:[{trader,tierKey}], reason?} — apply a tier template (bulk), log + audit + notify
 *   GET  /risk/breaches           ?trader=&days=30 — breach records (risk_alert_log level=breach) with their «Разбор»
 *   POST /risk/breaches/:alertId/review      {reason, comment?, actions[], consequence} — upsert «Разбор нарушения»
 *   POST /risk/breach-reviews/:id/action     {actionId, status} — mark an agreed action done / dropped
 *   POST /risk/breach-reviews/:id/archive    soft delete of a review
 *   GET  /risk/summary            ?date= — daily risk summary for the curator (data only, nothing is sent)
 * Escalation: ≥70% → risk_warn (trader + staff); stop → risk_breach (trader + assigned staff, else every curator);
 * a 2nd breach day within 7 days → risk_repeat_breach to the head of desk (admins, else curators).
 *
 * Trading date = America/New_York (lib/tradingDate). `?date=YYYY-MM-DD` overrides for back-testing.
 * Intraday: while the PropReports positions tick keeps a fresh open-positions snapshot (lib/livePositions), its unrealized
 * P&L is added to today's realized net (lib/riskMetrics liveRisk) — every metric carries `live` (fetchedAt, ageMin,
 * counted). Alerts are queued through the outbox (lib/riskAlertQueue → lib/riskAlerts, kind `risk.alert`).
 * Data access: lib/riskData.
 * P&L source of truth: broker (PropReports) rows when a trader-day has any, else journal trades; each
 * number carries its `source`. Net = pnl − |fees| (lib/tradeMath), realised on COALESCE(exit_date, date).
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { nyDate, nyMinutes, addDays } from "../lib/tradingDate";
import { can, requireAnyCap, requireCap, resolveTraderParam } from "../lib/permissions";
import { notifyUser } from "../lib/notifyUtils";
import { notifLinks } from "../lib/notificationCore";
import { inBackground } from "../lib/notifyEvents";
import { haltedStopText, limitsDiff, limitsDiffItems, limitsDiffParams } from "../lib/notifyEventsCore";
import { logAudit } from "../lib/audit";
import { rowToBreachReview } from "../lib/curatorStore";
import {
  BREACH_CONSEQUENCE_KEYS, BREACH_REASON_KEYS, STAGE_TIER_KEYS,
  breachConsequences, breachReasons, breachStats, normalizeBreachActions, stageLabel, templateDiff, type LimitDiff,
} from "../lib/curatorLogic";
import { applyTierTemplate, loadTierTemplates } from "./scaling";
import { badRequest, errorMessage, forbidden, notFound, unauthorized } from "../lib/http";
import { langOf, type Lang } from "../i18n";
import { riskT } from "../i18n/ns";
import {
  computeMetrics, drawdownSince, liveRisk, nextPeak, num, pctOf, round2,
  type DayRow, type LiveRisk, type LiveSnapshot, type Limits, type Metrics, type Position,
} from "../lib/riskMetrics";
import { CLOSE_MINUTES, OVERNIGHT_KEY_MINUTES, YMD_RE, afterKeyTime, clientDate, loadDaily, loadDdResets, loadEffectiveLimits, loadLimits, loadLiveSnapshots, loadPositions, toLimits } from "../lib/riskData";
import { loadLivePositions } from "../lib/livePositions";
import { recordStopAlerts } from "../lib/riskAlertQueue";
import { buyingPowerProblem } from "../lib/people/stageLimits";
import { normalizeStageKey, stageOf } from "../lib/people/stage";
import { logInterventionSafe } from "../lib/interventions/log";

export { WARN_PCT, computeMetrics, computeStop, pctOf, round2, weekStart } from "../lib/riskMetrics";
export type { Alert, DayRow, Horizon, Limits, LiveRisk, Metrics, PnlSource, Position, Stop, StopState } from "../lib/riskMetrics";
export { OVERNIGHT_KEY_MINUTES, resolveDay, toPosition } from "../lib/riskData";

const router: IRouter = Router();

/** Live risk of one trader from a snapshot map (null without a snapshot of `today`). */
const liveOf = (snaps: Map<string, LiveSnapshot>, name: string, today: string): LiveRisk | null => liveRisk(snaps.get(name), today);

/** Desk-level freshness: the latest snapshot, how many traders are counted / stale, their open book. */
function liveSummary(lives: (LiveRisk | null)[]) {
  const xs = lives.filter((l): l is LiveRisk => l != null);
  if (!xs.length) return null;
  const counted = xs.filter((l) => l.counted);
  // One tick writes every account at once: the newest snapshot = when the positions step last ran.
  const newest = xs.reduce((a, b) => (a.fetchedAt > b.fetchedAt ? a : b));
  return {
    traders: xs.length,
    counted: counted.length,
    stale: xs.length - counted.length,
    openPositions: counted.reduce((s, l) => s + l.openPositions, 0),
    unrealizedUsd: round2(counted.reduce((s, l) => s + l.unrealizedUsd, 0)),
    fetchedAt: newest.fetchedAt,
    ageMin: newest.ageMin,
  };
}

/** Last N trading days cumulative net (or R when no $ data) for sparklines. */
function sparkline(days: DayRow[], n = 20): number[] {
  const hasPnl = days.some((d) => d.pnl != null);
  const vals = days.map((d) => (hasPnl ? d.pnl ?? 0 : d.r));
  let c = 0;
  const cum = vals.map((v) => (c += v));
  return cum.slice(-n).map(round2);
}

function groupBy<T extends { trader: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const arr = m.get(r.trader);
    if (arr) arr.push(r);
    else m.set(r.trader, [r]);
  }
  return m;
}

/** Staff accounts (admins, curators) may trade, but the desk counts traders only. */
const isStaffRole = (role: string | null | undefined): boolean => role === "admin" || role === "curator";

/** Desk roster: active traders + anyone with limits, open positions or recent trades — staff accounts excluded. */
function deskRoster(users: Map<string, { role: string }>, limitsMap: Map<string, unknown>, posBy: Map<string, unknown>, daysBy: Map<string, DayRow[]>, recentFrom: string): Set<string> {
  const names = new Set<string>();
  for (const [name, u] of users) if (u.role === "trader") names.add(name);
  for (const name of limitsMap.keys()) names.add(name);
  for (const name of posBy.keys()) names.add(name);
  for (const [name, rows] of daysBy) if (rows.some((d) => d.date >= recentFrom)) names.add(name);
  for (const name of [...names]) if (isStaffRole(users.get(name)?.role)) names.delete(name);
  return names;
}


// ─── routes ─────────────────────────────────────────────────────────────────

router.get("/risk/me", asyncHandler(async (req, res): Promise<void> => {
  const me = req.authUser?.name;
  if (!me) throw unauthorized();
  const today = clientDate(req.query.date);
  const [limitsMap, days, positions, resets, snaps] = await Promise.all([
    loadEffectiveLimits(me, today), loadDaily(me, today), loadPositions(me, today), loadDdResets(me), loadLiveSnapshots(today, [me]),
  ]);
  const limits = limitsMap.get(me) ?? null;
  const live = liveOf(snaps, me, today);
  const m = computeMetrics(me, days, positions, limits, today, langOf(req), drawdownSince(resets.get(me), today), live);
  void recordStopAlerts(m, limits, today);
  const book = live && live.openPositions > 0 ? await loadLivePositions(me, today) : null;
  res.json({
    ...m,
    limits,
    /** Broker open positions behind `live` (symbol, qty, avg, close, unrealized per account). */
    livePositions: book?.positions ?? [],
    today: { ...m.today, pnl: m.today.pnlNet, openRisk: m.today.openRiskUsd },
    afterClose: afterKeyTime(today),
    // Flat fields read by the dashboard limit bar / calculator / settings.
    dailyLossLimit: limits?.dailyLossLimit ?? null,
    todayPnl: m.today.pnlNet,
  });
}));

router.get("/risk/desk", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "risk.read.team"))) return;
  const today = clientDate(req.query.date);
  const [limitsMap, days, positions, usersRes, resets, snaps] = await Promise.all([
    loadEffectiveLimits(null, today),
    loadDaily(null, today),
    loadPositions(null, today),
    // ward = the viewer is the trader's curator / mentor / risk manager («Мои подопечные» on the desk).
    pool.query(`SELECT name, role, COALESCE(banned, false) AS banned, (assigned_curator = $1 OR assigned_mentor = $1 OR assigned_risk_manager = $1) AS ward
                  FROM users WHERE active = true`, [req.authUser!.name]),
    loadDdResets(null),
    loadLiveSnapshots(today),
  ]);
  const users = new Map<string, { role: string; banned: boolean; ward: boolean }>(
    usersRes.rows.map((u: any) => [String(u.name), { role: String(u.role), banned: !!u.banned, ward: u.ward === true }]),
  );
  const recentFrom = addDays(today, -60);
  const daysBy = groupBy(days);
  const posBy = groupBy(positions);

  const names = deskRoster(users, limitsMap, posBy, daysBy, recentFrom);

  const STATUS_ORDER = { breach: 0, warn: 1, ok: 2, no_limits: 3 } as const;
  const rows = [...names].map((name) => {
    const d = daysBy.get(name) ?? [];
    const m = computeMetrics(name, d, posBy.get(name) ?? [], limitsMap.get(name) ?? null, today, langOf(req), drawdownSince(resets.get(name), today), liveOf(snaps, name, today));
    void recordStopAlerts(m, limitsMap.get(name) ?? null, today);
    const last = d.length ? d[d.length - 1].date : null;
    return {
      ...m,
      role: users.get(name)?.role ?? null,
      banned: users.get(name)?.banned ?? false,
      ward: users.get(name)?.ward ?? false,
      limits: limitsMap.get(name) ?? null,
      spark: sparkline(d),
      sparkUnit: d.some((x) => x.pnl != null) ? "usd" : "r",
      lastTradeDate: last,
    };
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.today.pnlNet ?? 0) - (b.today.pnlNet ?? 0) || a.trader.localeCompare(b.trader));

  const sumNullable = (vals: (number | null)[]) => {
    const xs = vals.filter((v): v is number => v != null);
    return xs.length ? round2(xs.reduce((s, v) => s + v, 0)) : null;
  };
  const halted = rows.filter((r) => r.stop.halted);
  const warned = rows.filter((r) => r.stop.state === "warn");
  const sourceCounts = { propreports: rows.filter((r) => r.today.source === "propreports").length, journal: rows.filter((r) => r.today.source === "journal").length };

  res.json({
    date: today,
    nyMinutes: nyMinutes(),
    afterClose: afterKeyTime(today),
    summary: {
      traders: rows.length,
      wards: rows.filter((r) => r.ward).length,
      pnlNetToday: sumNullable(rows.map((r) => r.today.pnlNet)),
      pnlSource: sourceCounts.propreports && sourceCounts.journal ? "mixed" : sourceCounts.propreports ? "propreports" : sourceCounts.journal ? "journal" : null,
      rToday: round2(rows.reduce((s, r) => s + r.today.r, 0)),
      tradesToday: rows.reduce((s, r) => s + r.today.trades, 0),
      breach: rows.filter((r) => r.status === "breach").length,
      warn: rows.filter((r) => r.status === "warn").length,
      noLimits: rows.filter((r) => r.status === "no_limits").length,
      halted: halted.length,
      /** Distinct traders on a stop or with a breach today (a halted trader is usually also in breach — count once). */
      stopped: rows.filter((r) => r.stop.halted || r.status === "breach").length,
      nearStop: warned.length,
      openPositions: positions.length,
      carriedPositions: positions.filter((p) => p.carried).length,
      carriedTonight: positions.filter((p) => p.carriedTonight).length,
      openRiskUsd: round2(positions.reduce((s, p) => s + (p.riskUsd ?? 0), 0)),
      overnightExposureUsd: round2(positions.filter((p) => p.carriedTonight).reduce((s, p) => s + (p.exposureUsd ?? 0), 0)),
    },
    /** PropReports positions snapshot freshness over the desk (null = no snapshot today). */
    live: liveSummary(rows.map((r) => r.live)),
    /** Desk banner: who is stopped / close to a stop, with exact numbers. */
    banner: [...halted, ...warned].map((r) => ({ trader: r.trader, state: r.stop.state, label: r.stop.label, message: r.stop.message, halted: r.stop.halted })),
    traders: rows,
  });
}));

router.get("/risk/limits/:trader", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) throw unauthorized();
  const trader = String(req.params.trader ?? "").trim();
  if (!trader || trader.length > 100) throw badRequest("INVALID_TRADER");
  if (trader !== req.authUser.name && !(await can(req, "risk.read.team", { trader }))) {
    throw forbidden();
  }
  const map = await loadLimits(trader);
  res.json(map.get(trader) ?? null);
}));

router.get("/risk/limits/:trader/history", asyncHandler(async (req, res): Promise<void> => {
  if (!req.authUser) throw unauthorized();
  const trader = String(req.params.trader ?? "").trim();
  if (!trader || trader.length > 100) throw badRequest("INVALID_TRADER");
  if (trader !== req.authUser.name && !(await can(req, "risk.read.team", { trader }))) throw forbidden();
  const { rows } = await pool.query(
    `SELECT id, trader, before, after, reason, changed_by, changed_at FROM trader_risk_limit_events WHERE trader = $1 ORDER BY changed_at DESC LIMIT 50`,
    [trader],
  );
  res.json(rows.map((r: any) => ({
    id: Number(r.id),
    trader: String(r.trader),
    before: r.before ?? null,
    after: r.after,
    reason: r.reason ?? null,
    changedBy: r.changed_by ?? null,
    changedAt: new Date(r.changed_at).toISOString(),
  })));
}));

const money = z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/).transform(Number)])
  .pipe(z.number().finite().min(0).max(1e12))
  .nullable()
  .optional();

const LimitsBody = z.object({
  accountSize: money,
  dailyLossLimit: money,
  weeklyLossLimit: money,
  maxDrawdown: money,
  maxRiskPerTrade: money,
  maxPositionUsd: money,
  maxOvernightExposure: money,
  maxOpenPositions: z.number().int().min(0).max(1000).nullable().optional(),
  allowOvernight: z.boolean().optional(),
  allowSwing: z.boolean().optional(),
  /** Buying power; absent = keep the stored value, null = clear. */
  buyingPower: money,
  tier: z.string().trim().max(40).nullable().optional().transform((v) => (v ? v : null)),
  notes: z.string().max(2000).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  /** Why the limits changed — stored in the change log (not in trader_risk_limits). */
  reason: z.string().max(500).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
}).strict();

router.put("/risk/limits/:trader", asyncHandler(async (req, res): Promise<void> => {
  const trader = String(req.params.trader ?? "").trim();
  if (!trader || trader.length > 100) throw badRequest("INVALID_TRADER");
  if (!(await requireCap(req, res, "risk.limits.edit", { trader }))) return;
  const parsed = LimitsBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const { rows: exists } = await pool.query(`SELECT 1 FROM users WHERE name = $1 LIMIT 1`, [trader]);
  if (!exists.length) throw notFound("TRADER_NOT_FOUND");

  const before = (await loadLimits(trader)).get(trader) ?? null;
  const b = parsed.data;
  const hasBp = b.buyingPower !== undefined;
  if (hasBp) {
    const problem = buyingPowerProblem(b.buyingPower, normalizeStageKey(b.tier) ?? (await stageOf(trader)));
    const usd = (n: number) => `$${n.toLocaleString("en-US")}`; // money is preformatted (same in every language)
    if (problem) throw problem.max == null ? badRequest("BUYING_POWER_MIN", undefined, { min: usd(problem.min) }) : badRequest("BUYING_POWER_RANGE", undefined, { min: usd(problem.min), max: usd(problem.max) });
  }
  const { rows } = await pool.query(
    `INSERT INTO trader_risk_limits AS l (
       trader, account_size, daily_loss_limit, weekly_loss_limit, max_drawdown, max_risk_per_trade,
       max_position_usd, max_overnight_exposure, max_open_positions, allow_overnight, allow_swing,
       tier, notes, updated_by, updated_at, buying_power)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, TRUE),COALESCE($11, TRUE),$12,$13,$14,NOW(),$15)
     ON CONFLICT (trader) DO UPDATE SET
       account_size = EXCLUDED.account_size,
       daily_loss_limit = EXCLUDED.daily_loss_limit,
       weekly_loss_limit = EXCLUDED.weekly_loss_limit,
       max_drawdown = EXCLUDED.max_drawdown,
       max_risk_per_trade = EXCLUDED.max_risk_per_trade,
       max_position_usd = EXCLUDED.max_position_usd,
       max_overnight_exposure = EXCLUDED.max_overnight_exposure,
       max_open_positions = EXCLUDED.max_open_positions,
       allow_overnight = COALESCE($10, l.allow_overnight),
       allow_swing = COALESCE($11, l.allow_swing),
       tier = EXCLUDED.tier,
       notes = EXCLUDED.notes,
       buying_power = CASE WHEN $16::boolean THEN EXCLUDED.buying_power ELSE l.buying_power END,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      trader,
      b.accountSize ?? null,
      b.dailyLossLimit ?? null,
      b.weeklyLossLimit ?? null,
      b.maxDrawdown ?? null,
      b.maxRiskPerTrade ?? null,
      b.maxPositionUsd ?? null,
      b.maxOvernightExposure ?? null,
      b.maxOpenPositions ?? null,
      b.allowOvernight ?? null,
      b.allowSwing ?? null,
      b.tier ?? null,
      b.notes ?? null,
      req.authUser!.name,
      b.buyingPower ?? null,
      hasBp,
    ],
  );
  const after = toLimits(rows[0]);
  // Change log (best-effort; the limits are already saved).
  try {
    const strip = (l: Limits | null) => {
      if (!l) return null;
      const copy: Partial<Limits> = { ...l };
      delete copy.updatedBy;
      delete copy.updatedAt;
      return copy;
    };
    const ev = await pool.query(
      `INSERT INTO trader_risk_limit_events (trader, before, after, reason, changed_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [trader, before ? JSON.stringify(strip(before)) : null, JSON.stringify(strip(after)), b.reason ?? null, req.authUser!.name],
    );
    await logInterventionSafe({ trader, kind: "limit_change", author: req.authUser!.name, params: { variant: "manual" }, sourceTable: "trader_risk_limit_events", sourceId: ev.rows[0].id });
  } catch { /* ignore */ }
  const actor = req.authUser!.name;
  if (actor !== trader) {
    inBackground("risk.limits.change", async () => {
      const diff = limitsDiff(before, after);
      if (!diff.length && !b.reason) return; // nothing the trader would notice
      await notifyUser({
        userName: trader, type: "limit_change", actor, source: "risk",
        params: { variant: "manual", actor, ...(b.reason ? { reason: b.reason.slice(0, 200) } : {}), ...limitsDiffParams(before, after) },
        link: notifLinks.risk(trader), entityType: "risk_limits", entityId: trader,
      });
    });
  }
  res.json(after);
}));

/** Resolve ?trader= for self-or-team endpoints (risk.read.team). null trader = whole desk (desk scope only). */
/** Throws 400 / 401 / 403 AppErrors. */
async function resolveTraderScope(req: Request, allowAll: boolean): Promise<{ ok: true; trader: string | null }> {
  const raw = typeof req.query.trader === "string" ? req.query.trader.trim() : "";
  if (raw.length > 100) throw badRequest("INVALID_TRADER");
  const scope = await resolveTraderParam(req, "risk.read.team", raw, { allowAll });
  if (!scope.ok) throw scope.appError;
  return { ok: true, trader: scope.trader };
}

router.get("/risk/history", asyncHandler(async (req, res): Promise<void> => {
  const scope = await resolveTraderScope(req, false);
  const trader = scope.trader!;
  const today = clientDate(req.query.date);
  const daysParam = Number(req.query.days ?? 60);
  const span = Number.isFinite(daysParam) ? Math.min(730, Math.max(5, Math.round(daysParam))) : 60;
  const from = addDays(today, -(span - 1));

  const [days, limitsMap, resets] = await Promise.all([loadDaily(trader, today), loadLimits(trader), loadDdResets(trader)]);
  const limits = limitsMap.get(trader) ?? null;
  const hasPnl = days.some((d) => d.pnl != null);
  // Same baseline as the stop: after a curator review of a drawdown breach the drawdown line restarts from that day.
  const ddSince = drawdownSince(resets.get(trader), today);

  let cum = 0, peak = 0, cumR = 0, peakR = 0;
  const all = days.map((d) => {
    cumR += d.r;
    peakR = nextPeak(peakR, cumR, d.date, ddSince);
    if (d.pnl != null) {
      cum += d.pnl;
      peak = nextPeak(peak, cum, d.date, ddSince);
    }
    return {
      date: d.date,
      pnl: d.pnl == null ? null : round2(d.pnl),
      source: d.source,
      trades: d.trades,
      r: round2(d.r),
      fees: round2(d.fees),
      cum: round2(cum),
      equity: limits?.accountSize != null ? round2(limits.accountSize + cum) : null,
      drawdown: round2(cum - peak),
      cumR: round2(cumR),
      drawdownR: round2(cumR - peakR),
    };
  });
  const points = all.filter((p) => p.date >= from);

  let redStreak = 0, worstRedStreak = 0, run = 0;
  for (const p of points) {
    const v = hasPnl ? p.pnl : p.r;
    if (v == null) continue;
    if (v < 0) { run++; worstRedStreak = Math.max(worstRedStreak, run); } else run = 0;
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const v = hasPnl ? points[i].pnl : points[i].r;
    if (v == null) continue;
    if (v < 0) redStreak++; else break;
  }
  const valued = points.map((p) => (hasPnl ? p.pnl : p.r)).filter((v): v is number => v != null);
  const green = valued.filter((v) => v > 0).length;
  const red = valued.filter((v) => v < 0).length;

  res.json({
    trader,
    from,
    to: today,
    unit: hasPnl ? "usd" : "r",
    limits,
    ddSince,
    points,
    sources: { propreports: points.filter((p) => p.source === "propreports").length, journal: points.filter((p) => p.source === "journal").length },
    stats: {
      days: points.length,
      greenDays: green,
      redDays: red,
      redDayStreak: redStreak,
      worstRedStreak,
      bestDay: valued.length ? Math.max(...valued) : null,
      worstDay: valued.length ? Math.min(...valued) : null,
      maxDrawdown: points.length ? Math.min(0, ...points.map((p) => (hasPnl ? p.drawdown : p.drawdownR))) : 0,
      currentDrawdown: points.length ? (hasPnl ? points[points.length - 1].drawdown : points[points.length - 1].drawdownR) : 0,
    },
  });
}));

function positionTotals(positions: Position[]) {
  return {
    count: positions.length,
    carried: positions.filter((p) => p.carried).length,
    carriedTonight: positions.filter((p) => p.carriedTonight).length,
    riskUsd: round2(positions.reduce((s, p) => s + (p.riskUsd ?? 0), 0)),
    exposureUsd: round2(positions.reduce((s, p) => s + (p.exposureUsd ?? 0), 0)),
    overnightExposureUsd: round2(positions.filter((p) => p.carriedTonight).reduce((s, p) => s + (p.exposureUsd ?? 0), 0)),
  };
}

router.get("/risk/positions", asyncHandler(async (req, res): Promise<void> => {
  const scope = await resolveTraderScope(req, true);
  const today = clientDate(req.query.date);
  const positions = await loadPositions(scope.trader, today);
  res.json({
    date: today,
    trader: scope.trader,
    afterClose: afterKeyTime(today),
    positions,
    totals: positionTotals(positions),
  });
}));

/**
 * Overnight book: what the desk carries through the close. Before 15:45 ET only positions already carried
 * (overnight/swing or opened on an earlier day) are in the book; after 15:45 every open position is.
 * `?all=1` previews the book as if the key time had passed.
 */
router.get("/risk/overnight", asyncHandler(async (req, res): Promise<void> => {
  const scope = await resolveTraderScope(req, true);
  const today = clientDate(req.query.date);
  const preview = req.query.all === "1" || req.query.all === "true";
  const [positions, limitsMap, days, resets, snaps] = await Promise.all([
    loadPositions(scope.trader, today),
    loadLimits(scope.trader),
    loadDaily(scope.trader, today),
    loadDdResets(scope.trader),
    loadLiveSnapshots(today, scope.trader ? [scope.trader] : null),
  ]);
  const afterKey = afterKeyTime(today);
  const book = positions.filter((p) => p.carriedTonight || preview);
  const tickers = [...new Set(book.map((p) => p.ticker.toUpperCase()).filter(Boolean))];

  // Big7 / manual catalysts inside the next 10 calendar days (earnings & offerings are merged client-side).
  const horizonEnd = addDays(today, 10);
  const { rows: cats } = tickers.length
    ? await pool.query(
        `SELECT ticker, date, type, description, impact FROM big7_catalysts WHERE UPPER(ticker) = ANY($1) AND date >= $2 AND date <= $3 ORDER BY date ASC`,
        [tickers, today, horizonEnd],
      ).catch(() => ({ rows: [] as any[] }))
    : { rows: [] as any[] };
  const catalysts: Record<string, { date: string; type: string; description: string | null; impact: string }[]> = {};
  for (const c of cats) {
    const t = String(c.ticker).toUpperCase();
    (catalysts[t] ??= []).push({ date: String(c.date), type: String(c.type), description: c.description ?? null, impact: String(c.impact ?? "medium") });
  }

  const daysBy = groupBy(days);
  const posBy = groupBy(positions);
  const traders = [...new Set([...book.map((p) => p.trader)])].sort((a, b) => a.localeCompare(b)).map((name) => {
    const L = limitsMap.get(name) ?? null;
    const m = computeMetrics(name, daysBy.get(name) ?? [], posBy.get(name) ?? [], L, today, langOf(req), drawdownSince(resets.get(name), today), liveOf(snaps, name, today));
    const mine = book.filter((p) => p.trader === name);
    const exposure = round2(mine.reduce((s, p) => s + (p.exposureUsd ?? 0), 0));
    return {
      trader: name,
      limits: L,
      positions: mine.map((p) => p.id),
      exposureUsd: exposure,
      riskUsd: round2(mine.reduce((s, p) => s + (p.riskUsd ?? 0), 0)),
      pctOfMaxOvernight: pctOf(exposure, L?.maxOvernightExposure ?? null),
      overnightAllowed: L ? L.allowOvernight : null,
      swingAllowed: L ? L.allowSwing : null,
      stop: m.stop,
      todayPnlNet: m.today.pnlNet,
      todaySource: m.today.source,
      dailyRemainingUsd: m.today.dailyRemainingUsd,
    };
  });

  const now = new Date();
  const nowMin = nyMinutes(now);
  res.json({
    date: today,
    trader: scope.trader,
    keyTime: "15:45",
    nyMinutes: nowMin,
    afterKey,
    preview,
    minutesToKey: today === nyDate(now) ? Math.max(0, OVERNIGHT_KEY_MINUTES - nowMin) : null,
    minutesToClose: today === nyDate(now) ? Math.max(0, CLOSE_MINUTES - nowMin) : null,
    positions: book,
    catalysts,
    traders,
    totals: positionTotals(book),
  });
}));

router.get("/risk/alerts", asyncHandler(async (req, res): Promise<void> => {
  const scope = await resolveTraderScope(req, true);
  const daysRaw = Number(req.query.days ?? 14);
  const span = Number.isFinite(daysRaw) ? Math.min(180, Math.max(1, Math.round(daysRaw))) : 14;
  const from = addDays(nyDate(), -(span - 1));
  const { rows } = await pool.query(
    `SELECT id, trader, date, kind, level, used::float AS used, "limit"::float AS "limit", message, created_at
     FROM risk_alert_log WHERE ($1::text IS NULL OR trader = $1) AND date >= $2 AND level IN ('warn', 'breach')
     ORDER BY created_at DESC LIMIT 200`,
    [scope.trader, from],
  );
  res.json({
    from,
    trader: scope.trader,
    alerts: rows.map((r: any) => ({
      id: Number(r.id), trader: String(r.trader), date: String(r.date), kind: String(r.kind), level: String(r.level),
      used: num(r.used), limit: num(r.limit), message: alertMessage(r, langOf(req)), createdAt: new Date(r.created_at).toISOString(),
    })),
  });
}));

// ─── desk snapshot (shared with routes/curator.ts) ──────────────────────────

export type DeskSnapshotRow = {
  trader: string;
  role: string | null;
  banned: boolean;
  metrics: Metrics;
  limits: Limits | null;
  days: DayRow[];
  lastTradeDate: string | null;
};

/**
 * Same roster and metrics as GET /risk/desk (active traders + anyone with limits, open positions or trades in the
 * last 60 days), as data for other endpoints. `trader` narrows to one person. Records stop alerts like /risk/desk.
 */
/** `only` = rows for just these traders (the curator's roster) — the same rows the full snapshot has for them. */
export async function deskSnapshot(today: string, trader: string | null = null, lang: Lang = "ru", only?: readonly string[]): Promise<{ rows: DeskSnapshotRow[]; positions: Position[] }> {
  const [limitsMap, days, positions, usersRes, resets, snaps] = await Promise.all([
    loadEffectiveLimits(trader, today),
    loadDaily(trader, today, only),
    loadPositions(trader, today),
    pool.query(`SELECT name, role, COALESCE(banned, false) AS banned FROM users WHERE active = true AND ($1::text IS NULL OR name = $1)`, [trader]),
    loadDdResets(trader, only),
    loadLiveSnapshots(today, trader ? [trader] : only ?? null),
  ]);
  const users = new Map<string, { role: string; banned: boolean; ward: boolean }>(
    usersRes.rows.map((u: any) => [String(u.name), { role: String(u.role), banned: !!u.banned, ward: u.ward === true }]),
  );
  const recentFrom = addDays(today, -60);
  const daysBy = groupBy(days);
  const posBy = groupBy(positions);
  const names = deskRoster(users, limitsMap, posBy, daysBy, recentFrom);
  if (trader) names.add(trader);
  const keep = only ? new Set(only) : null;
  const rows = [...names].filter((name) => !keep || keep.has(name)).map((name) => {
    const d = daysBy.get(name) ?? [];
    const limits = limitsMap.get(name) ?? null;
    const m = computeMetrics(name, d, posBy.get(name) ?? [], limits, today, lang, drawdownSince(resets.get(name), today), liveOf(snaps, name, today));
    void recordStopAlerts(m, limits, today);
    return { trader: name, role: users.get(name)?.role ?? null, banned: users.get(name)?.banned ?? false, metrics: m, limits, days: d, lastTradeDate: d.length ? d[d.length - 1].date : null };
  }).sort((a, b) => a.trader.localeCompare(b.trader, "ru"));
  return { rows, positions };
}

// ─── limit templates by tier ────────────────────────────────────────────────

const limitFieldsOf = (l: Limits | null) => (l ? {
  accountSize: l.accountSize, dailyLossLimit: l.dailyLossLimit, weeklyLossLimit: l.weeklyLossLimit, maxDrawdown: l.maxDrawdown,
  maxRiskPerTrade: l.maxRiskPerTrade, maxPositionUsd: l.maxPositionUsd, maxOvernightExposure: l.maxOvernightExposure,
  maxOpenPositions: l.maxOpenPositions, allowOvernight: l.allowOvernight, allowSwing: l.allowSwing,
} : null);

export type TemplateStatus = { tier: string | null; tierName: string | null; hasLimits: boolean; drift: LimitDiff[] };

/** Per-trader template status: tier, drift from the tier template (empty = matches), or no limits at all. */
export async function templateStatus(traders: string[], lang: Lang = "ru"): Promise<Map<string, TemplateStatus>> {
  const [tiers, limitsMap] = await Promise.all([loadTierTemplates().catch(() => [] as Awaited<ReturnType<typeof loadTierTemplates>>), loadLimits(null)]);
  const out = new Map<string, TemplateStatus>();
  for (const name of traders) {
    const l = limitsMap.get(name) ?? null;
    const tier = l?.tier ? tiers.find((t) => t.key === l.tier) ?? null : null;
    out.set(name, {
      tier: l?.tier ?? null,
      tierName: tier?.name ?? (l?.tier ? stageLabel(l.tier, lang) ?? l.tier : null),
      hasLimits: !!l && (l.dailyLossLimit != null || l.weeklyLossLimit != null || l.maxDrawdown != null),
      drift: tier ? templateDiff(limitFieldsOf(l), tier, lang) : [],
    });
  }
  return out;
}

router.get("/risk/templates", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "risk.read.team"))) return;
  const tiers = await loadTierTemplates();
  const { rows: users } = await pool.query<{ name: string; role: string }>(
    `SELECT name, role FROM users WHERE active = true AND COALESCE(banned, false) = false ORDER BY name`,
  );
  const limitsMap = await loadLimits(null);
  const staff = new Set(users.filter((u) => isStaffRole(u.role)).map((u) => u.name));
  const names = [...new Set([...users.filter((u) => u.role === "trader").map((u) => u.name), ...limitsMap.keys()])]
    .filter((n) => !staff.has(n)).sort((a, b) => a.localeCompare(b, "ru"));
  const status = await templateStatus(names);
  res.json({
    tiers: tiers.map((t) => ({ ...t, stage: (STAGE_TIER_KEYS as readonly string[]).includes(t.key) ? t.key : null, stageLabel: stageLabel(t.key, langOf(req)) ?? null })),
    traders: names.map((name) => ({ trader: name, limits: limitsMap.get(name) ?? null, ...status.get(name)! })),
    canEdit: await can(req, "risk.limits.edit"),
  });
}));

const ApplyTemplateBody = z.object({
  items: z.array(z.object({ trader: z.string().trim().min(1).max(100), tierKey: z.string().trim().min(1).max(40) }).strict()).min(1).max(50),
  reason: z.string().max(500).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
}).strict();

const stripMeta = (l: Limits | null) => {
  if (!l) return null;
  const copy: Partial<Limits> = { ...l };
  delete copy.updatedBy;
  delete copy.updatedAt;
  return copy;
};

router.post("/risk/templates/apply", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "risk.limits.edit"))) return;
  const parsed = ApplyTemplateBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const actor = req.authUser!.name;
  const lang = langOf(req);
  const { items, reason } = parsed.data;
  const results: { trader: string; ok: boolean; error?: string; code?: string; tier?: string; fromTier?: string | null; resync?: boolean; changes?: string[] }[] = [];
  for (const it of items) {
    if (!(await can(req, "risk.limits.edit", { trader: it.trader }))) { results.push({ trader: it.trader, ok: false, error: errorMessage("FORBIDDEN", lang), code: "FORBIDDEN" }); continue; }
    const { rows: exists } = await pool.query(`SELECT 1 FROM users WHERE name = $1 LIMIT 1`, [it.trader]);
    if (!exists.length) { results.push({ trader: it.trader, ok: false, error: errorMessage("TRADER_NOT_FOUND", lang), code: "TRADER_NOT_FOUND" }); continue; }
    const before = (await loadLimits(it.trader)).get(it.trader) ?? null;
    const applied = await applyTierTemplate(it.trader, it.tierKey, actor, reason, lang);
    if (!applied.ok) { results.push({ trader: it.trader, ok: false, error: applied.error }); continue; }
    const after = (await loadLimits(it.trader)).get(it.trader) ?? null;
    const changes = limitsDiff(before, after, lang);
    // Stored change-log reason: written in the curator's language (staff read the history).
    const tl = riskT.tFor(lang);
    const logHead = `${tl("template.logReason", { tier: applied.tier.name })}${applied.resync ? tl("template.logResync") : ""}`;
    const logReason = reason ? tl("template.logWithReason", { text: logHead, reason }) : logHead;
    try {
      const ev = await pool.query(
        `INSERT INTO trader_risk_limit_events (trader, before, after, reason, changed_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [it.trader, before ? JSON.stringify(stripMeta(before)) : null, JSON.stringify(stripMeta(after)), logReason, actor],
      );
      await logInterventionSafe({ trader: it.trader, kind: "limit_change", author: actor, params: { variant: "template", tier: applied.tier.key }, sourceTable: "trader_risk_limit_events", sourceId: ev.rows[0].id });
    } catch { /* change log is best-effort */ }
    await logAudit({
      actor, action: "risk.limits.template", targetType: "trader_risk_limits", targetId: it.trader,
      details: { tierKey: applied.tier.key, fromTier: applied.fromTier, resync: applied.resync, historyId: applied.historyId, changes: limitsDiffItems(before, after), reason },
    });
    if (actor !== it.trader && (changes.length || !applied.resync)) {
      const trader = it.trader;
      const tierLabel = applied.tier.name;
      const resync = applied.resync;
      const diffParams = limitsDiffParams(before, after);
      inBackground("risk.limits.template", () => notifyUser({
        userName: trader, type: "limit_change", actor, source: "risk",
        params: { variant: "template", actor, tier: tierLabel, tierKey: applied.tier.key, resync: resync ? 1 : 0, ...(reason ? { reason: reason.slice(0, 200) } : {}), ...diffParams },
        link: notifLinks.risk(trader), entityType: "risk_limits", entityId: trader,
      }));
    }
    results.push({ trader: it.trader, ok: true, tier: applied.tier.key, fromTier: applied.fromTier, resync: applied.resync, changes });
  }
  const okCount = results.filter((r) => r.ok).length;
  res.status(okCount ? 200 : 400).json({ applied: okCount, failed: results.length - okCount, results, error: okCount ? undefined : results[0]?.error });
}));

// ─── «Разбор нарушения» ─────────────────────────────────────────────────────

/** Breach kind label in `lang` (risk namespace `breachKind.*`); unknown kinds pass through. */
export function breachKindLabel(kind: string, lang: Lang = "ru"): string {
  return riskT.tryFor(lang, `breachKind.${kind}`) ?? kind;
}
/** RU labels (kept for older imports). */
export const BREACH_KIND_LABELS: Record<string, string> = { stop: breachKindLabel("stop"), weekly: breachKindLabel("weekly"), drawdown: breachKindLabel("drawdown") };

/**
 * A stored alert's text in the reader's language: halted kinds (stop / weekly / drawdown) are rebuilt from kind / used /
 * limit in every language — RU too, so older rows («318.76$») read in today's money format ($318.76); other kinds keep
 * the stored RU text.
 */
export function alertMessage(r: { kind: unknown; used: unknown; limit: unknown; message: unknown }, lang: Lang): string {
  const used = num(r.used);
  const limit = num(r.limit);
  const text = used != null && limit != null ? haltedStopText(String(r.kind), used, limit, lang) : null;
  return text ? text.message : String(r.message ?? "");
}

async function canReviewBreach(req: Request, trader: string | null): Promise<boolean> {
  const target = trader ? { trader } : undefined;
  return (await can(req, "risk.limits.edit", target)) || (await can(req, "journal.review", target));
}

router.get("/risk/breaches", asyncHandler(async (req, res): Promise<void> => {
  const scope = await resolveTraderScope(req, true);
  const daysRaw = Number(req.query.days ?? 30);
  const span = Number.isFinite(daysRaw) ? Math.min(365, Math.max(1, Math.round(daysRaw))) : 30;
  const today = nyDate();
  const from = addDays(today, -(span - 1));
  const { rows } = await pool.query(
    `SELECT a.id, a.trader, a.date, a.kind, a.level, a.used::float AS used, a."limit"::float AS "limit", a.message, a.created_at,
            CASE WHEN r.id IS NULL THEN NULL ELSE row_to_json(r.*) END AS review
       FROM risk_alert_log a
       LEFT JOIN risk_breach_reviews r ON r.alert_id = a.id AND r.archived_at IS NULL
      WHERE a.level = 'breach' AND ($1::text IS NULL OR a.trader = $1) AND a.date >= $2
      ORDER BY a.date DESC, a.created_at DESC LIMIT 300`,
    [scope.trader, from],
  );
  const byTrader = new Map<string, string[]>();
  for (const r of rows) byTrader.set(String(r.trader), [...(byTrader.get(String(r.trader)) ?? []), String(r.date)]);
  const lang = langOf(req);
  const breaches = rows.map((r: any) => {
    const st = breachStats(byTrader.get(String(r.trader)) ?? [], String(r.date));
    return {
      id: Number(r.id), trader: String(r.trader), date: String(r.date), kind: String(r.kind), kindLabel: breachKindLabel(String(r.kind), lang),
      used: num(r.used), limit: num(r.limit), message: alertMessage(r, lang), createdAt: new Date(r.created_at).toISOString(),
      repeat: st.repeat, breachDays7: st.days7,
      review: r.review ? rowToBreachReview(r.review) : null,
    };
  });
  res.json({
    from, to: today, trader: scope.trader,
    breaches,
    unreviewed: breaches.filter((b) => !b.review).length,
    reasons: breachReasons(lang), consequences: breachConsequences(lang),
    canReview: await canReviewBreach(req, scope.trader),
  });
}));

const ReviewBody = z.object({
  reason: z.enum(BREACH_REASON_KEYS),
  comment: z.string().max(4000).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  actions: z.array(z.object({
    id: z.string().max(40).optional(),
    title: z.string().max(300),
    dueOn: z.string().regex(YMD_RE).nullable().optional(),
    status: z.enum(["open", "done", "dropped"]).optional(),
  }).strict()).max(10).default([]),
  consequence: z.enum(BREACH_CONSEQUENCE_KEYS).default("none"),
}).strict();

router.post("/risk/breaches/:alertId/review", asyncHandler(async (req, res): Promise<void> => {
  const alertId = Number(req.params.alertId);
  if (!Number.isInteger(alertId) || alertId <= 0) throw badRequest("INVALID_ID");
  const { rows: al } = await pool.query(`SELECT id, trader, date, kind, level, message FROM risk_alert_log WHERE id = $1`, [alertId]);
  const alert = al[0];
  if (!alert) throw notFound("BREACH_NOT_FOUND");
  const trader = String(alert.trader);
  if (!(await requireAnyCap(req, res, ["risk.limits.edit", "journal.review"], { trader }))) return;
  const parsed = ReviewBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const b = parsed.data;
  const actor = req.authUser!.name;
  const actions = normalizeBreachActions(b.actions);
  const { rows } = await pool.query(
    `INSERT INTO risk_breach_reviews (alert_id, trader, date, kind, reason, comment, actions, consequence, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9)
     ON CONFLICT (alert_id) DO UPDATE SET
       reason = EXCLUDED.reason, comment = EXCLUDED.comment, actions = EXCLUDED.actions, consequence = EXCLUDED.consequence,
       updated_by = EXCLUDED.updated_by, updated_at = NOW(), archived_at = NULL, archived_by = NULL
     RETURNING *, (xmax = 0) AS inserted`,
    [alertId, trader, String(alert.date), String(alert.kind), b.reason, b.comment, JSON.stringify(actions), b.consequence, actor],
  );
  const review = rowToBreachReview(rows[0]);
  const created = rows[0].inserted === true;
  await logAudit({ actor, action: created ? "risk.breach.review" : "risk.breach.review.update", targetType: "risk_alert_log", targetId: String(alertId), details: { trader, reason: b.reason, consequence: b.consequence, actions: actions.length } });
  if (created && actor !== trader) {
    const date = String(alert.date);
    const agreed = actions.length ? actions.map((a) => a.title).join("; ").slice(0, 300) : null;
    inBackground("risk.breach.review", () => notifyUser({
      userName: trader, type: "risk_breach_review", actor, source: "risk",
      // A drawdown review restarts the drawdown count from today (lib/riskMetrics) — the trader is told so.
      params: { actor, date, reasonCode: b.reason, consequenceCode: b.consequence, actions: agreed, ...(String(alert.kind) === "drawdown" ? { ddReset: 1 } : {}) },
      link: `/risk?tab=breaches&alert=${alertId}`, entityType: "risk_breach", entityId: String(alertId),
    }));
  }
  res.status(created ? 201 : 200).json(review);
}));

const ActionStatusBody = z.object({ actionId: z.string().min(1).max(40), status: z.enum(["open", "done", "dropped"]) }).strict();

router.post("/risk/breach-reviews/:id/action", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  const { rows: ex } = await pool.query(`SELECT * FROM risk_breach_reviews WHERE id = $1 AND archived_at IS NULL`, [id]);
  if (!ex[0]) throw notFound("BREACH_REVIEW_NOT_FOUND");
  if (!(await requireAnyCap(req, res, ["risk.limits.edit", "journal.review"], { trader: String(ex[0].trader) }))) return;
  const parsed = ActionStatusBody.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest("VALIDATION");
  const actions = (Array.isArray(ex[0].actions) ? ex[0].actions : []) as { id: string; status: string }[];
  if (!actions.some((a) => a.id === parsed.data.actionId)) throw notFound("AGREEMENT_NOT_FOUND");
  const next = actions.map((a) => (a.id === parsed.data.actionId ? { ...a, status: parsed.data.status } : a));
  const { rows } = await pool.query(
    `UPDATE risk_breach_reviews SET actions = $2::jsonb, updated_by = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(next), req.authUser!.name],
  );
  res.json(rowToBreachReview(rows[0]));
}));

router.post("/risk/breach-reviews/:id/archive", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  const { rows: ex } = await pool.query(`SELECT trader FROM risk_breach_reviews WHERE id = $1 AND archived_at IS NULL`, [id]);
  if (!ex[0]) throw notFound("BREACH_REVIEW_NOT_FOUND");
  if (!(await requireAnyCap(req, res, ["risk.limits.edit", "journal.review"], { trader: String(ex[0].trader) }))) return;
  await pool.query(`UPDATE risk_breach_reviews SET archived_at = NOW(), archived_by = $2 WHERE id = $1`, [id, req.authUser!.name]);
  await logAudit({ actor: req.authUser!.name, action: "risk.breach.review.archive", targetType: "risk_breach_reviews", targetId: String(id), details: { trader: ex[0].trader } });
  res.json({ ok: true });
}));

// ─── daily risk summary for the curator (data only) ─────────────────────────

router.get("/risk/summary", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "risk.read.team"))) return;
  const today = clientDate(req.query.date);
  const lang = langOf(req);
  const { rows, positions } = await deskSnapshot(today, null, lang);
  const from7 = addDays(today, -6);
  const from14 = addDays(today, -13);
  const [breachRes, unreviewedRes] = await Promise.all([
    pool.query(`SELECT trader, date, kind FROM risk_alert_log WHERE level = 'breach' AND date BETWEEN $1 AND $2`, [from7, today]),
    pool.query(
      `SELECT a.id, a.trader, a.date, a.kind, a.message FROM risk_alert_log a
         LEFT JOIN risk_breach_reviews r ON r.alert_id = a.id AND r.archived_at IS NULL
        WHERE a.level = 'breach' AND a.date >= $1 AND r.id IS NULL ORDER BY a.date DESC`,
      [from14],
    ),
  ]);
  const breachDates = new Map<string, string[]>();
  for (const r of breachRes.rows) breachDates.set(String(r.trader), [...(breachDates.get(String(r.trader)) ?? []), String(r.date)]);
  const tpl = await templateStatus(rows.map((r) => r.trader), lang);
  const active = rows.filter((r) => r.role === "trader" || r.limits || r.metrics.today.trades > 0 || r.metrics.today.openPositions > 0);
  const pnlVals = active.map((r) => r.metrics.today.pnlNet).filter((v): v is number => v != null);
  const brief = (r: DeskSnapshotRow) => ({
    trader: r.trader, state: r.metrics.stop.state, label: r.metrics.stop.label, message: r.metrics.stop.message,
    pnlNet: r.metrics.today.pnlNet, dailyPct: r.metrics.stop.dailyPct, weeklyPct: r.metrics.stop.weeklyPct, drawdownPct: r.metrics.stop.drawdownPct,
  });
  const kindLabel = (k: unknown) => breachKindLabel(String(k), lang);
  res.json({
    date: today,
    totals: {
      traders: active.length,
      trading: active.filter((r) => r.metrics.today.trades > 0).length,
      pnlNetToday: pnlVals.length ? round2(pnlVals.reduce((s, v) => s + v, 0)) : null,
      openPositions: positions.length,
      openRiskUsd: round2(positions.reduce((s, p) => s + (p.riskUsd ?? 0), 0)),
      carriedTonight: positions.filter((p) => p.carriedTonight).length,
      overnightExposureUsd: round2(positions.filter((p) => p.carriedTonight).reduce((s, p) => s + (p.exposureUsd ?? 0), 0)),
    },
    halted: active.filter((r) => r.metrics.stop.halted).map(brief),
    nearStop: active.filter((r) => r.metrics.stop.state === "warn").map(brief),
    breachesToday: breachRes.rows.filter((r: any) => String(r.date) === today).map((r: any) => ({ trader: String(r.trader), kind: String(r.kind), kindLabel: kindLabel(r.kind) })),
    repeatBreachers: [...breachDates.entries()]
      .map(([trader, dates]) => ({ trader, days7: new Set(dates).size, dates: [...new Set(dates)].sort() }))
      .filter((x) => x.days7 >= 2)
      .sort((a, b) => b.days7 - a.days7),
    unreviewedBreaches: unreviewedRes.rows.map((r: any) => ({ id: Number(r.id), trader: String(r.trader), date: String(r.date), kind: String(r.kind), kindLabel: kindLabel(r.kind), message: String(r.message) })), // RU log text (no numbers in this query)
    noLimits: active.filter((r) => !tpl.get(r.trader)?.hasLimits).map((r) => r.trader),
    templateDrift: active
      .map((r) => ({ trader: r.trader, tier: tpl.get(r.trader)?.tier ?? null, tierName: tpl.get(r.trader)?.tierName ?? null, fields: (tpl.get(r.trader)?.drift ?? []).map((d) => d.label) }))
      .filter((x) => x.fields.length > 0),
    overnight: active
      .filter((r) => r.metrics.today.carriedTonight > 0)
      .map((r) => ({ trader: r.trader, positions: r.metrics.today.carriedTonight, exposureUsd: r.metrics.today.overnightExposureUsd, allowed: r.limits?.allowOvernight ?? null, limitUsd: r.limits?.maxOvernightExposure ?? null })),
  });
}));

export default router;
