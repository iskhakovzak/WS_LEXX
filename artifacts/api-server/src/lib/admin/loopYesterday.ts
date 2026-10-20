/**
 * Admin «Обзор» → «Петля вчера» (Волна 2 п. 2.4): one row per active trader for the last finished trading day —
 * plan → trades → day closed → curator review — plus Telegram linked, and the totals per column. Read-only, built from
 * the existing stores only (no tables of its own):
 *
 *   plan       trader_plans (deleted_at IS NULL) for the date; «before the open» = first save before 09:30 NY
 *              (lib/usage/funnel beforeOpen — the same rule as the «Использование» funnel)
 *   trades     closed own trades by close day (lib/tradeMath closedSql / closeDateSql, as lib/usage/stats tagCounts)
 *   closed     eod_days.closed_at for (trader, date) — the day closes via closeEodDay
 *   review     eod_days.reviewed_at / reviewed_by; hours = trading hours from the close to the review (or to now while
 *              waiting), lib/eodLogic tradingHoursBetween, SLA REVIEW_SLA_HOURS
 *   telegram   users.telegram_chat_id non-empty
 *
 * `buildLoop` is pure (tests: lib/__tests__/loopYesterday.test.ts); `loadLoopFacts` reads the stores; the route is
 * routes/admin-loop.ts.
 */
import { pool } from "@workspace/db";
import { beforeOpen } from "../usage/funnel";
import { closeDateSql, closedSql } from "../tradeMath";
import { REVIEW_SLA_HOURS, tradingHoursBetween } from "../eodLogic";

export type LoopTrader = { name: string; group: string | null; telegram: boolean };
export type LoopDay = { closedAt: Date | string | null; reviewedAt: Date | string | null; reviewedBy: string | null };
export type LoopFacts = {
  traders: readonly LoopTrader[];
  /** trader → first save of the plan for the date. */
  plans: ReadonlyMap<string, Date | string>;
  /** trader → closed own trades by close day. */
  trades: ReadonlyMap<string, number>;
  /** trader → the eod_days row of the date. */
  days: ReadonlyMap<string, LoopDay>;
};

export type LoopRow = {
  name: string;
  group: string | null;
  plan: boolean;
  /** The plan was first saved before 09:30 NY of the date (false without a plan). */
  planBeforeOpen: boolean;
  trades: number;
  closed: boolean;
  closedAt: string | null;
  reviewed: boolean;
  reviewedBy: string | null;
  /** Trading hours from the close to the review (reviewed) or to now (waiting); null while the day is open. */
  reviewHours: number | null;
  /** reviewHours past the SLA (waiting too long, or reviewed late). */
  overSla: boolean;
  telegram: boolean;
};

export type LoopTotals = {
  traders: number;
  plan: number;
  planBeforeOpen: number;
  /** Traders with at least one closed trade. */
  traded: number;
  /** Closed trades of everyone. */
  trades: number;
  closed: number;
  reviewed: number;
  /** Closed, not reviewed yet. */
  waiting: number;
  /** Waiting past the SLA. */
  overdue: number;
  telegram: number;
};

export type LoopYesterday = { date: string; slaHours: number; rows: LoopRow[]; totals: LoopTotals };

