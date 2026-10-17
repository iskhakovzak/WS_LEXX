/**
 * «Кабинет куратора» — агрегирующие эндпоинты (только чтение чужих таблиц) + приватные заметки персонала.
 *
 *   GET  /curator/today                 ?scope=mine|desk&date= — фаза дня, кто торгует, риск, нет плана / не закрыт день,
 *                                       общая очередь разборов (EOD + недельные + задания Академии + нарушения),
 *                                       просроченные договорённости 1:1, приоритетные «следующие шаги»
 *   GET  /curator/traders               ?scope=mine|desk — карточка на трейдера: тренд 4 нед., дисциплина, риск, тир/ступень,
 *                                       последний разбор, 1:1, нарушения, последняя заметка, следующий шаг
 *   GET  /curator/trader/:name          профиль: карточка + лимиты/метрики, нарушения с разбором, дни EOD, недели,
 *                                       Академия (договорённости, 1:1 без приватных заметок, цели ИПР), заметки
 *   GET  /curator/notes?trader=         заметки о трейдере (персонал; трейдер не видит)
 *   POST /curator/notes                 {trader, body, kind?, pinned?}
 *   PATCH /curator/notes/:id            {body?, kind?, pinned?}
 *   POST /curator/notes/:id/archive     мягкое удаление
 *
 * Доступ: journal.review (куратор / админ); ?scope=mine — подопечные (assigned_*), иначе весь деск в пределах readScope.
 * Необязательные таблицы (планы, EOD, недельные, Академия) читаются с catch → пустые данные, если модуль ещё не создан.
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { nyDate, nyMinutes, addDays } from "../lib/tradingDate";
import { can, readScope, requireCap } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { ensureCuratorTables, rowToBreachReview, rowToNote } from "../lib/curatorStore";
import {
  STAGE_LABELS, mondayOf, nextActionFor, prevTradingDay, tradingPhase, trendDirection, weeklyTrend,
  type NextAction, type WeekPoint,
} from "../lib/curatorLogic";
import { BREACH_KIND_LABELS, deskSnapshot, templateStatus, type DeskSnapshotRow } from "./risk";

const router: IRouter = Router();

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLA_HOURS = { eod: 24, weekly: 48, academy: 72, breach: 24 } as const;

function clientDate(raw: unknown): string {
  return typeof raw === "string" && YMD_RE.test(raw) ? raw : nyDate();
}

/** Read from an optional module's table: any SQL error (table not created yet) → no rows. */
async function safe<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const { rows } = await pool.query(sql, params);
    return rows as T[];
  } catch {
    return [];
  }
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const hoursSince = (v: unknown, now: number): number | null => (v ? Math.max(0, Math.round(((now - new Date(v as string).getTime()) / 3_600_000) * 10) / 10) : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10 : null);

// ─── roster ─────────────────────────────────────────────────────────────────

type Roster = { traders: string[]; scope: "mine" | "desk"; wards: string[] };

async function loadRoster(req: Request, wanted: unknown): Promise<Roster> {
  const me = req.authUser!.name;
  const [users, readable] = await Promise.all([
    safe<{ name: string; role: string; ac: string | null; am: string | null; ar: string | null }>(
      `SELECT name, role, assigned_curator AS ac, assigned_mentor AS am, assigned_risk_manager AS ar
         FROM users WHERE active = true AND COALESCE(banned, false) = false`,
    ),
    readScope(req, "journal.review"),
  ]);
  let traders = users.filter((u) => u.role === "trader").map((u) => u.name);
  if (readable !== null) traders = traders.filter((t) => readable.includes(t));
  const wards = traders.filter((t) => {
    const u = users.find((x) => x.name === t);
    return !!u && (u.ac === me || u.am === me || u.ar === me);
  });
  const scope: "mine" | "desk" = wanted === "desk" ? "desk" : wanted === "mine" ? "mine" : wards.length ? "mine" : "desk";
  const list = scope === "mine" && wards.length ? wards : scope === "mine" ? [] : traders;
  return { traders: list.sort((a, b) => a.localeCompare(b, "ru")), scope, wards };
}

