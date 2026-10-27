/**
 * Data of the lab's multi-trade views (/chart-lab «Наложение», «Выходы»): the trader's closed intraday trades of one
 * setup / ticker (or all) with the first entry fill time, and the archived bars of their days. Bars come ONLY from the
 * candle archive (candle_archive, lib/candleArchive/store getArchivedDays) — no provider call: a day that was never
 * archived is reported as missing, never fetched.
 */
import { pool } from "@workspace/db";
import { execSpanJoin } from "../execSpan";
import { getArchivedDays } from "../candleArchive/store";
import { TF_SEC } from "../candleArchive/days";
import { rthBounds } from "../candleDay";
import { num } from "../tradeMath";
import type { DayBars, LabBar } from "./exitMath";

export interface LabTrade {
  id: number;
  ticker: string;
  day: string;
  setup: string | null;
  side: 1 | -1;
  qty: number;
  entry: number;
  exit: number | null;
  entryAt: number;
  riskPerShare: number | null;
  /** Net $ of the real trade (gross − fees). */
  net: number | null;
}

/** At most this many trades per request (the newest): bounds the archive reads. */
export const LAB_MAX_TRADES = 300;

export interface LabFilter { trader: string; setup?: string | null; ticker?: string | null; from?: string | null; to?: string | null }

type Row = {
  id: number; ticker: string; date: string; exit_date: string | null; side: string | null; qty: unknown; entry: unknown; exit: unknown;
  stop: unknown; risk_usd: unknown; pnl: unknown; fees: unknown; setup: string | null; first_entry: Date | string | null;
};

/** Side from the stored text; null when unknown. */
export function sideOf(raw: string | null): 1 | -1 | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return s.startsWith("s") ? -1 : s.startsWith("l") || s.startsWith("b") ? 1 : null;
}

/** Stop distance per share: |entry − stop|, else risk $ / qty; null when neither is usable. */
export function riskPerShareOf(entry: number, stop: number | null, riskUsd: number | null, qty: number): number | null {
  if (stop != null && stop > 0 && Math.abs(entry - stop) > 1e-9) return Math.abs(entry - stop);
  if (riskUsd != null && riskUsd > 0 && qty > 0) return riskUsd / qty;
  return null;
}

export function rowToLab(r: Row): LabTrade | null {
  const side = sideOf(r.side);
  const qty = Math.abs(num(r.qty) ?? 0);
  const entry = num(r.entry);
  const first = r.first_entry ? new Date(r.first_entry) : null;
  if (side == null || !(qty > 0) || entry == null || !(entry > 0) || !first || Number.isNaN(first.getTime())) return null;
  // Intraday only: an overnight hold's exit is not in the day's bars.
  if (r.exit_date && r.exit_date.slice(0, 10) !== r.date.slice(0, 10)) return null;
  const pnl = num(r.pnl);
  return {
    id: r.id, ticker: String(r.ticker).toUpperCase(), day: r.date.slice(0, 10), setup: r.setup?.trim() || null, side, qty, entry,
    exit: num(r.exit), entryAt: Math.floor(first.getTime() / 1000),
    riskPerShare: riskPerShareOf(entry, num(r.stop), num(r.risk_usd), qty),
    net: pnl == null ? null : pnl - Math.abs(num(r.fees) ?? 0),
  };
}

export async function loadLabTrades(f: LabFilter): Promise<LabTrade[]> {
  const params: unknown[] = [f.trader];
  const cond = [`t.trader = $1`, `t.deleted_at IS NULL`, `t.pnl IS NOT NULL`, `LOWER(TRIM(t.result)) <> 'open'`];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.setup) cond.push(`LOWER(TRIM(t.setup)) = LOWER(${p(f.setup.trim())})`);
  if (f.ticker) cond.push(`UPPER(t.ticker) = ${p(f.ticker.trim().toUpperCase())}`);
  if (f.from) cond.push(`substring(t.date from 1 for 10) >= ${p(f.from)}`);
  if (f.to) cond.push(`substring(t.date from 1 for 10) <= ${p(f.to)}`);
  const { rows } = await pool.query<Row>(
    `SELECT t.id, t.ticker, t.date, t.exit_date, t.side, t.qty, t.entry, t.exit, t.stop, t.risk_usd, t.pnl, t.fees, t.setup, e.first_entry
       FROM trades t ${execSpanJoin("lateral")}
      WHERE ${cond.join(" AND ")} AND e.first_entry IS NOT NULL
      ORDER BY substring(t.date from 1 for 10) DESC, e.first_entry DESC
      LIMIT ${LAB_MAX_TRADES}`,
    params,
  );
  return rows.map(rowToLab).filter((t): t is LabTrade => t != null);
}

/** Setups and tickers of the trader with their trade counts (the picker), most traded first. */
export async function labFacets(trader: string): Promise<{ setups: { name: string; n: number }[]; tickers: { name: string; n: number }[] }> {
  const q = (col: string) => pool.query<{ name: string; n: string }>(
    `SELECT ${col} AS name, COUNT(*)::text AS n FROM trades t
      WHERE t.trader = $1 AND t.deleted_at IS NULL AND t.pnl IS NOT NULL AND ${col} IS NOT NULL AND TRIM(${col}) <> ''
      GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT 40`,
    [trader],
  );
  const [s, k] = await Promise.all([q("TRIM(t.setup)"), q("UPPER(t.ticker)")]);
  const map = (rows: { name: string; n: string }[]) => rows.map((r) => ({ name: r.name, n: Number(r.n) }));
  return { setups: map(s.rows), tickers: map(k.rows) };
}

/** Archived bars of every trade's day (key `TICKER|day`); a day missing from the archive is absent from the map. */
export async function loadLabBars(trades: LabTrade[]): Promise<Map<string, DayBars>> {
  const byTicker = new Map<string, Set<string>>();
  for (const t of trades) {
    const s = byTicker.get(t.ticker) ?? new Set<string>();
    s.add(t.day);
    byTicker.set(t.ticker, s);
  }
  const out = new Map<string, DayBars>();
  await Promise.all([...byTicker.entries()].map(async ([ticker, days]) => {
    const got = await getArchivedDays(ticker, [...days]);
    for (const [day, a] of got) {
      const bars: LabBar[] = a.bars.filter((b) => Number.isFinite(b.o) && Number.isFinite(b.c) && b.h >= b.l).sort((x, y) => x.t - y.t);
      if (bars.length) out.set(`${ticker}|${day}`, { bars, barSec: TF_SEC[a.tf], closeAt: rthBounds(day).close });
    }
  }));
  return out;
}
