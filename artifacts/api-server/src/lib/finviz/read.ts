/**
 * Finviz tables — reads for routes/finviz.ts and for the snapshot-first fundamentals (offerings / watchlist /
 * catalyst code, ./fundamentals.ts). DB only, never a Finviz call.
 */
import { db } from "./store";
import type { EarningsRow, EarningsTiming, FinvizStatus, ScreenerPreset, ScreenerResponse, ScreenerRow, TickerSnapshot } from "./types";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const timing = (v: unknown): EarningsTiming | null => (v === "bmo" || v === "amc" ? v : null);
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export async function readStatus(enabled: boolean): Promise<FinvizStatus> {
  const { rows } = await db().query(
    `SELECT kind, MAX(finished_at) AS at FROM finviz_runs WHERE status = 'ok' GROUP BY kind`,
  );
  const at = new Map(rows.map((r) => [String(r.kind), iso(r.at)]));
  return {
    enabled,
    lastScreenAt: at.get("screener") ?? null,
    lastSnapshotAt: at.get("snapshot") ?? null,
    lastEarningsAt: at.get("earnings") ?? null,
  };
}

function screenerRowOf(r: Record<string, unknown>): ScreenerRow {
  return {
    ticker: String(r.ticker),
    company: str(r.company),
    sector: str(r.sector),
    price: num(r.price),
    changePct: num(r.change_pct),
    gapPct: num(r.gap_pct),
    relVolume: num(r.rel_volume),
    volume: num(r.volume),
    avgVolume: num(r.avg_volume),
    float: num(r.float_shares),
    shortFloatPct: num(r.short_float_pct),
    atr: num(r.atr),
    marketCap: num(r.market_cap),
    earningsDate: str(r.earnings_date),
    earningsTiming: timing(r.earnings_timing),
  };
}

/** The rows of the preset's latest successful run (rank order). */
export async function readScreener(preset: ScreenerPreset): Promise<ScreenerResponse> {
  const { rows: runs } = await db().query(
    `SELECT id, finished_at FROM finviz_runs WHERE kind = 'screener' AND preset = $1 AND status = 'ok'
      ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`,
    [preset],
  );
  const run = runs[0];
  if (!run) return { asOf: null, preset, rows: [] };
  const { rows } = await db().query(
    `SELECT * FROM finviz_screener_rows WHERE last_run_id = $1 ORDER BY rank, ticker`,
    [run.id],
  );
  return { asOf: iso(run.finished_at), preset, rows: rows.map(screenerRowOf) };
}

function snapshotOf(r: Record<string, unknown>): TickerSnapshot {
  return {
    ticker: String(r.ticker),
    company: str(r.company),
    sector: str(r.sector),
    industry: str(r.industry),
    country: str(r.country),
    marketCap: num(r.market_cap),
    float: num(r.float_shares),
    shortFloatPct: num(r.short_float_pct),
    shortRatio: num(r.short_ratio),
    avgVolume: num(r.avg_volume),
    relVolume: num(r.rel_volume),
    atr: num(r.atr),
    beta: num(r.beta),
    earningsDate: str(r.earnings_date),
    earningsTiming: timing(r.earnings_timing),
    asOf: iso(r.as_of)!,
  };
}

/** Stored snapshot (null: none, or only a pending request). */
export async function readSnapshot(ticker: string): Promise<TickerSnapshot | null> {
  const { rows } = await db().query(`SELECT * FROM finviz_ticker_snapshot WHERE ticker = $1 AND as_of IS NOT NULL`, [ticker]);
  return rows[0] ? snapshotOf(rows[0]) : null;
}

/** Snapshot + the extra columns item-4 callers need (shares outstanding, price), for many tickers not older than maxAgeDays. */
export type SnapshotFull = TickerSnapshot & { sharesOutstanding: number | null; price: number | null };
export async function readSnapshots(tickers: readonly string[], maxAgeDays: number): Promise<Map<string, SnapshotFull>> {
  const out = new Map<string, SnapshotFull>();
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) return out;
  const { rows } = await db().query(
    `SELECT * FROM finviz_ticker_snapshot
      WHERE ticker = ANY($1::text[]) AND as_of IS NOT NULL AND as_of > now() - make_interval(days => $2::int)`,
    [list, Math.max(1, Math.round(maxAgeDays))],
  );
  for (const r of rows) out.set(String(r.ticker), { ...snapshotOf(r), sharesOutstanding: num(r.shares_outstanding), price: num(r.price) });
  return out;
}

const earningsOf = (r: Record<string, unknown>): EarningsRow => ({
  ticker: String(r.ticker),
  date: String(r.date),
  timing: timing(r.timing),
  company: str(r.company),
  marketCap: num(r.market_cap),
});

const EARNINGS_ORDER = `ORDER BY date, CASE timing WHEN 'bmo' THEN 0 WHEN 'amc' THEN 1 ELSE 2 END, market_cap DESC NULLS LAST, ticker`;

export async function readEarnings(from: string, to: string): Promise<EarningsRow[]> {
  const { rows } = await db().query(
    `SELECT ticker, date, timing, company, market_cap FROM finviz_earnings
      WHERE date BETWEEN $1 AND $2 AND superseded_at IS NULL ${EARNINGS_ORDER} LIMIT 5000`,
    [from, to],
  );
  return rows.map(earningsOf);
}

/** Given tickers reporting `today` (any timing) or on `nextDay` before the open. */
export async function readEarningsSoon(tickers: readonly string[], today: string, nextDay: string): Promise<EarningsRow[]> {
  if (!tickers.length) return [];
  const { rows } = await db().query(
    `SELECT ticker, date, timing, company, market_cap FROM finviz_earnings
      WHERE ticker = ANY($1::text[]) AND superseded_at IS NULL AND (date = $2 OR (date = $3 AND timing = 'bmo'))
      ${EARNINGS_ORDER}`,
    [tickers, today, nextDay],
  );
  return rows.map(earningsOf);
}