// ─── per-trader signals ─────────────────────────────────────────────────────

export type TraderSignal = {
  trader: string;
  stage: { key: string | null; label: string | null; since: string | null };
  tier: string | null;
  tierName: string | null;
  risk: {
    status: string; state: string; label: string; message: string; halted: boolean; nearStop: boolean;
    dailyPct: number | null; weeklyPct: number | null; drawdownPct: number | null;
    todayPnl: number | null; todayTrades: number; weekPnl: number | null; openPositions: number;
    hasLimits: boolean; templateDrift: string[];
  };
  trend: WeekPoint[];
  trendDir: "up" | "down" | "flat" | "none";
  discipline: { value: number | null; eodAvg: number | null; ratingAvg: number | null; n: number };
  /** today: null = no plan; available=false — the game-plan module is not set up on this server (do not flag). */
  plan: { today: "ready" | "draft" | null; available: boolean };
  eod: { prevDay: string; prevTraded: boolean; prevClosed: boolean; todayTraded: boolean; todayClosed: boolean; pending: number; lastClosed: string | null; lastReviewedAt: string | null; lastScore: number | null };
  weekly: { currentStatus: string | null; submittedPending: boolean; lastReviewedWeek: string | null; lastReviewedAt: string | null };
  academy: { openActions: number; overdueActions: number; lastOneOnOne: string | null; daysSinceOneOnOne: number | null; pendingSubmissions: number; activeGoals: number };
  breaches: { unreviewed: number; last30: number; lastDate: string | null };
  lastNote: { body: string; author: string; createdAt: string } | null;
  lastTradeDate: string | null;
  nextAction: NextAction;
};

type Bulk = Awaited<ReturnType<typeof loadBulk>>;

async function loadBulk(traders: string[], today: string) {
  await ensureCuratorTables();
  const prev = prevTradingDay(today);
  const from35 = addDays(today, -35);
  const from42 = addDays(today, -42);
  const from30 = addDays(today, -29);
  const [plansTable, desk, tpl, plans, eodRows, eodPending, weekly, subs, actions, meetings, stages, enrolls, ratings, breaches, notes, goals] = await Promise.all([
    safe<{ ok: boolean }>(`SELECT to_regclass('public.trader_plans') IS NOT NULL AS ok`),
    deskSnapshot(today),
    templateStatus(traders),
    safe(`SELECT trader, status FROM trader_plans WHERE date = $1 AND deleted_at IS NULL AND trader = ANY($2)`, [today, traders]),
    safe(`SELECT id, trader, date, closed_at, reviewed_at, discipline, curator_score FROM eod_days WHERE date >= $1 AND trader = ANY($2)`, [from35, traders]),
    safe(`SELECT id, trader, date, closed_at FROM eod_days WHERE closed_at IS NOT NULL AND reviewed_at IS NULL AND trader = ANY($1) ORDER BY closed_at ASC LIMIT 200`, [traders]),
    safe(`SELECT id, trader, week, TO_CHAR(week_start, 'YYYY-MM-DD') AS week_start, status, submitted_at, reviewed_at FROM weekly_reviews
           WHERE trader = ANY($1) AND (week_start >= $2::date OR status = 'submitted') ORDER BY week_start DESC`, [traders, from42]),
    safe(`SELECT s.id, s.user_name, s.created_at, a.title FROM academy_submissions s JOIN academy_assignments a ON a.id = s.assignment_id
           WHERE s.status = 'submitted' AND s.archived_at IS NULL AND s.user_name = ANY($1) ORDER BY s.created_at ASC LIMIT 200`, [traders]),
    safe(`SELECT id, student, owner, title, TO_CHAR(due_on, 'YYYY-MM-DD') AS due_on, status FROM academy_action_items
           WHERE archived_at IS NULL AND status = 'open' AND student = ANY($1) ORDER BY due_on ASC NULLS LAST`, [traders]),
    safe(`SELECT student, MAX(met_at) AS last FROM academy_one_on_ones WHERE archived_at IS NULL AND student = ANY($1) GROUP BY student`, [traders]),
    safe(`SELECT user_name, stage, since FROM academy_trader_stage WHERE user_name = ANY($1)`, [traders]),
    safe(`SELECT DISTINCT ON (user_name) user_name, stage FROM academy_enrollments WHERE archived_at IS NULL AND status = 'active' AND user_name = ANY($1) ORDER BY user_name, updated_at DESC`, [traders]),
    safe(`SELECT trader, discipline, overall FROM trader_ratings WHERE created_at >= NOW() - INTERVAL '42 days' AND trader = ANY($1)`, [traders]),
    safe(`SELECT a.id, a.trader, a.date, a.kind, a.message, a.created_at, r.id AS review_id FROM risk_alert_log a
           LEFT JOIN risk_breach_reviews r ON r.alert_id = a.id AND r.archived_at IS NULL
           WHERE a.level = 'breach' AND a.date >= $1 AND a.trader = ANY($2) ORDER BY a.date DESC`, [from30, traders]),
    safe(`SELECT DISTINCT ON (trader) trader, body, author, created_at FROM curator_notes WHERE archived_at IS NULL AND trader = ANY($1) ORDER BY trader, pinned DESC, created_at DESC`, [traders]),
    safe(`SELECT student, COUNT(*)::int AS n FROM academy_idp_goals WHERE archived_at IS NULL AND status = 'active' AND student = ANY($1) GROUP BY student`, [traders]),
  ]);
  return { today, prev, plansAvailable: plansTable[0]?.ok === true, desk, tpl, plans, eodRows, eodPending, weekly, subs, actions, meetings, stages, enrolls, ratings, breaches, notes, goals };
}

