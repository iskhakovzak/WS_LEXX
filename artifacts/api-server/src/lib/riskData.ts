/**
 * Risk desk data access (moved out of routes/risk.ts so the PropReports positions tick and the risk alerts can use the
 * same numbers as the HTTP routes): limits, daily P&L per trader (broker rows win), drawdown baselines, the open book,
 * and the live positions snapshot (propreports_live_positions, migration 0221).
 *
 * Trading date = America/New_York (lib/tradingDate). P&L: net = pnl − |fees| (lib/tradeMath), realised on
 * COALESCE(exit_date, date).
 */
import { pool } from "@workspace/db";
import { nyDate, nyMinutes } from "./tradingDate";
import { signedRSql, netPnlSql, closeDateSql, horizonSql } from "./tradeMath";
import { num, round2, type DayRow, type Horizon, type Limits, type LiveSnapshot, type Position } from "./riskMetrics";
import { BoundedPromiseCache, onTradesPageInvalidate } from "./tradesPageCache";
import { NO_ADJ, adjChangesLimits, withRegimeLimits } from "./marketRegime/regimes";
import { regimeAdj } from "./marketRegime/store";

// ─── constants / helpers ────────────────────────────────────────────────────

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Overnight-book key time: 15:45 ET (minutes since NY midnight). */
export const OVERNIGHT_KEY_MINUTES = 15 * 60 + 45;
export const CLOSE_MINUTES = 16 * 60;

export function clientDate(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return YMD_RE.test(s) ? s : nyDate();
}

export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}


/** Whether "now" (NY) is past the overnight key time for the given trading date (false for other dates). */
export function afterKeyTime(date: string, now = new Date()): boolean {
  return date === nyDate(now) && nyMinutes(now) >= OVERNIGHT_KEY_MINUTES;
}


