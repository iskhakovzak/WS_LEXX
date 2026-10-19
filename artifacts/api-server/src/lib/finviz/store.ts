/**
 * Finviz tables (migration 0223) — writes. Reads for the API are in ./read.ts. Every function takes the pool from
 * `db()` (tests inject a scratch database with setFinvizDb). Nothing is ever deleted.
 */
import { pool } from "@workspace/db";
import type { FinvizRow } from "./csv";
import type { EarningsTiming, ScreenerPreset } from "./types";

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
let dbRef: Q = pool as unknown as Q;

/** Tests: use another pool. Returns a restore function. */
export function setFinvizDb(q: Q): () => void {
  const prev = dbRef;
  dbRef = q;
  return () => {
    dbRef = prev;
  };
}
export const db = (): Q => dbRef;

export type RunKind = "screener" | "snapshot" | "earnings";

export async function startRun(kind: RunKind, preset: ScreenerPreset | null, trigger: string, nyDay: string): Promise<number> {
  const { rows } = await db().query(
    `INSERT INTO finviz_runs (kind, preset, trigger, ny_day) VALUES ($1, $2, $3, $4) RETURNING id`,
    [kind, preset, trigger, nyDay],
  );
  return Number(rows[0].id);
}

export async function finishRun(id: number, status: "ok" | "error", rowCount: number, error: string | null = null): Promise<void> {
  await db().query(
    `UPDATE finviz_runs SET status = $2, row_count = $3, error = $4, finished_at = now() WHERE id = $1`,
    [id, status, rowCount, error ? error.slice(0, 2000) : null],
  );
}

const big = (n: number | null): string | null => (n == null ? null : String(Math.round(n)));

/** Ranked rows of one preset run → finviz_screener_rows (upsert per preset / day / ticker). */
export async function saveScreenerRows(runId: number, preset: ScreenerPreset, nyDay: string, rows: readonly FinvizRow[]): Promise<void> {
  if (!rows.length) return;
  const cols = 19;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(
      preset, nyDay, r.ticker, runId, i + 1, r.company, r.sector, r.price, r.changePct, r.gapPct, r.relVolume,
      big(r.volume), big(r.avgVolume), big(r.float), r.shortFloatPct, r.atr, big(r.marketCap), r.earningsDate, r.earningsTiming,
    );
    const base = i * cols;
    return `(${Array.from({ length: cols }, (_, k) => `$${base + k + 1}`).join(",")})`;
  });
  await db().query(
    `INSERT INTO finviz_screener_rows (preset, ny_day, ticker, last_run_id, rank, company, sector, price, change_pct, gap_pct,
       rel_volume, volume, avg_volume, float_shares, short_float_pct, atr, market_cap, earnings_date, earnings_timing)
     VALUES ${tuples.join(",")}
     ON CONFLICT (preset, ny_day, ticker) DO UPDATE SET
       last_run_id = EXCLUDED.last_run_id, rank = EXCLUDED.rank, company = EXCLUDED.company, sector = EXCLUDED.sector,
       price = EXCLUDED.price, change_pct = EXCLUDED.change_pct, gap_pct = EXCLUDED.gap_pct, rel_volume = EXCLUDED.rel_volume,
       volume = EXCLUDED.volume, avg_volume = EXCLUDED.avg_volume, float_shares = EXCLUDED.float_shares,
       short_float_pct = EXCLUDED.short_float_pct, atr = EXCLUDED.atr, market_cap = EXCLUDED.market_cap,
       earnings_date = EXCLUDED.earnings_date, earnings_timing = EXCLUDED.earnings_timing, last_seen_at = now()`,
    values,
  );
}

/**
 * Rows → finviz_ticker_snapshot (upsert). A value Finviz left empty does not erase a stored one (COALESCE), except
 * earnings, which follow the latest row. Also feeds the earnings calendar with every known upcoming date.
 */