function buildSignal(name: string, b: Bulk): TraderSignal {
  const { today, prev } = b;
  const row: DeskSnapshotRow | undefined = b.desk.rows.find((r) => r.trader === name);
  const m = row?.metrics;
  const tpl = b.tpl.get(name);
  const days = row?.days ?? [];
  const trend = weeklyTrend(days, today, 4);

  const eod = b.eodRows.filter((e: any) => e.trader === name);
  const closedEod = eod.filter((e: any) => e.closed_at);
  const eodDisc = closedEod.map((e: any) => (e.discipline == null ? null : Number(e.discipline) * 2)).filter((v): v is number => v != null);
  const ratingDisc = b.ratings.filter((r: any) => r.trader === name).map((r: any) => Number(r.discipline)).filter((v) => Number.isFinite(v));
  const lastReviewed = [...eod].filter((e: any) => e.reviewed_at).sort((x: any, y: any) => String(y.reviewed_at).localeCompare(String(x.reviewed_at)))[0];
  const lastClosed = [...closedEod].sort((x: any, y: any) => String(y.date).localeCompare(String(x.date)))[0];
  const traded = (d: string) => days.some((x) => x.date === d && x.trades > 0);
  const closed = (d: string) => eod.some((e: any) => e.date === d && e.closed_at);

  const wk = b.weekly.filter((w: any) => w.trader === name);
  const thisWeek = wk.find((w: any) => w.week_start === mondayOf(today));
  const lastRevWeek = wk.filter((w: any) => w.status === "reviewed").sort((x: any, y: any) => String(y.week_start).localeCompare(String(x.week_start)))[0];

  const acts = b.actions.filter((a: any) => a.student === name);
  const overdue = acts.filter((a: any) => a.due_on && a.due_on < today);
  const lastMeet = b.meetings.find((x: any) => x.student === name)?.last ?? null;
  const lastMeetDate = lastMeet ? nyDate(new Date(lastMeet)) : null;
  const daysSince1on1 = lastMeetDate ? daysBetween(lastMeetDate, today) : null;

  const br = b.breaches.filter((x: any) => x.trader === name);
  const unreviewed = br.filter((x: any) => x.review_id == null).length;
  const note = b.notes.find((n: any) => n.trader === name);

  const st = b.stages.find((s: any) => s.user_name === name);
  const en = b.enrolls.find((s: any) => s.user_name === name);
  const stageKey: string | null = st?.stage ?? en?.stage ?? (tpl?.tier && STAGE_LABELS[tpl.tier] ? tpl.tier : null);

  const planRow = b.plans.find((p: any) => p.trader === name);
  const weekday = tradingPhase(today, 0) !== "weekend";
  const pendingEod = b.eodPending.filter((e: any) => e.trader === name).length;
  const hasLimits = tpl?.hasLimits ?? false;

  const signalBase = {
    trader: name,
    stage: { key: stageKey, label: stageKey ? STAGE_LABELS[stageKey] ?? stageKey : null, since: st?.since ?? null },
    tier: tpl?.tier ?? null,
    tierName: tpl?.tierName ?? null,
    risk: {
      status: m?.status ?? "no_limits", state: m?.stop.state ?? "no_limits", label: m?.stop.label ?? "Нет лимитов", message: m?.stop.message ?? "",
      halted: m?.stop.halted ?? false, nearStop: m?.stop.state === "warn",
      dailyPct: m?.stop.dailyPct ?? null, weeklyPct: m?.stop.weeklyPct ?? null, drawdownPct: m?.stop.drawdownPct ?? null,
      todayPnl: m?.today.pnlNet ?? null, todayTrades: m?.today.trades ?? 0, weekPnl: m?.week.pnlNet ?? null, openPositions: m?.today.openPositions ?? 0,
      hasLimits, templateDrift: (tpl?.drift ?? []).map((d) => d.label),
    },
    trend,
    trendDir: trendDirection(trend),
    discipline: { value: avg([...eodDisc, ...ratingDisc]), eodAvg: avg(eodDisc.map((v) => v / 2)), ratingAvg: avg(ratingDisc), n: eodDisc.length + ratingDisc.length },
    plan: { today: planRow ? (planRow.status === "ready" ? "ready" as const : "draft" as const) : null, available: b.plansAvailable },
    eod: {
      prevDay: prev, prevTraded: traded(prev), prevClosed: closed(prev), todayTraded: traded(today), todayClosed: closed(today),
      pending: pendingEod, lastClosed: lastClosed?.date ?? null, lastReviewedAt: iso(lastReviewed?.reviewed_at), lastScore: lastReviewed?.curator_score ?? null,
    },
    weekly: {
      currentStatus: thisWeek?.status ?? null,
      submittedPending: wk.some((w: any) => w.status === "submitted"),
      lastReviewedWeek: lastRevWeek?.week ?? null,
      lastReviewedAt: iso(lastRevWeek?.reviewed_at),
    },
    academy: {
      openActions: acts.length, overdueActions: overdue.length, lastOneOnOne: lastMeetDate, daysSinceOneOnOne: daysSince1on1,
      pendingSubmissions: b.subs.filter((s: any) => s.user_name === name).length,
      activeGoals: Number(b.goals.find((g: any) => g.student === name)?.n ?? 0),
    },
    breaches: { unreviewed, last30: new Set(br.map((x: any) => x.date)).size, lastDate: br[0]?.date ?? null },
    lastNote: note ? { body: String(note.body).slice(0, 280), author: String(note.author), createdAt: iso(note.created_at)! } : null,
    lastTradeDate: row?.lastTradeDate ?? null,
  };
  const nextAction = nextActionFor({
    trader: name,
    halted: signalBase.risk.halted,
    nearStop: signalBase.risk.nearStop,
    unreviewedBreaches: unreviewed,
    eodPending: pendingEod,
    weeklySubmitted: signalBase.weekly.submittedPending,
    overdueActions: overdue.length,
    hasLimits,
    templateDrift: signalBase.risk.templateDrift.length,
    missingPlan: b.plansAvailable && weekday && !planRow && today === nyDate() && tradingPhase(today, nyMinutes()) !== "afterclose",
    missingEod: signalBase.eod.prevTraded && !signalBase.eod.prevClosed,
    daysSinceOneOnOne: daysSince1on1,
  });
  return { ...signalBase, nextAction };
}

