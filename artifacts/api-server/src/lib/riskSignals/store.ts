/**
 * risk_signal_alerts (migration 0291) and the day context the detectors read: today's / past trades (the same rows
 * as the behaviour engine: lib/behaviorEngine via routes/behavior loadBehaviorRows), plans, restricted windows.
 * Every reader degrades to «nothing» before the migration / without the optional tables.
 */
import { pool } from "@workspace/db";
import { loadBehaviorRows, rowToBehaviorTrade } from "../../routes/behavior";
import { isSignal, type Hit, type HitStats, type PlanContext, type Signal, type SignalSeverity, type SignalTrade } from "./types";
import type { CalendarRow, MacroItem } from "./detect";

const none = <T>() => ({ rows: [] as T[] });

export type AlertRow = {
  id: number;
  trader: string;
  day: string;
  signal: Signal;
  level: string;
  severity: SignalSeverity;
  tradeId: number | null;
  triggeredAt: string;
  detectedAt: string;
  pnlAt: number | null;
  stats: HitStats;
  staffNotifiedAt: string | null;
  seenAt: string | null;
  restNet: number | null;
  baselineRest: number | null;
  baselineN: number | null;
  saved: number | null;
  settledAt: string | null;
};

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const numOrNull = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function toRow(r: any): AlertRow | null {
  if (!isSignal(r.signal)) return null;
  return {
    id: Number(r.id), trader: String(r.trader), day: String(r.day), signal: r.signal, level: String(r.level),
    severity: r.severity === "critical" ? "critical" : "warn", tradeId: r.trade_id == null ? null : Number(r.trade_id),
    triggeredAt: iso(r.triggered_at)!, detectedAt: iso(r.detected_at)!, pnlAt: numOrNull(r.pnl_at),
    stats: r.stats && typeof r.stats === "object" ? r.stats : {}, staffNotifiedAt: iso(r.staff_notified_at), seenAt: iso(r.seen_at),
    restNet: numOrNull(r.rest_net), baselineRest: numOrNull(r.baseline_rest), baselineN: r.baseline_n == null ? null : Number(r.baseline_n),
    saved: numOrNull(r.saved_usd), settledAt: iso(r.settled_at),
  };
}
const rowsOf = (rows: any[]): AlertRow[] => rows.map(toRow).filter((r): r is AlertRow => r != null);