/** Optional trades columns (PropReports contract). Detected once; SQL degrades gracefully without them. */
let colsPromise: Promise<Set<string>> | null = null;
export function tradeColumns(): Promise<Set<string>> {
  if (!colsPromise) {
    colsPromise = pool
      .query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'trades'`)
      .then((r) => new Set(r.rows.map((x) => x.column_name)))
      .catch(() => { colsPromise = null; return new Set<string>(); });
  }
  return colsPromise;
}

export async function brokerSql(): Promise<string> {
  const cols = await tradeColumns();
  const parts: string[] = [];
  if (cols.has("source")) parts.push(`t.source = 'propreports'`);
  if (cols.has("context_snapshot")) parts.push(`t.context_snapshot ->> 'source' = 'propreports'`);
  return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
}

// ─── data access ────────────────────────────────────────────────────────────


export function toLimits(r: any): Limits {
  return {
    trader: String(r.trader),
    accountSize: num(r.account_size),
    dailyLossLimit: num(r.daily_loss_limit),
    weeklyLossLimit: num(r.weekly_loss_limit),
    maxDrawdown: num(r.max_drawdown),
    maxRiskPerTrade: num(r.max_risk_per_trade),
    maxPositionUsd: num(r.max_position_usd),
    maxOvernightExposure: num(r.max_overnight_exposure),
    maxOpenPositions: r.max_open_positions == null ? null : Number(r.max_open_positions),
    allowOvernight: r.allow_overnight !== false,
    allowSwing: r.allow_swing !== false,
    buyingPower: num(r.buying_power),
    openWindowLossLimit: num(r.open_window_loss_limit),
    tier: r.tier ?? null,
    notes: r.notes ?? null,
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

export async function loadLimits(trader: string | null): Promise<Map<string, Limits>> {
  const { rows } = await pool
    .query(`SELECT * FROM trader_risk_limits WHERE ($1::text IS NULL OR trader = $1)`, [trader])
    .catch(() => ({ rows: [] as any[] }));
  return new Map(rows.map((r: any) => [String(r.trader), toLimits(r)]));
}

/**
 * The limits the stops of `date` count against: the stored ones, with the daily loss limit × the desk regime's
 * multiplier while settings regime.applyLimits is on (lib/marketRegime). Stored limits are never changed, so the
 * edit form (/risk/limits) keeps the base and switching the setting off restores it at once.
 */
export async function loadEffectiveLimits(trader: string | null, date: string): Promise<Map<string, Limits>> {
  const [map, adj] = await Promise.all([loadLimits(trader), regimeAdj(date).catch(() => NO_ADJ)]);
  if (!adjChangesLimits(adj)) return map;
  return new Map([...map].map(([name, l]) => [name, withRegimeLimits(l, adj) ?? l]));
}


/**
 * Daily aggregates per trader, realised on close date. Broker rows win over journal rows for a day
 * (PropReports is the source of truth); journal numbers are used only on days with no broker data.
 * `only` = just these traders (index trades_live_trader_close_day_idx instead of a pass over the whole table).
 * Cached RISK_DAILY_TTL_MS per (trader, upTo, only) and cleared on every trade write (lib/tradesPageCache): the desk
 * page, the tick's live alerts and /risk/me ask for the same book several times a minute.
 */
export function loadDaily(trader: string | null, upTo: string, only?: readonly string[]): Promise<DayRow[]> {
  const key = JSON.stringify([trader, upTo, only ? [...only].sort() : null]);
  return riskDailyCache.getOrLoad(key, () => queryDaily(trader, upTo, only));
}

export const RISK_DAILY_TTL_MS = 30_000;
const riskDailyCache = new BoundedPromiseCache<DayRow[]>(RISK_DAILY_TTL_MS, 100);
onTradesPageInvalidate(() => riskDailyCache.clear());

async function queryDaily(trader: string | null, upTo: string, only?: readonly string[]): Promise<DayRow[]> {
  const broker = await brokerSql();
  // The broker test, net and close day are computed once per row in the subquery (they used to be repeated in every
  // FILTER). `is_broker` keeps its SQL NULL: NOT NULL is NULL, so such a row stays out of both sides, as before.
  const close = `LEFT(${closeDateSql("t")}, 10)`;
  const { rows } = await pool.query(
    `SELECT x.trader, x.d,
            SUM(x.net) FILTER (WHERE x.closed AND NOT x.is_broker)::float AS journal_net,
            COUNT(*) FILTER (WHERE x.closed AND NOT x.is_broker)::int AS journal_pnl_rows,
            SUM(x.net) FILTER (WHERE x.closed AND x.is_broker)::float AS broker_net,
            COUNT(*) FILTER (WHERE x.closed AND x.is_broker)::int AS broker_pnl_rows,
            COUNT(*) FILTER (WHERE x.is_broker)::int AS broker_trades,
            COALESCE(SUM(x.fee) FILTER (WHERE x.is_broker), 0)::float AS broker_fees,
            COALESCE(SUM(x.fee) FILTER (WHERE NOT x.is_broker), 0)::float AS journal_fees,
            COUNT(*)::int AS trades,
            COALESCE(SUM(x.r), 0)::float AS r
       FROM (
         SELECT t.trader, ${close} AS d, ${netPnlSql("t")} AS net, ABS(t.fees) AS fee, ${signedRSql("t")} AS r,
                (t.pnl IS NOT NULL AND LOWER(TRIM(t.result)) IS DISTINCT FROM 'open') AS closed,
                ${broker} AS is_broker
           FROM trades t
          WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND t.trader <> ''
            AND ($1::text IS NULL OR t.trader = $1)${only ? " AND t.trader = ANY($3::text[])" : ""}
            AND ${close} <= $2
       ) x
      GROUP BY x.trader, x.d
      ORDER BY x.d ASC`,
    only ? [trader, upTo, [...only]] : [trader, upTo],
  );
  return rows.map((r: any) => resolveDay(r));
}

/**
 * Drawdown baselines: NY days of curator reviews of drawdown breaches (not archived) per trader. computeMetrics resets
 * the peak at the latest one not after the trading date (lib/riskMetrics drawdownSince) — that lifts a reviewed halt.
 */
export async function loadDdResets(trader: string | null, only?: readonly string[]): Promise<Map<string, string[]>> {
  const { rows } = await pool.query<{ trader: string; d: string }>(
    `SELECT DISTINCT trader, to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d
       FROM risk_breach_reviews WHERE kind = 'drawdown' AND archived_at IS NULL
        AND ($1::text IS NULL OR trader = $1)${only ? " AND trader = ANY($2::text[])" : ""}`,
    only ? [trader, [...only]] : [trader],
  ).catch(() => ({ rows: [] as { trader: string; d: string }[] }));
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(String(r.trader));
    if (list) list.push(String(r.d));
    else out.set(String(r.trader), [String(r.d)]);
  }
  return out;
}

/** Pure: pick the day's P&L source (exported for the offline check). */
export function resolveDay(r: {
  trader: string; d: string; journal_net: unknown; journal_pnl_rows: unknown; broker_net: unknown; broker_pnl_rows: unknown;
  broker_trades: unknown; broker_fees: unknown; journal_fees: unknown; trades: unknown; r: unknown;
}): DayRow {
  const brokerTrades = Number(r.broker_trades) || 0;
  const brokerRows = Number(r.broker_pnl_rows) || 0;
  const journalRows = Number(r.journal_pnl_rows) || 0;
  const useBroker = brokerTrades > 0;
  const pnl = useBroker ? (brokerRows ? num(r.broker_net) : null) : journalRows ? num(r.journal_net) : null;
  return {
    trader: String(r.trader),
    date: String(r.d),
    pnl,
    source: useBroker ? "propreports" : pnl != null ? "journal" : null,
    trades: Number(r.trades) || 0,
    brokerTrades,
    r: Number(r.r) || 0,
    fees: useBroker ? Number(r.broker_fees) || 0 : Number(r.journal_fees) || 0,
  };
}


/** Pure: build a Position from a trades row (exported for the offline check). */
export function toPosition(p: any, today: string, afterKey: boolean): Position {
  const horizon: Horizon = p.horizon === "overnight" || p.horizon === "swing" ? p.horizon : "intraday";
  const qty = num(p.qty);
  const entry = num(p.entry);
  const stop = num(p.stop);
  const planned = num(p.risk_usd);
  const fromStop = entry != null && stop != null && qty != null ? Math.abs(entry - stop) * Math.abs(qty) : null;
  const date = String(p.date);
  const daysHeld = YMD_RE.test(date) ? daysBetween(date, today) : 0;
  const carried = horizon !== "intraday" || daysHeld > 0;
  const plannedAbs = planned != null ? Math.abs(planned) : null;
  const mismatch = plannedAbs != null && fromStop != null && Math.abs(plannedAbs - fromStop) > 0.25 * Math.max(plannedAbs, fromStop, 1);
  return {
    id: Number(p.id),
    ticker: String(p.ticker ?? ""),
    date,
    side: p.side ?? null,
    setup: p.setup ?? null,
    trader: String(p.trader),
    horizon,
    qty,
    entry,
    stop,
    daysHeld,
    // Prefer the live stop distance when it disagrees with a stale plan.
    riskUsd: mismatch && fromStop != null ? round2(fromStop) : plannedAbs != null ? round2(plannedAbs) : fromStop != null ? round2(fromStop) : null,
    riskSource: mismatch && fromStop != null ? "stop" : plannedAbs != null ? "planned" : fromStop != null ? "stop" : null,
    riskMismatch: mismatch,
    plannedRiskUsd: plannedAbs != null ? round2(plannedAbs) : null,
    stopRiskUsd: fromStop != null ? round2(fromStop) : null,
    exposureUsd: entry != null && qty != null ? round2(Math.abs(entry * qty)) : null,
    carried,
    carriedTonight: carried || afterKey,
    noStatus: !!p.no_status,
    source: p.is_broker ? "propreports" : "manual",
    sector: p.sector ?? null,
    atr: num(p.atr),
  };
}

export async function loadPositions(trader: string | null, today: string): Promise<Position[]> {
  const broker = await brokerSql();
  const { rows } = await pool.query(
    `SELECT t.id, t.ticker, LEFT(t.date, 10) AS date, t.side, t.setup, t.trader,
            ${horizonSql("t")} AS horizon,
            t.qty::float AS qty, t.risk_usd::float AS risk_usd,
            t.entry::float AS entry, t.stop::float AS stop,
            (t.result IS NULL OR TRIM(t.result) = '') AS no_status,
            ${broker} AS is_broker,
            c.sector AS sector, c.atr::float AS atr
     FROM trades t
     LEFT JOIN ticker_data_cache c ON c.ticker = UPPER(t.ticker)
     WHERE t.deleted_at IS NULL
       AND (LOWER(TRIM(t.result)) = 'open' OR ((t.result IS NULL OR TRIM(t.result) = '') AND NULLIF(t.exit_date, '') IS NULL AND t.exit IS NULL))
       AND t.trader IS NOT NULL AND ($1::text IS NULL OR t.trader = $1)
     ORDER BY t.date ASC, t.id ASC
     LIMIT 500`,
    [trader],
  );
  const afterKey = afterKeyTime(today);
  return rows.map((p: any) => toPosition(p, today, afterKey));
}

// ─── live positions (PropReports positions tick) ───────────────────────────

/**
 * Latest positions snapshot per trader for a trading date: unrealized summed over the trader's accounts, fetched_at =
 * the oldest account (so «обновлено N мин назад» never looks fresher than the stalest account). Degrades to an empty
 * map before migration 0221.
 */
export async function loadLiveSnapshots(date: string, traders: readonly string[] | null = null): Promise<Map<string, LiveSnapshot>> {
  const { rows } = await pool.query<{ trader: string; unrealized: number; open_count: number; fetched_at: Date | string }>(
    `SELECT trader, SUM(unrealized)::float AS unrealized, SUM(open_count)::int AS open_count, MIN(fetched_at) AS fetched_at
       FROM propreports_live_positions
      WHERE trading_date = $1 AND trader IS NOT NULL AND trader <> ''${traders ? " AND trader = ANY($2::text[])" : ""}
      GROUP BY trader`,
    traders ? [date, [...traders]] : [date],
  ).catch(() => ({ rows: [] as { trader: string; unrealized: number; open_count: number; fetched_at: Date | string }[] }));
  const out = new Map<string, LiveSnapshot>();
  for (const r of rows) {
    out.set(String(r.trader), {
      date,
      unrealizedUsd: round2(Number(r.unrealized) || 0),
      openPositions: Number(r.open_count) || 0,
      fetchedAt: new Date(r.fetched_at).toISOString(),
    });
  }
  return out;
}