const iso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Rows (by name) and totals of `date`; `closedDays` = full-day market holidays (the SLA clock pauses on them). */
export function buildLoop(date: string, facts: LoopFacts, closedDays: ReadonlySet<string>, now: number = Date.now()): LoopYesterday {
  const rows: LoopRow[] = facts.traders.map((t) => {
    const planAt = facts.plans.get(t.name);
    const day = facts.days.get(t.name);
    const closedAt = iso(day?.closedAt);
    const reviewedAt = iso(day?.reviewedAt);
    const reviewHours = closedAt ? tradingHoursBetween(closedAt, reviewedAt ? new Date(reviewedAt) : now, closedDays) : null;
    return {
      name: t.name,
      group: t.group,
      plan: planAt != null,
      planBeforeOpen: planAt != null && beforeOpen(new Date(planAt), date),
      trades: Math.max(0, Number(facts.trades.get(t.name) ?? 0) || 0),
      closed: closedAt != null,
      closedAt,
      reviewed: closedAt != null && reviewedAt != null,
      reviewedBy: closedAt != null && reviewedAt != null ? (day?.reviewedBy ?? null) : null,
      reviewHours,
      overSla: reviewHours != null && reviewHours > REVIEW_SLA_HOURS,
      telegram: t.telegram,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { date, slaHours: REVIEW_SLA_HOURS, rows, totals: loopTotals(rows) };
}

export function loopTotals(rows: readonly LoopRow[]): LoopTotals {
  const count = (pred: (r: LoopRow) => boolean) => rows.filter(pred).length;
  return {
    traders: rows.length,
    plan: count((r) => r.plan),
    planBeforeOpen: count((r) => r.planBeforeOpen),
    traded: count((r) => r.trades > 0),
    trades: rows.reduce((s, r) => s + r.trades, 0),
    closed: count((r) => r.closed),
    reviewed: count((r) => r.reviewed),
    waiting: count((r) => r.closed && !r.reviewed),
    overdue: count((r) => r.closed && !r.reviewed && r.overSla),
    telegram: count((r) => r.telegram),
  };
}

// ─── reads ──────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const ACTIVE_TRADER = `u.role = 'trader' AND u.active = true AND COALESCE(u.banned, false) = false`;

/** Missing table / column (fresh DB before its migration) → nothing to read. */
async function soft(sql: string, params: unknown[]): Promise<Row[]> {
  try {
    return (await pool.query(sql, params)).rows as Row[];
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "42P01" || code === "42703") return [];
    throw err;
  }
}

async function activeTraders(): Promise<LoopTrader[]> {
  let rows = await soft(
    `SELECT u.name, g.name AS group_name, u.telegram_chat_id
       FROM users u LEFT JOIN desk_groups g ON g.id = u.group_id AND g.archived_at IS NULL
      WHERE ${ACTIVE_TRADER} ORDER BY u.name`,
    [],
  );
  // desk_groups / group_id not there yet (before migration 0231): the same list without groups
  if (!rows.length) rows = await soft(`SELECT u.name, NULL AS group_name, u.telegram_chat_id FROM users u WHERE ${ACTIVE_TRADER} ORDER BY u.name`, []);
  return rows.map((r) => ({
    name: String(r.name),
    group: r.group_name == null ? null : String(r.group_name),
    telegram: String(r.telegram_chat_id ?? "").trim() !== "",
  }));
}

/** Everything `buildLoop` needs for `date`, limited to `names` (null = every active trader). */
export async function loadLoopFacts(date: string, names: ReadonlySet<string> | null): Promise<LoopFacts> {
  const closeDay = `LEFT(${closeDateSql("t")}, 10)`;
  const [traders, plans, trades, days] = await Promise.all([
    activeTraders(),
    soft(`SELECT trader, MIN(created_at) AS created FROM trader_plans WHERE deleted_at IS NULL AND date = $1 GROUP BY trader`, [date]),
    soft(
      `SELECT t.trader, COUNT(*)::int AS n FROM trades t
        WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND ${closedSql("t")} AND ${closeDay} = $1
        GROUP BY t.trader`,
      [date],
    ),
    soft(`SELECT trader, closed_at, reviewed_at, reviewed_by FROM eod_days WHERE date = $1`, [date]),
  ]);
  return {
    traders: names ? traders.filter((t) => names.has(t.name)) : traders,
    plans: new Map(plans.map((r) => [String(r.trader), r.created as Date])),
    trades: new Map(trades.map((r) => [String(r.trader), Number(r.n) || 0])),
    days: new Map(days.map((r) => [String(r.trader), {
      closedAt: r.closed_at ?? null, reviewedAt: r.reviewed_at ?? null, reviewedBy: r.reviewed_by == null ? null : String(r.reviewed_by),
    }])),
  };
}
