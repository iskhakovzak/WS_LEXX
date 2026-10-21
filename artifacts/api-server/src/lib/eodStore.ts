import { z } from "zod";
import { pool } from "@workspace/db";
import { isWeekend, nyDate, nyMinutes } from "./tradingDate";
import { EARLY_CLOSE_MIN, MARKET_CLOSE_MIN, canCloseDay, computeStreaks, missingList, nextTradingDay, type Streaks } from "./eodLogic";
import { signedRSql, netPnlSql, closeDateSql, horizonSql, resultSql } from "./tradeMath";

/**
 * «Закрытие дня» data layer (routes/eod.ts): the eod_days / eod_trade_reviews tables, day + trade reads,
 * the close check, totals, plan tickers and streaks. Split out of routes/eod.ts (size ratchet); no logic here
 * beyond what the route used inline.
 */

export const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

// ── Validation ────────────────────────────────────────────────────────────────
const Position = z.object({
  tradeId: z.number().int().positive(),
  thesisValid: z.boolean().nullable().default(null),
  stop: z.number().finite().nullable().default(null),
  target: z.number().finite().nullable().default(null),
  gapNote: z.string().trim().max(1000).default(""),
});
export const Summary = z.object({
  mood: z.number().int().min(1).max(5).nullable().default(null),
  repeat: z.string().trim().max(4000).default(""),
  stop: z.string().trim().max(4000).default(""),
  tomorrow: z.string().trim().max(6000).default(""),
  positions: z.array(Position).max(100).default([]),
  reconcile: z
    .object({
      brokerNet: z.number().finite().nullable().default(null),
      journalNet: z.number().finite().nullable().default(null),
      brokerTrades: z.number().int().nullable().default(null),
      journalTrades: z.number().int().nullable().default(null),
      note: z.string().trim().max(1000).default(""),
    })
    .optional(),
});
export type SummaryT = z.infer<typeof Summary>;
// ── Data ──────────────────────────────────────────────────────────────────────
export const DAY_COLS = `d.id, d.trader, d.date, d.closed_at AS "closedAt", d.discipline, d.summary,
  d.reviewed_by AS "reviewedBy", d.reviewed_at AS "reviewedAt", d.curator_comment AS "curatorComment",
  d.curator_score AS "curatorScore", d.created_at AS "createdAt", d.updated_at AS "updatedAt"`;

export type DayRow = {
  id: number; trader: string; date: string; closedAt: Date | null; discipline: number | null; summary: SummaryT;
  reviewedBy: string | null; reviewedAt: Date | null; curatorComment: string | null; curatorScore: number | null;
  createdAt: Date; updatedAt: Date;
};

export type DayStatus = "open" | "closed" | "reviewed";
export function statusOf(d: DayRow | null): DayStatus {
  if (!d || !d.closedAt) return "open";
  return d.reviewedAt ? "reviewed" : "closed";
}

/**
 * Close rule (P1-8): trades imported from the broker never block the close — setup / grade on them is a soft
 * reminder (`soft`). Only manual trades still need setup + grade before the day can be closed.
 */
function isBrokerTrade(t: { source: string | null }): boolean {
  return t.source === "propreports";
}
function closeCheck(date: string, today: string, trades: TradeRow[], at?: { nowMinutes: number; closeMinutes: number }) {
  const check = canCloseDay({ date, today, trades: trades.filter((t) => !isBrokerTrade(t)), ...at });
  return { ...check, soft: missingList(trades.filter(isBrokerTrade)) };
}

/**
 * The session close of a NY date in NY minutes: 13:00 on an early-close day (holiday_calendar «Early close 1pm ET»,
 * migrations 0016 / 0017 / 0215), else 16:00. One read per date per process; a failed read is a regular day.
 */