// ─── today ──────────────────────────────────────────────────────────────────

router.get("/curator/today", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "journal.review"))) return;
  const today = clientDate(req.query.date);
  const roster = await loadRoster(req, req.query.scope);
  const b = await loadBulk(roster.traders, today);
  const signals = roster.traders.map((t) => buildSignal(t, b));
  const phase = tradingPhase(today, today === nyDate() ? nyMinutes() : today < nyDate() ? 17 * 60 : 0);
  const now = Date.now();
  const weekday = phase !== "weekend";

  const queue = [
    ...b.eodPending.map((e: any) => ({
      kind: "eod" as const, id: `eod:${e.id}`, trader: String(e.trader), title: `Закрытый день ${e.date}`,
      since: iso(e.closed_at), hoursWaiting: hoursSince(e.closed_at, now), href: "/journal?view=queue",
    })),
    ...b.weekly.filter((w: any) => w.status === "submitted").map((w: any) => ({
      kind: "weekly" as const, id: `weekly:${w.id}`, trader: String(w.trader), title: `Недельный отчёт ${w.week}`,
      since: iso(w.submitted_at), hoursWaiting: hoursSince(w.submitted_at, now),
      href: `/weekly-review?view=curator&trader=${encodeURIComponent(String(w.trader))}&week=${encodeURIComponent(String(w.week))}`,
    })),
    ...b.subs.map((s: any) => ({
      kind: "academy" as const, id: `academy:${s.id}`, trader: String(s.user_name), title: `Задание: ${String(s.title).slice(0, 80)}`,
      since: iso(s.created_at), hoursWaiting: hoursSince(s.created_at, now), href: "/academy/mentor",
    })),
    ...b.breaches.filter((x: any) => x.review_id == null).map((x: any) => ({
      kind: "breach" as const, id: `breach:${x.id}`, trader: String(x.trader), title: `Разбор нарушения: ${BREACH_KIND_LABELS[String(x.kind)] ?? x.kind}, ${x.date}`,
      since: iso(x.created_at), hoursWaiting: hoursSince(x.created_at, now), href: `/curator?trader=${encodeURIComponent(String(x.trader))}&tab=risk`,
    })),
  ].map((q) => ({ ...q, overdue: (q.hoursWaiting ?? 0) > SLA_HOURS[q.kind], slaHours: SLA_HOURS[q.kind] }))
    .sort((x, y) => Number(y.overdue) - Number(x.overdue) || (y.hoursWaiting ?? 0) - (x.hoursWaiting ?? 0));

  const overdueActions = b.actions
    .filter((a: any) => a.due_on && a.due_on < today)
    .map((a: any) => ({ id: Number(a.id), trader: String(a.student), title: String(a.title), dueOn: String(a.due_on), owner: String(a.owner), daysOverdue: daysBetween(String(a.due_on), today) }))
    .sort((x, y) => y.daysOverdue - x.daysOverdue);

  const trading = signals
    .filter((s) => s.risk.todayTrades > 0 || s.risk.openPositions > 0)
    .map((s) => ({ trader: s.trader, trades: s.risk.todayTrades, pnlNet: s.risk.todayPnl, openPositions: s.risk.openPositions, state: s.risk.state, dailyPct: s.risk.dailyPct }))
    .sort((x, y) => (x.pnlNet ?? 0) - (y.pnlNet ?? 0));

  const riskBrief = (s: TraderSignal) => ({ trader: s.trader, state: s.risk.state, label: s.risk.label, message: s.risk.message, pnlNet: s.risk.todayPnl, dailyPct: s.risk.dailyPct, weeklyPct: s.risk.weeklyPct, drawdownPct: s.risk.drawdownPct });
  const missingPlan = weekday && b.plansAvailable ? signals.filter((s) => s.plan.today !== "ready").map((s) => ({ trader: s.trader, status: s.plan.today })) : [];
  const missingEod = signals.filter((s) => s.eod.prevTraded && !s.eod.prevClosed).map((s) => ({ trader: s.trader, date: s.eod.prevDay }));
  const openToday = phase === "afterclose" ? signals.filter((s) => s.eod.todayTraded && !s.eod.todayClosed).map((s) => ({ trader: s.trader, date: today })) : [];
  const nextActions = signals
    .filter((s) => s.nextAction.kind !== "none")
    .map((s) => ({ trader: s.trader, ...s.nextAction }))
    .sort((x, y) => y.priority - x.priority || x.trader.localeCompare(y.trader, "ru"));

  res.json({
    date: today,
    prevDay: b.prev,
    phase,
    nyMinutes: nyMinutes(),
    scope: roster.scope,
    wards: roster.wards.length,
    traders: roster.traders,
    plansAvailable: b.plansAvailable,
    counts: {
      traders: roster.traders.length,
      trading: trading.length,
      halted: signals.filter((s) => s.risk.halted).length,
      nearStop: signals.filter((s) => s.risk.nearStop).length,
      noLimits: signals.filter((s) => !s.risk.hasLimits).length,
      missingPlan: missingPlan.length,
      missingEod: missingEod.length,
      queue: queue.length,
      queueOverdue: queue.filter((q) => q.overdue).length,
      overdueActions: overdueActions.length,
    },
    trading,
    risk: {
      halted: signals.filter((s) => s.risk.halted).map(riskBrief),
      nearStop: signals.filter((s) => s.risk.nearStop).map(riskBrief),
      noLimits: signals.filter((s) => !s.risk.hasLimits).map((s) => s.trader),
    },
    missingPlan,
    missingEod,
    openToday,
    queue,
    overdueActions,
    nextActions,
  });
}));