/** Inserts the alert unless (trader, day, signal, level) already fired. Returns the new row, null when it existed. */
export async function insertAlert(trader: string, day: string, h: Hit, pnlAt: number | null): Promise<AlertRow | null> {
  const { rows } = await pool.query(
    `INSERT INTO risk_signal_alerts (trader, day, signal, level, severity, trade_id, triggered_at, pnl_at, stats)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (trader, day, signal, level) DO NOTHING
     RETURNING *`,
    [trader, day, h.signal, h.level.slice(0, 40), h.severity, h.tradeId, new Date(h.at).toISOString(), pnlAt, JSON.stringify(h.stats)],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** (trader|signal|level) already stored for the day — the scan's in-memory dedup is filled from here after a restart. */
export async function firedKeys(day: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ trader: string; signal: string; level: string }>(
    `SELECT trader, signal, level FROM risk_signal_alerts WHERE day = $1`, [day],
  ).catch(() => none<{ trader: string; signal: string; level: string }>());
  return new Set(rows.map((r) => `${r.trader}|${r.signal}|${r.level}`));
}

/** Claims the staff notice of one alert (true once). */
export async function claimStaffNotice(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`UPDATE risk_signal_alerts SET staff_notified_at = now() WHERE id = $1 AND staff_notified_at IS NULL`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function markSeen(id: number, trader: string): Promise<AlertRow | null> {
  const { rows } = await pool.query(
    `UPDATE risk_signal_alerts SET seen_at = COALESCE(seen_at, now()) WHERE id = $1 AND trader = $2 RETURNING *`, [id, trader],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Alerts of a day (one trader or the whole desk), newest first. */
export async function alertsOfDay(day: string, trader: string | null): Promise<AlertRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM risk_signal_alerts WHERE day = $1 AND ($2::text IS NULL OR trader = $2) ORDER BY triggered_at DESC, id DESC LIMIT 500`,
    [day, trader],
  ).catch(() => none<any>());
  return rowsOf(rows);
}

export async function alertsBetween(from: string, to: string, trader: string | null): Promise<AlertRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM risk_signal_alerts WHERE day BETWEEN $1 AND $2 AND ($3::text IS NULL OR trader = $3) ORDER BY day DESC, triggered_at DESC LIMIT 5000`,
    [from, to, trader],
  ).catch(() => none<any>());
  return rowsOf(rows);
}

export async function unsettled(): Promise<AlertRow[]> {
  const { rows } = await pool.query(`SELECT * FROM risk_signal_alerts WHERE settled_at IS NULL ORDER BY day ASC, id ASC LIMIT 500`).catch(() => none<any>());
  return rowsOf(rows);
}

/** Days in [from, to] on which the trader had an alert of `signal` (excluded from the history baseline). */
export async function alertDays(trader: string, signal: Signal, from: string, to: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ day: string }>(
    `SELECT DISTINCT day FROM risk_signal_alerts WHERE trader = $1 AND signal = $2 AND day BETWEEN $3 AND $4`, [trader, signal, from, to],
  ).catch(() => none<{ day: string }>());
  return new Set(rows.map((r) => String(r.day)));
}

export async function saveSettlement(id: number, s: { rest: number; baselineRest: number | null; cases: number; saved: number | null }): Promise<void> {
  await pool.query(
    `UPDATE risk_signal_alerts SET rest_net = $2, baseline_rest = $3, baseline_n = $4, saved_usd = $5, settled_at = now() WHERE id = $1`,
    [id, s.rest, s.baselineRest, s.cases, s.saved],
  );
}

// ─── day context ────────────────────────────────────────────────────────────

/** Trades entered on [from, to] per trader → day → SignalTrade[] (playbook link added). */
export async function signalTrades(from: string, to: string, traders: readonly string[]): Promise<Map<string, Map<string, SignalTrade[]>>> {
  const out = new Map<string, Map<string, SignalTrade[]>>();
  if (!traders.length) return out;
  const rows = await loadBehaviorRows(null, from, to, undefined, [...traders]);
  const ids = rows.map((r) => Number(r.id));
  const links = ids.length
    ? await pool.query<{ id: number; playbook_id: number }>(`SELECT id, playbook_id FROM trades WHERE id = ANY($1::int[]) AND playbook_id IS NOT NULL`, [ids]).catch(() => none<{ id: number; playbook_id: number }>())
    : none<{ id: number; playbook_id: number }>();
  const pb = new Map(links.rows.map((r) => [Number(r.id), Number(r.playbook_id)]));
  for (const r of rows) {
    if (!r.trader) continue;
    const b = rowToBehaviorTrade(r);
    const t: SignalTrade = {
      id: b.id, ticker: b.ticker, result: b.result, net: b.net, qty: b.qty, entry: b.entry, entryAt: b.entryAt, exitAt: b.exitAt,
      entryMin: b.entryMin, playbookId: pb.get(b.id) ?? null,
    };
    const byDay = out.get(r.trader) ?? new Map<string, SignalTrade[]>();
    const list = byDay.get(b.date);
    if (list) list.push(t);
    else byDay.set(b.date, [t]);
    out.set(r.trader, byDay);
  }
  return out;
}

/** Traders with a trade entered or closed today, or a live positions snapshot of today. */
export async function activeTraders(day: string): Promise<string[]> {
  const [trades, live] = await Promise.all([
    pool.query<{ trader: string }>(
      `SELECT DISTINCT trader FROM trades WHERE deleted_at IS NULL AND trader IS NOT NULL AND trader <> ''
          AND (substring(date, 1, 10) = $1 OR substring(exit_date, 1, 10) = $1)`, [day],
    ).catch(() => none<{ trader: string }>()),
    pool.query<{ trader: string }>(`SELECT DISTINCT trader FROM propreports_live_positions WHERE trading_date = $1 AND trader IS NOT NULL AND trader <> ''`, [day])
      .catch(() => none<{ trader: string }>()),
  ]);
  return [...new Set([...trades.rows, ...live.rows].map((r) => String(r.trader)))];
}

const tickersOf = (inPlay: unknown): string[] =>
  Array.isArray(inPlay)
    ? inPlay.map((x) => (x && typeof x === "object" ? String((x as { ticker?: unknown }).ticker ?? "").trim().toUpperCase() : "")).filter(Boolean)
    : [];
const macroOf = (v: unknown): MacroItem[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as MacroItem[] : []);

export type DayExtras = {
  /** trader → day → plan (own plan rows only). */
  plans: Map<string, Map<string, NonNullable<PlanContext>>>;
  /** trader → day → own plan macro items. */
  ownMacro: Map<string, Map<string, MacroItem[]>>;
  /** day → desk plan macro items. */
  deskMacro: Map<string, MacroItem[]>;
  /** day → market calendar rows. */
  calendar: Map<string, CalendarRow[]>;
};

/**
 * Plans and event sources of [from, to]: own trader_plans (tickers = own in-play ∪ the desk plan's in-play, setups =
 * the day's playbook picks), the desk game plan's macro, holiday_calendar rows.
 */
export async function dayExtras(from: string, to: string, traders: readonly string[]): Promise<DayExtras> {
  const [own, desk, cal] = await Promise.all([
    traders.length
      ? pool.query<{ trader: string; date: string; doc: any }>(
        `SELECT trader, date, doc FROM trader_plans WHERE deleted_at IS NULL AND trader = ANY($1::text[]) AND date BETWEEN $2 AND $3`, [[...traders], from, to],
      ).catch(() => none<{ trader: string; date: string; doc: any }>())
      : none<{ trader: string; date: string; doc: any }>(),
    pool.query<{ date: string; in_play: unknown; macro: unknown }>(
      `SELECT date, in_play, macro FROM game_plans WHERE deleted_at IS NULL AND date BETWEEN $1 AND $2`, [from, to],
    ).catch(() => none<{ date: string; in_play: unknown; macro: unknown }>()),
    pool.query<{ d: string } & CalendarRow>(
      `SELECT date::text AS d, type, name, description, importance FROM holiday_calendar WHERE date::text BETWEEN $1 AND $2`, [from, to],
    ).catch(() => none<{ d: string } & CalendarRow>()),
  ]);
  const deskTickers = new Map<string, string[]>();
  const deskMacro = new Map<string, MacroItem[]>();
  for (const r of desk.rows) {
    const d = String(r.date).slice(0, 10);
    deskTickers.set(d, [...(deskTickers.get(d) ?? []), ...tickersOf(r.in_play)]);
    deskMacro.set(d, [...(deskMacro.get(d) ?? []), ...macroOf(r.macro)]);
  }
  const plans = new Map<string, Map<string, NonNullable<PlanContext>>>();
  const ownMacro = new Map<string, Map<string, MacroItem[]>>();
  for (const r of own.rows) {
    const d = String(r.date).slice(0, 10);
    const doc = r.doc && typeof r.doc === "object" ? r.doc : {};
    const mine = tickersOf(doc.inPlay);
    const setups = Array.isArray(doc.setups) ? doc.setups.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0) : [];
    // A plan without own tickers and picks says nothing about what is off-plan: no plan for this signal.
    if (mine.length || setups.length) {
      const byDay = plans.get(r.trader) ?? new Map<string, NonNullable<PlanContext>>();
      byDay.set(d, { tickers: new Set(mine.length ? [...mine, ...(deskTickers.get(d) ?? [])] : []), setups: new Set(setups) });
      plans.set(r.trader, byDay);
    }
    const m = ownMacro.get(r.trader) ?? new Map<string, MacroItem[]>();
    m.set(d, macroOf(doc.macro));
    ownMacro.set(r.trader, m);
  }
  const calendar = new Map<string, CalendarRow[]>();
  for (const r of cal.rows) calendar.set(String(r.d), [...(calendar.get(String(r.d)) ?? []), r]);
  return { plans, ownMacro, deskMacro, calendar };
}
