/**
 * «Мой edge» loaders — trades of one trader and the market data the app ALREADY stores. No provider / network calls.
 *
 *   trades            closed trades with a P&L in the window (close day), every one of the window with `pass` = the page
 *                     filters + «Разрезы» (the hidden ones still count in the day P&L before an entry); the trader's
 *                     earlier trades on the ticker over the whole book (window function)
 *   index daily bars  SPY / QQQ: analyst_bars_cache (daily) → candles_cache intraday rows → candle_archive (decoded),
 *                     regular hours only (lib/myEdge/market dailyFromIntraday)
 *   ticker daily bars analyst_bars_cache; a day it lacks → candle_archive bars + prev_close (gives the gap)
 *   earnings          finviz_earnings (coverage starts at its first date)       analyst   analyst_actions_cache (NY day)
 *   sector            finviz_ticker_snapshot                                    themes    market_themes (active)
 * Every optional table is probed with to_regclass: a missing one is «нет данных», never a 500.
 */
import { pool } from "@workspace/db";
import { closeDateSql, closedSql, horizonSql, netPnlSql } from "../tradeMath";
import { facetSqlTail, type FacetFilters } from "../tradeFacetsSql";
import { decodeBars } from "../candleArchive/codec";
import { dailyFromIntraday, type MeDailyBar, type MeIntradayBar } from "./market";
import type { MeTrade } from "./facts";

export type MeLoadFilters = {
  from?: string; to?: string; horizon?: string; side?: string; account?: string; source?: string; setup?: string; ticker?: string;
  facets?: FacetFilters;
};

const CLOSE_DAY = `substring(${closeDateSql("t")} from 1 for 10)`;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

type TradeRow = {
  id: number; day: string; entry_day: string; ticker: string; side: string; setup: string | null; strategy: string | null;
  entry: number | null; entry_sec: number | null; hold_sec: number | null; overnight: boolean | null; day_seq: number | null;
  prev_kind: string | null; size_rel: number | null; net: number; gross: number; fees: number; prior: number; pass: boolean;
};

/** SQL of the trades load (exported for the offline shape test). */
export function buildTradesQuery(trader: string, f: MeLoadFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [trader];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const win: string[] = [];
  if (f.from) win.push(`${CLOSE_DAY} >= ${p(f.from)}`);
  if (f.to) win.push(`${CLOSE_DAY} <= ${p(f.to)}`);
  const pass: string[] = [];
  if (f.horizon) pass.push(`${horizonSql("t")} = ${p(f.horizon)}`);
  if (f.side) pass.push(`lower(COALESCE(t.side, '')) LIKE ${p(f.side.toLowerCase().startsWith("s") ? "s%" : "l%")}`);
  if (f.account) pass.push(`t.broker_account = ${p(f.account)}`);
  if (f.source === "propreports") pass.push(`t.source = 'propreports'`);
  if (f.source === "manual") pass.push(`COALESCE(t.source, '') <> 'propreports'`);
  if (f.setup === "__none__") pass.push(`NULLIF(trim(t.setup), '') IS NULL`);
  else if (f.setup) pass.push(`t.setup = ${p(f.setup)}`);
  if (f.ticker) pass.push(`upper(t.ticker) = ${p(f.ticker.toUpperCase())}`);
  const facetTail = facetSqlTail(f.facets, params);
  const passSql = `(TRUE${pass.map((x) => ` AND ${x}`).join("")}${facetTail})`;
  const sql = `WITH book AS (
      SELECT t.id, (COUNT(*) OVER (PARTITION BY UPPER(TRIM(COALESCE(t.ticker, ''))) ORDER BY t.date, t.id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING))::int AS prior
        FROM trades t WHERE t.deleted_at IS NULL AND t.trader = $1
    )
    SELECT t.id, ${CLOSE_DAY} AS day, LEFT(t.date, 10) AS entry_day, UPPER(TRIM(COALESCE(t.ticker, ''))) AS ticker,
           LOWER(TRIM(COALESCE(t.side, ''))) AS side, t.setup, t.strategy, t.entry::float8 AS entry, t.entry_sec, t.hold_sec,
           t.overnight, t.day_seq, t.prev_kind, t.size_rel::float8 AS size_rel, ${netPnlSql("t")}::float8 AS net,
           t.pnl::float8 AS gross, ABS(COALESCE(t.fees, 0))::float8 AS fees, b.prior, ${passSql} AS pass
      FROM trades t JOIN book b ON b.id = t.id
     WHERE t.deleted_at IS NULL AND t.trader = $1 AND t.pnl IS NOT NULL AND ${closedSql("t")}
       AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}'${win.map((x) => ` AND ${x}`).join("")}
     ORDER BY t.date, t.id`;
  return { sql, params };
}

