/**
 * DB cache of the offerings feed (offering_ticker_cache, survives API restarts) and the cache-first rule of
 * GET /offerings/watch (ROMAN-04). Moved out of routes/offerings.ts; no network here.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { nyDate } from "./tradingDate";

/** The last day payload of /offerings/watch survives API restarts in offering_ticker_cache (kind, ticker = day). */
export const WATCH_DAY_KIND = "watch_day";
/** How long a stored day payload may still be shown (stamped «данные на HH:MM») while the page revalidates it. */
export const WATCH_DAY_KEEP_MS = 14 * 86_400_000;

export type WatchCachePlan = "fresh" | "stale" | "fetch";
/**
 * Cache-first decision for GET /offerings/watch when the in-memory cache missed (ROMAN-04: a cold call took 5-20 s).
 *   fetch — nothing stored, `force=1`, or `revalidate=1` on a stale entry: go upstream as before;
 *   fresh — stored < ttl ago, or a past day stored after that day was over (it no longer changes): serve it;
 *   stale — serve the stored payload at once with `stale: true`; the page shows its time and asks again with
 *           `revalidate=1` (the same upstream fetch the cold call used to make, now off the critical path).
 */
export function watchCachePlan(o: { storedAt: number | null; day: string; today: string; now: number; ttlMs: number; force: boolean; revalidate: boolean }): WatchCachePlan {
  if (o.force || o.storedAt == null) return "fetch";
  if (o.now - o.storedAt < o.ttlMs) return "fresh";
  if (o.day < o.today && nyDate(new Date(o.storedAt)) > o.day) return "fresh";
  return o.revalidate ? "fetch" : "stale";
}

// ── DB cache (survives API restarts): offering_ticker_cache(ticker, kind) ──
let ensureCachePromise: Promise<void> | null = null;
function ensureOfferingCache(): Promise<void> {
  if (!ensureCachePromise) {
    ensureCachePromise = pool.query(
      `CREATE TABLE IF NOT EXISTS offering_ticker_cache (
         ticker TEXT NOT NULL,
         kind TEXT NOT NULL,
         payload JSONB NOT NULL,
         fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (ticker, kind)
       )`,
    ).then(() => undefined).catch((e) => { ensureCachePromise = null; throw e; });
  }
  return ensureCachePromise;
}
export async function dbCacheRead<T>(kind: string, tickers: string[], ttlMs: number): Promise<Map<string, { data: T; ts: number }>> {
  const out = new Map<string, { data: T; ts: number }>();
  if (!tickers.length) return out;
  try {
    await ensureOfferingCache();
    const { rows } = await pool.query<{ ticker: string; payload: T; fetched_at: Date }>(
      `SELECT ticker, payload, fetched_at FROM offering_ticker_cache WHERE kind = $1 AND ticker = ANY($2::text[])`,
      [kind, tickers],
    );
    for (const r of rows) {
      const ts = new Date(r.fetched_at).getTime();
      if (Date.now() - ts < ttlMs) out.set(r.ticker, { data: r.payload, ts });
    }
  } catch (e: any) {
    logger.warn({ kind, error: e?.message }, "offering cache read failed");
  }
  return out;
}
export async function dbCacheWrite(kind: string, ticker: string, data: unknown): Promise<void> {
  try {
    await ensureOfferingCache();
    await pool.query(
      `INSERT INTO offering_ticker_cache (ticker, kind, payload, fetched_at) VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (ticker, kind) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = NOW()`,
      [ticker, kind, JSON.stringify(data)],
    );
  } catch (e: any) {
    logger.warn({ kind, ticker, error: e?.message }, "offering cache write failed");
  }
}