const closeMinutesCache = new Map<string, number>();
export async function closeMinutesFor(date: string): Promise<number> {
  const hit = closeMinutesCache.get(date);
  if (hit !== undefined) return hit;
  let m = MARKET_CLOSE_MIN;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM holiday_calendar WHERE date::text = $1 AND type = 'holiday' AND description ILIKE 'early close%' LIMIT 1`,
      [date],
    );
    if (rows.length) m = EARLY_CLOSE_MIN;
  } catch { /* no calendar → regular close */ }
  if (closeMinutesCache.size > 500) closeMinutesCache.clear();
  closeMinutesCache.set(date, m);
  return m;
}

/** The close check as of `now` (the time of day counts only for today). */
export async function closeCheckNow(date: string, trades: TradeRow[], now = new Date()) {
  const today = nyDate(now);
  const at = date === today ? { nowMinutes: nyMinutes(now), closeMinutes: await closeMinutesFor(date) } : undefined;
  return closeCheck(date, today, trades, at);
}

/**
 * The day the «Фокус на завтра» of `date` is for: the next trading day after it — or, when the day is closed late
 * (Friday closed on Tuesday), the session still ahead of `now` (today before the close, else the next weekday), so the
 * focus never lands in the past where no plan reads it.
 */
export function focusDayFor(date: string, now = new Date()): string {
  const next = nextTradingDay(date);
  const today = nyDate(now);
  const ahead = !isWeekend(today) && nyMinutes(now) < MARKET_CLOSE_MIN ? today : nextTradingDay(today);
  return next >= ahead ? next : ahead;
}

/** Closed by the «Разобрал» button (dashboard / Telegram), not by the journal form. */
export function isQuickClose(d: Pick<DayRow, "closedAt" | "summary"> | null): boolean {
  return !!d?.closedAt && (d.summary as { via?: unknown } | null)?.via === "daily";
}

/** The trader's one-line note to «Разобрал» (daily_reviews.note); null when none / table absent. */
export async function traderNote(trader: string, date: string): Promise<string | null> {
  const { rows } = await pool
    .query<{ note: string | null }>(`SELECT note FROM daily_reviews WHERE trader = $1 AND date = $2`, [trader, date])
    .catch(() => ({ rows: [] as { note: string | null }[] }));
  return rows[0]?.note ?? null;
}

export function serializeDay(d: DayRow | null) {
  if (!d) return null;
  return {
    ...d,
    closedAt: iso(d.closedAt), reviewedAt: iso(d.reviewedAt), createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt),
    status: statusOf(d),
  };
}

export async function loadDay(trader: string, date: string): Promise<DayRow | null> {
  const { rows } = await pool.query<DayRow>(`SELECT ${DAY_COLS} FROM eod_days d WHERE d.trader = $1 AND d.date = $2`, [trader, date]);
  return rows[0] ?? null;
}
export async function loadDayById(id: number): Promise<DayRow | null> {
  const { rows } = await pool.query<DayRow>(`SELECT ${DAY_COLS} FROM eod_days d WHERE d.id = $1`, [id]);
  return rows[0] ?? null;
}

// `to_jsonb(t)` lets us read the PropReports columns (source / external_id) even on a DB where the
// migration hasn't landed yet — the query never references a column that may not exist.
const TRADE_COLS = `t.id, t.ticker, LEFT(t.date, 10) AS date, t.side, t.setup, t.result, t.session,
  t.pnl::float8 AS pnl, t.fees::float8 AS fees, t.qty::float8 AS qty,
  t.entry::float8 AS entry, t.exit::float8 AS exit, t.stop::float8 AS stop,
  t.r_multiple::float8 AS "rMultiple", t.risk_usd::float8 AS "riskUsd",
  t.confidence_grade AS "confidenceGrade", t.tags, t.conclusion, t.pattern_id AS "patternId",
  t.horizon, t.exit_date AS "exitDate",
  COALESCE(to_jsonb(t) ->> 'source', t.context_snapshot ->> 'source') AS source,
  to_jsonb(t) ->> 'external_id' AS "externalId",
  ${signedRSql()} AS r, ${netPnlSql()} AS net, ${closeDateSql()} AS "closeDate",
  ${horizonSql()} AS "horizonEff", ${resultSql()} AS "resultNorm",
  rv.followed_plan AS "followedPlan", COALESCE(rv.mistakes, '{}') AS mistakes, COALESCE(rv.lesson, '') AS lesson,
  rv.updated_at AS "reviewUpdatedAt"`;

export type TradeRow = {
  id: number; ticker: string; date: string; side: string | null; setup: string | null; result: string; session: string | null;
  pnl: number | null; fees: number | null; qty: number | null; entry: number | null; exit: number | null; stop: number | null;
  rMultiple: number | null; riskUsd: number | null; confidenceGrade: string | null; tags: string | null; conclusion: string | null;
  patternId: number | null; horizon: string | null; exitDate: string | null; source: string | null; externalId: string | null;
  r: number | null; net: number | null; closeDate: string; horizonEff: string; resultNorm: string | null;
  followedPlan: boolean | null; mistakes: string[]; lesson: string; reviewUpdatedAt: Date | null;
};

/** Trades that belong to the day's review: entered on `date` or realised (closed) on `date`. */
export async function loadDayTrades(trader: string, date: string): Promise<TradeRow[]> {
  const { rows } = await pool.query<TradeRow>(
    `SELECT ${TRADE_COLS}
       FROM trades t LEFT JOIN eod_trade_reviews rv ON rv.trade_id = t.id
      WHERE t.deleted_at IS NULL AND t.trader = $1
        AND (LEFT(t.date, 10) = $2 OR ${closeDateSql()} = $2)
      ORDER BY t.created_at ASC, t.id ASC`,
    [trader, date],
  );
  return rows;
}

/** Multi-day positions opened before `date` and still held on it (closed strictly later, or still open). */
export async function loadCarried(trader: string, date: string): Promise<TradeRow[]> {
  const { rows } = await pool.query<TradeRow>(
    `SELECT ${TRADE_COLS}
       FROM trades t LEFT JOIN eod_trade_reviews rv ON rv.trade_id = t.id
      WHERE t.deleted_at IS NULL AND t.trader = $1
        AND LEFT(t.date, 10) < $2
        AND (${horizonSql()} <> 'intraday' OR NULLIF(t.exit_date, '') IS NOT NULL)
        AND ((NULLIF(t.exit_date, '') IS NOT NULL AND t.exit_date > $2)
             OR (NULLIF(t.exit_date, '') IS NULL AND ${resultSql()} = 'open'))
      ORDER BY t.date ASC, t.id ASC`,
    [trader, date],
  );
  return rows;
}

type Totals = { trades: number; closed: number; open: number; gross: number | null; fees: number; net: number | null };
export function totals(rows: TradeRow[], date: string): Totals {
  let closed = 0, open = 0, gross: number | null = null, fees = 0, net: number | null = null;
  for (const t of rows) {
    if (t.resultNorm === "open" || t.resultNorm == null) { open++; continue; }
    if (t.closeDate !== date) continue; // entered today, realised later — not today's P&L
    closed++;
    if (t.pnl != null) {
      gross = (gross ?? 0) + t.pnl;
      fees += Math.abs(t.fees ?? 0);
      net = (net ?? 0) + (t.net ?? t.pnl);
    }
  }
  const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  return { trades: rows.length, closed, open, gross: r2(gross), fees: Math.round(fees * 100) / 100, net: r2(net) };
}

export async function loadPlanTickers(date: string): Promise<{ date: string; inPlay: Array<{ ticker: string; grade: string | null; horizon: string }> } | null> {
  try {
    const { rows } = await pool.query<{ in_play: unknown }>(
      `SELECT in_play FROM game_plans WHERE date = $1 AND deleted_at IS NULL LIMIT 1`,
      [date],
    );
    if (!rows[0]) return null;
    const raw = Array.isArray(rows[0].in_play) ? (rows[0].in_play as Array<Record<string, unknown>>) : [];
    return {
      date,
      inPlay: raw
        .filter((x) => x && typeof x.ticker === "string")
        .map((x) => ({
          ticker: String(x.ticker).toUpperCase(),
          grade: typeof x.grade === "string" ? x.grade : null,
          horizon: typeof x.horizon === "string" ? x.horizon : "intraday",
        })),
    };
  } catch {
    return null; // game_plans table may not exist yet
  }
}

// ── Streaks ───────────────────────────────────────────────────────────────────
export async function loadStreaks(trader: string, today: string): Promise<Streaks> {
  const [{ rows: closed }, { rows: days }] = await Promise.all([
    pool.query<{ date: string }>(`SELECT date FROM eod_days WHERE trader = $1 AND closed_at IS NOT NULL`, [trader]),
    pool.query<{ d: string; n: number; reviewed: number }>(
      `SELECT ${closeDateSql()} AS d, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE NULLIF(TRIM(t.setup), '') IS NOT NULL AND t.confidence_grade IS NOT NULL AND rv.followed_plan IS NOT NULL)::int AS reviewed
         FROM trades t LEFT JOIN eod_trade_reviews rv ON rv.trade_id = t.id
        WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closeDateSql()} <= $2
        GROUP BY 1`,
      [trader, today],
    ),
  ]);
  return computeStreaks({
    today,
    closedDates: new Set(closed.map((r) => r.date)),
    tradeDays: new Map(days.map((r) => [r.d, { n: r.n, reviewed: r.reviewed }])),
  });
}