export async function loadMeTrades(trader: string, f: MeLoadFilters): Promise<MeTrade[]> {
  const { sql, params } = buildTradesQuery(trader, f);
  const { rows } = await pool.query<TradeRow>(sql, params);
  return rows.map((r) => ({
    id: Number(r.id), day: r.day, entryDay: r.entry_day, ticker: r.ticker,
    side: r.side.startsWith("s") ? "short" : r.side.startsWith("l") ? "long" : null,
    setup: r.setup, strategy: r.strategy, entry: num(r.entry), entrySec: num(r.entry_sec), holdSec: num(r.hold_sec),
    overnight: r.overnight, daySeq: num(r.day_seq), prevKind: r.prev_kind, sizeRel: num(r.size_rel),
    net: num(r.net) ?? 0, gross: num(r.gross) ?? 0, fees: num(r.fees) ?? 0, priorOnTicker: Number(r.prior) || 0, pass: !!r.pass,
  }));
}

const tableProbe = new Map<string, Promise<boolean>>();
function hasTable(name: string): Promise<boolean> {
  let p = tableProbe.get(name);
  if (!p) {
    p = pool.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`])
      .then((r) => !!r.rows[0]?.ok)
      .catch(() => { tableProbe.delete(name); return false; });
    tableProbe.set(name, p);
  }
  return p;
}

type RawDaily = { d?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown };
type RawIntra = { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown };

function dailyOf(raw: RawDaily): MeDailyBar | null {
  const day = typeof raw.d === "string" ? raw.d.slice(0, 10) : null;
  const o = num(raw.o), h = num(raw.h), l = num(raw.l), c = num(raw.c);
  if (!day || o == null || h == null || l == null || c == null) return null;
  return { day, o, h, l, c, v: num(raw.v) ?? 0 };
}

function intraOf(raw: RawIntra): MeIntradayBar | null {
  const t = num(raw.t), o = num(raw.o), h = num(raw.h), l = num(raw.l), c = num(raw.c);
  if (t == null || o == null || h == null || l == null || c == null) return null;
  return { t, o, h, l, c, v: num(raw.v) ?? 0 };
}

/** Daily bars of analyst_bars_cache per ticker (ascending). */
async function analystDaily(tickers: readonly string[]): Promise<Map<string, MeDailyBar[]>> {
  const out = new Map<string, MeDailyBar[]>();
  if (!tickers.length || !(await hasTable("analyst_bars_cache"))) return out;
  const { rows } = await pool.query<{ ticker: string; bars: unknown }>(`SELECT ticker, bars FROM analyst_bars_cache WHERE ticker = ANY($1::text[])`, [tickers]);
  for (const r of rows) {
    const list = (Array.isArray(r.bars) ? r.bars : []).map((b) => dailyOf(b as RawDaily)).filter((b): b is MeDailyBar => !!b);
    out.set(r.ticker, list.sort((a, b) => (a.day < b.day ? -1 : 1)));
  }
  return out;
}

/** Index (SPY / QQQ) daily bars over [from, to]: daily cache first, then the intraday caches (regular hours). */
export async function loadIndexDaily(symbol: string, from: string, to: string): Promise<MeDailyBar[]> {
  const byDay = new Map<string, MeDailyBar>();
  for (const b of (await analystDaily([symbol])).get(symbol) ?? []) if (b.day >= from && b.day <= to) byDay.set(b.day, b);
  const { rows } = await pool.query<{ date: string; ohlcv: unknown }>(
    `SELECT DISTINCT ON (date) date, ohlcv FROM candles_cache
      WHERE ticker = $1 AND interval IN ('1m', '5m', '15m', '30m', '60m') AND date BETWEEN $2 AND $3
      ORDER BY date, CASE interval WHEN '60m' THEN 1 WHEN '30m' THEN 2 WHEN '15m' THEN 3 WHEN '5m' THEN 4 ELSE 5 END, extended`,
    [symbol, from, to],
  );
  for (const r of rows) {
    if (byDay.has(r.date)) continue;
    const bars = (Array.isArray(r.ohlcv) ? r.ohlcv : []).map((b) => intraOf(b as RawIntra)).filter((b): b is MeIntradayBar => !!b);
    const d = dailyFromIntraday(r.date, bars);
    if (d) byDay.set(r.date, d);
  }
  const arch = await archiveDaily([{ symbol, from, to }]);
  for (const d of arch.get(symbol) ?? []) if (!byDay.has(d.day)) byDay.set(d.day, d);
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

const TF_ORDER = `CASE tf WHEN '60m' THEN 1 WHEN '30m' THEN 2 WHEN '15m' THEN 3 WHEN '5m' THEN 4 ELSE 5 END`;

type ArchRow = { symbol: string; day: string; payload: Buffer; prev_close: string | number | null };

function archToDaily(rows: readonly ArchRow[]): Map<string, MeDailyBar[]> {
  const out = new Map<string, MeDailyBar[]>();
  for (const r of rows) {
    let bars: MeIntradayBar[] = [];
    try { bars = decodeBars(r.payload).bars; } catch { continue; }
    const d = dailyFromIntraday(r.day, bars, num(r.prev_close));
    if (!d) continue;
    const list = out.get(r.symbol);
    if (list) list.push(d); else out.set(r.symbol, [d]);
  }
  return out;
}

/** Daily bars from the candle archive for symbol ranges (coarsest timeframe per day — cheapest to decode). */
async function archiveDaily(ranges: readonly { symbol: string; from: string; to: string }[]): Promise<Map<string, MeDailyBar[]>> {
  if (!ranges.length || !(await hasTable("candle_archive"))) return new Map();
  const { rows } = await pool.query<ArchRow>(
    `SELECT DISTINCT ON (a.symbol, a.day) a.symbol, a.day::text AS day, a.payload, a.prev_close
       FROM candle_archive a
       JOIN unnest($1::text[], $2::date[], $3::date[]) AS r(symbol, f, t) ON a.symbol = r.symbol AND a.day BETWEEN r.f AND r.t
      ORDER BY a.symbol, a.day, ${TF_ORDER}`,
    [ranges.map((r) => r.symbol), ranges.map((r) => r.from), ranges.map((r) => r.to)],
  );
  return archToDaily(rows);
}

/** Archive daily bars for exact (symbol, day) pairs. */
async function archivePairs(pairs: readonly { symbol: string; day: string }[]): Promise<Map<string, MeDailyBar[]>> {
  if (!pairs.length || !(await hasTable("candle_archive"))) return new Map();
  const { rows } = await pool.query<ArchRow>(
    `SELECT DISTINCT ON (a.symbol, a.day) a.symbol, a.day::text AS day, a.payload, a.prev_close
       FROM candle_archive a
       JOIN unnest($1::text[], $2::date[]) AS r(symbol, d) ON a.symbol = r.symbol AND a.day = r.d
      ORDER BY a.symbol, a.day, ${TF_ORDER}`,
    [pairs.map((r) => r.symbol), pairs.map((r) => r.day)],
  );
  return archToDaily(rows);
}

/** Ticker daily bars: the daily cache, plus archive-derived days for the trade days it lacks. */
export async function loadTickerDaily(pairs: readonly { ticker: string; day: string }[]): Promise<Map<string, MeDailyBar[]>> {
  const tickers = [...new Set(pairs.map((p) => p.ticker).filter(Boolean))];
  const out = await analystDaily(tickers);
  const missing: { symbol: string; day: string }[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const k = `${p.ticker}|${p.day}`;
    if (!p.ticker || seen.has(k)) continue;
    seen.add(k);
    if (!(out.get(p.ticker) ?? []).some((b) => b.day === p.day)) missing.push({ symbol: p.ticker, day: p.day });
  }
  const arch = await archivePairs(missing);
  for (const [sym, list] of arch) {
    const merged = [...(out.get(sym) ?? []), ...list].sort((a, b) => (a.day < b.day ? -1 : 1));
    out.set(sym, merged);
  }
  return out;
}

export async function loadEarnings(tickers: readonly string[]): Promise<{ days: Map<string, string[]>; coveredFrom: string | null }> {
  const days = new Map<string, string[]>();
  if (!(await hasTable("finviz_earnings"))) return { days, coveredFrom: null };
  const [{ rows }, cov] = await Promise.all([
    pool.query<{ ticker: string; date: string }>(`SELECT DISTINCT ticker, LEFT(date, 10) AS date FROM finviz_earnings WHERE ticker = ANY($1::text[])`, [tickers]),
    pool.query<{ min: string | null }>(`SELECT MIN(LEFT(date, 10)) AS min FROM finviz_earnings`),
  ]);
  for (const r of rows) {
    const l = days.get(r.ticker);
    if (l) l.push(r.date); else days.set(r.ticker, [r.date]);
  }
  return { days, coveredFrom: cov.rows[0]?.min ?? null };
}

export async function loadAnalyst(tickers: readonly string[]): Promise<Map<string, Map<string, string[]>>> {
  const out = new Map<string, Map<string, string[]>>();
  if (!tickers.length || !(await hasTable("analyst_actions_cache"))) return out;
  const { rows } = await pool.query<{ ticker: string; d: string; action: string }>(
    `SELECT ticker, ((graded_at AT TIME ZONE 'America/New_York')::date)::text AS d, LOWER(COALESCE(action, '')) AS action
       FROM analyst_actions_cache WHERE ticker = ANY($1::text[])`,
    [tickers],
  );
  for (const t of new Set(rows.map((r) => r.ticker))) out.set(t, new Map());
  for (const r of rows) {
    const m = out.get(r.ticker)!;
    const l = m.get(r.d);
    if (l) l.push(r.action); else m.set(r.d, [r.action]);
  }
  return out;
}

export async function loadSectors(tickers: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!tickers.length || !(await hasTable("finviz_ticker_snapshot"))) return out;
  const { rows } = await pool.query<{ ticker: string; sector: string }>(
    `SELECT ticker, sector FROM finviz_ticker_snapshot WHERE ticker = ANY($1::text[]) AND NULLIF(TRIM(sector), '') IS NOT NULL`,
    [tickers],
  );
  for (const r of rows) out.set(r.ticker, r.sector.trim());
  return out;
}

export async function loadThemes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!(await hasTable("market_themes"))) return out;
  const { rows } = await pool.query<{ name: string; tickers: string[] | null }>(
    `SELECT name, tickers FROM market_themes WHERE active IS NOT FALSE ORDER BY sort_order NULLS LAST, id`,
  );
  for (const r of rows) for (const t of r.tickers ?? []) {
    const k = String(t).trim().toUpperCase();
    if (k && !out.has(k)) out.set(k, r.name);
  }
  return out;
}