export async function upsertSnapshots(rows: readonly FinvizRow[], source: "snapshot" | "screener"): Promise<number> {
  if (!rows.length) return 0;
  const cols = 19;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(
      r.ticker, r.company, r.sector, r.industry, r.country, big(r.marketCap), big(r.sharesOutstanding), big(r.float),
      r.shortFloatPct, r.shortRatio, big(r.avgVolume), r.relVolume, r.atr, r.beta, r.price, r.earningsDate, r.earningsTiming,
      source, null,
    );
    const base = i * cols;
    return `(${Array.from({ length: cols }, (_, k) => `$${base + k + 1}`).join(",")}, now())`;
  });
  await db().query(
    `INSERT INTO finviz_ticker_snapshot (ticker, company, sector, industry, country, market_cap, shares_outstanding,
       float_shares, short_float_pct, short_ratio, avg_volume, rel_volume, atr, beta, price, earnings_date, earnings_timing,
       source, not_found_at, as_of)
     VALUES ${tuples.join(",")}
     ON CONFLICT (ticker) DO UPDATE SET
       company = COALESCE(EXCLUDED.company, finviz_ticker_snapshot.company),
       sector = COALESCE(EXCLUDED.sector, finviz_ticker_snapshot.sector),
       industry = COALESCE(EXCLUDED.industry, finviz_ticker_snapshot.industry),
       country = COALESCE(EXCLUDED.country, finviz_ticker_snapshot.country),
       market_cap = COALESCE(EXCLUDED.market_cap, finviz_ticker_snapshot.market_cap),
       shares_outstanding = COALESCE(EXCLUDED.shares_outstanding, finviz_ticker_snapshot.shares_outstanding),
       float_shares = COALESCE(EXCLUDED.float_shares, finviz_ticker_snapshot.float_shares),
       short_float_pct = COALESCE(EXCLUDED.short_float_pct, finviz_ticker_snapshot.short_float_pct),
       short_ratio = COALESCE(EXCLUDED.short_ratio, finviz_ticker_snapshot.short_ratio),
       avg_volume = COALESCE(EXCLUDED.avg_volume, finviz_ticker_snapshot.avg_volume),
       rel_volume = COALESCE(EXCLUDED.rel_volume, finviz_ticker_snapshot.rel_volume),
       atr = COALESCE(EXCLUDED.atr, finviz_ticker_snapshot.atr),
       beta = COALESCE(EXCLUDED.beta, finviz_ticker_snapshot.beta),
       price = COALESCE(EXCLUDED.price, finviz_ticker_snapshot.price),
       earnings_date = EXCLUDED.earnings_date, earnings_timing = EXCLUDED.earnings_timing,
       source = EXCLUDED.source, not_found_at = NULL, as_of = now()`,
    values,
  );
  const dated = rows.filter((r) => r.earningsDate).map((r) => ({
    ticker: r.ticker, date: r.earningsDate!, timing: r.earningsTiming, company: r.company, marketCap: r.marketCap,
  }));
  await upsertEarnings(dated);
  return rows.length;
}

/** GET /ticker miss → a placeholder row the snapshot-pending job fills (only tickers never fetched or not-found long ago). */
export async function requestTicker(ticker: string): Promise<void> {
  await db().query(
    `INSERT INTO finviz_ticker_snapshot (ticker, requested_at) VALUES ($1, now())
     ON CONFLICT (ticker) DO UPDATE SET requested_at = now()
       WHERE finviz_ticker_snapshot.as_of IS NULL AND finviz_ticker_snapshot.requested_at < now() - interval '10 minutes'`,
    [ticker],
  );
}

/** Requested tickers not fetched yet (oldest first), skipping ones Finviz did not know in the last 24 h. */
export async function pendingTickers(limit: number): Promise<string[]> {
  const { rows } = await db().query(
    `SELECT ticker FROM finviz_ticker_snapshot
      WHERE as_of IS NULL AND requested_at IS NOT NULL AND (not_found_at IS NULL OR not_found_at < now() - interval '24 hours')
      ORDER BY requested_at LIMIT $1`,
    [limit],
  );
  return rows.map((r) => String(r.ticker));
}