// ─── traders ────────────────────────────────────────────────────────────────

router.get("/curator/traders", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "journal.review"))) return;
  const today = clientDate(req.query.date);
  const roster = await loadRoster(req, req.query.scope);
  const b = await loadBulk(roster.traders, today);
  res.json({ date: today, scope: roster.scope, wards: roster.wards.length, traders: roster.traders.map((t) => buildSignal(t, b)) });
}));

router.get("/curator/trader/:name", asyncHandler(async (req, res): Promise<void> => {
  const name = String(req.params.name ?? "").trim();
  if (!name || name.length > 100) { res.status(400).json({ error: "Invalid trader" }); return; }
  if (!(await requireCap(req, res, "journal.review", { trader: name }))) return;
  const { rows: u } = await pool.query(`SELECT name, role, assigned_curator, assigned_mentor, assigned_risk_manager FROM users WHERE name = $1 LIMIT 1`, [name]);
  if (!u[0]) { res.status(404).json({ error: "Трейдер не найден" }); return; }
  const today = clientDate(req.query.date);
  const b = await loadBulk([name], today);
  const signal = buildSignal(name, b);
  const row = b.desk.rows.find((r) => r.trader === name);
  const from90 = addDays(today, -89);
  const [breaches, eodDays, weeks, actions, meetings, goals, notes, limitEvents] = await Promise.all([
    safe(`SELECT a.id, a.date, a.kind, a.used::float AS used, a."limit"::float AS "limit", a.message, a.created_at,
                 CASE WHEN r.id IS NULL THEN NULL ELSE row_to_json(r.*) END AS review
            FROM risk_alert_log a LEFT JOIN risk_breach_reviews r ON r.alert_id = a.id AND r.archived_at IS NULL
           WHERE a.level = 'breach' AND a.trader = $1 AND a.date >= $2 ORDER BY a.date DESC, a.created_at DESC`, [name, from90]),
    safe(`SELECT id, date, closed_at, reviewed_at, reviewed_by, discipline, curator_score, curator_comment FROM eod_days WHERE trader = $1 ORDER BY date DESC LIMIT 15`, [name]),
    safe(`SELECT id, week, TO_CHAR(week_start, 'YYYY-MM-DD') AS week_start, status, submitted_at, reviewed_at, curator_review ->> 'score' AS score
            FROM weekly_reviews WHERE trader = $1 ORDER BY week_start DESC LIMIT 8`, [name]),
    safe(`SELECT id, owner, title, TO_CHAR(due_on, 'YYYY-MM-DD') AS due_on, status, done_at FROM academy_action_items
           WHERE archived_at IS NULL AND student = $1 ORDER BY (status = 'open') DESC, due_on ASC NULLS LAST LIMIT 30`, [name]),
    // private_notes of a 1:1 are never selected here.
    safe(`SELECT id, mentor, met_at, format, agenda FROM academy_one_on_ones WHERE archived_at IS NULL AND student = $1 ORDER BY met_at DESC LIMIT 6`, [name]),
    safe(`SELECT id, title, metric, comparator, target::float AS target, TO_CHAR(due_on, 'YYYY-MM-DD') AS due_on, status, last_value::float AS last_value, last_progress::float AS last_progress
            FROM academy_idp_goals WHERE archived_at IS NULL AND student = $1 ORDER BY (status = 'active') DESC, created_at DESC LIMIT 10`, [name]),
    safe(`SELECT * FROM curator_notes WHERE archived_at IS NULL AND trader = $1 ORDER BY pinned DESC, created_at DESC LIMIT 100`, [name]),
    safe(`SELECT id, reason, changed_by, changed_at FROM trader_risk_limit_events WHERE trader = $1 ORDER BY changed_at DESC LIMIT 5`, [name]),
  ]);
  res.json({
    trader: name,
    role: u[0].role,
    assigned: { curator: u[0].assigned_curator ?? null, mentor: u[0].assigned_mentor ?? null, riskManager: u[0].assigned_risk_manager ?? null },
    signal,
    limits: row?.limits ?? null,
    metrics: row ? { today: row.metrics.today, week: row.metrics.week, drawdown: row.metrics.drawdown, stop: row.metrics.stop, alerts: row.metrics.alerts } : null,
    breaches: breaches.map((r: any) => ({
      id: Number(r.id), date: String(r.date), kind: String(r.kind), kindLabel: BREACH_KIND_LABELS[String(r.kind)] ?? String(r.kind),
      used: r.used == null ? null : Number(r.used), limit: r.limit == null ? null : Number(r.limit), message: String(r.message), createdAt: iso(r.created_at),
      review: r.review ? rowToBreachReview(r.review) : null,
    })),
    eodDays: eodDays.map((e: any) => ({
      id: Number(e.id), date: String(e.date), closedAt: iso(e.closed_at), reviewedAt: iso(e.reviewed_at), reviewedBy: e.reviewed_by ?? null,
      discipline: e.discipline == null ? null : Number(e.discipline), curatorScore: e.curator_score == null ? null : Number(e.curator_score), curatorComment: e.curator_comment ?? null,
    })),
    weeks: weeks.map((w: any) => ({ id: Number(w.id), week: String(w.week), weekStart: String(w.week_start), status: String(w.status), submittedAt: iso(w.submitted_at), reviewedAt: iso(w.reviewed_at), score: w.score == null ? null : Number(w.score) })),
    actions: actions.map((a: any) => ({ id: Number(a.id), owner: String(a.owner), title: String(a.title), dueOn: a.due_on ?? null, status: String(a.status), overdue: a.status === "open" && !!a.due_on && a.due_on < today })),
    meetings: meetings.map((x: any) => ({ id: Number(x.id), mentor: String(x.mentor), metAt: iso(x.met_at), format: String(x.format), agenda: String(x.agenda ?? "").slice(0, 300) })),
    goals: goals.map((g: any) => ({ id: Number(g.id), title: String(g.title), metric: String(g.metric), comparator: String(g.comparator), target: g.target, dueOn: g.due_on ?? null, status: String(g.status), lastValue: g.last_value, lastProgress: g.last_progress })),
    notes: notes.map(rowToNote),
    limitEvents: limitEvents.map((e: any) => ({ id: Number(e.id), reason: e.reason ?? null, changedBy: e.changed_by ?? null, changedAt: iso(e.changed_at) })),
    canEditLimits: await can(req, "risk.limits.edit", { trader: name }),
  });
}));

