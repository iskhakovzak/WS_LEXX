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

export type WatchSources = { nasdaq: boolean; edgar: boolean; market: boolean };
/** In-memory life of a payload with a failed source: the next poll (60 s) retries upstream. */
export const WATCH_RETRY_TTL_MS = 60_000;
/** In-memory life of a payload whose enrichment missed the budget: the next poll picks up the warmed caches. */
export const WATCH_ENRICH_TTL_MS = 90_000;
/**
 * How long a freshly fetched GET /offerings/watch payload is trusted (item 1.14: an outage must not look like «сегодня
 * размещений нет» for 10 minutes). memTtlMs: any failed source → 60 s, unfinished enrichment → 90 s, else fullTtlMs.
 * storeInDb: only a payload whose listing sources (NASDAQ and EDGAR) both answered — a partial outage page must not
 * become the cache-first answer after a restart. Missing `sources` (payloads stored before the flags) count as ok.
 */
export function watchStorePolicy(o: { sources: WatchSources | null | undefined; complete: boolean; fullTtlMs: number }): { memTtlMs: number; storeInDb: boolean } {
  const s = o.sources ?? { nasdaq: true, edgar: true, market: true };
  const listing = s.nasdaq !== false && s.edgar !== false;
  const memTtlMs = !listing || s.market === false ? WATCH_RETRY_TTL_MS : !o.complete ? WATCH_ENRICH_TTL_MS : o.fullTtlMs;
  return { memTtlMs: Math.min(memTtlMs, o.fullTtlMs), storeInDb: listing };
}

// ── DB cache (survives API restarts): offering_ticker_cache(ticker, kind) ──
export async function dbCacheRead<T>(kind: string, tickers: string[], ttlMs: number): Promise<Map<string, { data: T; ts: number }>> {
  const out = new Map<string, { data: T; ts: number }>();
  if (!tickers.length) return out;
  try {
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
    await pool.query(
      `INSERT INTO offering_ticker_cache (ticker, kind, payload, fetched_at) VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (ticker, kind) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = NOW()`,
      [ticker, kind, JSON.stringify(data)],
    );
  } catch (e: any) {
    logger.warn({ kind, ticker, error: e?.message }, "offering cache write failed");
  }
}