/** Tickers asked for but missing from Finviz's answer (delisted / OTC / typo). */
export async function markNotFound(tickers: readonly string[]): Promise<void> {
  if (!tickers.length) return;
  await db().query(
    `INSERT INTO finviz_ticker_snapshot (ticker, not_found_at) SELECT UNNEST($1::text[]), now()
     ON CONFLICT (ticker) DO UPDATE SET not_found_at = now()`,
    [tickers],
  );
}

export type EarningsInput = { ticker: string; date: string; timing: EarningsTiming | null; company: string | null; marketCap: number | null };

/** Upsert calendar rows (a re-listed row loses superseded_at). */
export async function upsertEarnings(rows: readonly EarningsInput[]): Promise<number> {
  const uniq = new Map<string, EarningsInput>();
  for (const r of rows) uniq.set(`${r.ticker}|${r.date}`, r);
  if (!uniq.size) return 0;
  const list = [...uniq.values()];
  await db().query(
    `INSERT INTO finviz_earnings (ticker, date, timing, company, market_cap)
     SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[])
     ON CONFLICT (ticker, date) DO UPDATE SET
       timing = COALESCE(EXCLUDED.timing, finviz_earnings.timing),
       company = COALESCE(EXCLUDED.company, finviz_earnings.company),
       market_cap = COALESCE(EXCLUDED.market_cap, finviz_earnings.market_cap),
       updated_at = now(), superseded_at = NULL`,
    [list.map((r) => r.ticker), list.map((r) => r.date), list.map((r) => r.timing), list.map((r) => r.company), list.map((r) => big(r.marketCap))],
  );
  return list.length;
}

/**
 * After a full calendar fetch of [from, to]: rows in that window the calendar no longer lists get superseded_at
 * (the report moved or was cancelled). Never called with an empty fetch (a broken response must not wipe the week).
 * A row the ticker's own fresh snapshot still confirms is kept (tickers outside the calendar's liquidity filter).
 */
export async function supersedeMissing(from: string, to: string, keep: readonly EarningsInput[]): Promise<number> {
  const r = await db().query(
    `UPDATE finviz_earnings e SET superseded_at = now()
      WHERE e.date BETWEEN $1 AND $2 AND e.superseded_at IS NULL AND NOT ((e.ticker || '|' || e.date) = ANY($3::text[]))
        AND NOT EXISTS (SELECT 1 FROM finviz_ticker_snapshot s WHERE s.ticker = e.ticker AND s.earnings_date = e.date
                          AND s.as_of > now() - interval '2 days')`,
    [from, to, keep.map((k) => `${k.ticker}|${k.date}`)],
  );
  return r.rowCount ?? 0;
}

/**
 * Tickers the desk touches: trades of the last 30 days, the desk plan's «в игре» list of the last 14 days, the active
 * watchlist and trade ideas of the last 30 days. Upper-cased, unique, at most `limit`.
 */
export async function deskTickers(nyDay: string, limit = 2000): Promise<string[]> {
  const since30 = shiftDay(nyDay, -30);
  const since14 = shiftDay(nyDay, -14);
  const parts = [
    { sql: `SELECT DISTINCT UPPER(ticker) AS t FROM trades WHERE deleted_at IS NULL AND date >= $1`, params: [since30] },
    {
      sql: `SELECT DISTINCT UPPER(x->>'ticker') AS t FROM game_plans p, jsonb_array_elements(p.in_play) x
             WHERE p.deleted_at IS NULL AND p.date >= $1 AND jsonb_typeof(p.in_play) = 'array'`,
      params: [since14],
    },
    { sql: `SELECT DISTINCT UPPER(ticker) AS t FROM watchlist WHERE deleted_at IS NULL`, params: [] },
    { sql: `SELECT DISTINCT UPPER(ticker) AS t FROM trade_ideas WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days'`, params: [] },
  ];
  const out = new Set<string>();
  for (const p of parts) {
    try {
      const { rows } = await db().query(p.sql, p.params);
      for (const r of rows) if (r.t && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.t))) out.add(String(r.t));
    } catch {
      /* a table missing in an old database: the other sources still count */
    }
  }
  return [...out].sort().slice(0, limit);
}

export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