// ─── notes (private to staff) ───────────────────────────────────────────────

const NOTE_KINDS = ["note", "call", "concern", "praise"] as const;

router.get("/curator/notes", asyncHandler(async (req, res): Promise<void> => {
  const trader = typeof req.query.trader === "string" ? req.query.trader.trim() : "";
  if (!trader || trader.length > 100) { res.status(400).json({ error: "Укажите трейдера" }); return; }
  if (!(await requireCap(req, res, "journal.review", { trader }))) return;
  await ensureCuratorTables();
  const { rows } = await pool.query(`SELECT * FROM curator_notes WHERE archived_at IS NULL AND trader = $1 ORDER BY pinned DESC, created_at DESC LIMIT 200`, [trader]);
  res.json({ trader, notes: rows.map(rowToNote) });
}));

const NoteBody = z.object({
  trader: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1, "Пустая заметка").max(4000),
  kind: z.enum(NOTE_KINDS).default("note"),
  pinned: z.boolean().default(false),
}).strict();

router.post("/curator/notes", asyncHandler(async (req, res): Promise<void> => {
  const parsed = NoteBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }); return; }
  const b = parsed.data;
  if (!(await requireCap(req, res, "journal.review", { trader: b.trader }))) return;
  const { rows: exists } = await pool.query(`SELECT 1 FROM users WHERE name = $1 LIMIT 1`, [b.trader]);
  if (!exists.length) { res.status(404).json({ error: "Трейдер не найден" }); return; }
  await ensureCuratorTables();
  const { rows } = await pool.query(
    `INSERT INTO curator_notes (trader, author, body, kind, pinned) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [b.trader, req.authUser!.name, b.body, b.kind, b.pinned],
  );
  res.status(201).json(rowToNote(rows[0]));
}));

const NotePatch = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  kind: z.enum(NOTE_KINDS).optional(),
  pinned: z.boolean().optional(),
}).strict();

async function loadNoteForEdit(req: Request, id: number): Promise<{ ok: true; row: any } | { ok: false; status: number; error: string }> {
  await ensureCuratorTables();
  const { rows } = await pool.query(`SELECT * FROM curator_notes WHERE id = $1 AND archived_at IS NULL`, [id]);
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: "Заметка не найдена" };
  if (!(await can(req, "journal.review", { trader: String(row.trader) }))) return { ok: false, status: 403, error: "Нет доступа" };
  // Body is edited by its author only; pin / kind — by any staff member of the trader.
  return { ok: true, row };
}

router.patch("/curator/notes/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = NotePatch.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Проверьте поля" }); return; }
  const found = await loadNoteForEdit(req, id);
  if (!found.ok) { res.status(found.status).json({ error: found.error }); return; }
  const p = parsed.data;
  if (p.body !== undefined && found.row.author !== req.authUser!.name) { res.status(403).json({ error: "Текст заметки меняет только автор" }); return; }
  const { rows } = await pool.query(
    `UPDATE curator_notes SET body = COALESCE($2, body), kind = COALESCE($3, kind), pinned = COALESCE($4, pinned), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, p.body ?? null, p.kind ?? null, p.pinned ?? null],
  );
  res.json(rowToNote(rows[0]));
}));

router.post("/curator/notes/:id/archive", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const found = await loadNoteForEdit(req, id);
  if (!found.ok) { res.status(found.status).json({ error: found.error }); return; }
  await pool.query(`UPDATE curator_notes SET archived_at = NOW(), archived_by = $2 WHERE id = $1`, [id, req.authUser!.name]);
  await logAudit({ actor: req.authUser!.name, action: "curator.note.archive", targetType: "curator_notes", targetId: String(id), details: { trader: found.row.trader, author: found.row.author } });
  res.json({ ok: true });
}));

export default router;
