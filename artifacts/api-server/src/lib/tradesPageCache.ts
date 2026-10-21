/**
 * Short-lived cache for the costly, sort-independent half of GET /trades/page (summary aggregates, curve, streak,
 * outcome / horizon / option / preset facets). On a 45k-trade desk that half takes 0.9–2.6 s while the page of rows
 * itself takes ~10 ms, and the staff book header asks for it on every visit (DEV-02).
 *
 *   • keyed by the filter set (scope included) — sort / limit / offset / cursor are not part of the key;
 *   • stores the in-flight promise, so parallel identical requests share one computation; a rejection is evicted;
 *   • bounded: past `maxEntries` the oldest entry goes (free-text searches would otherwise grow it without limit);
 *   • `clear()` on every trade write in this API process; PropReports imports are picked up within the TTL.
 */
export class BoundedPromiseCache<V> {
  private store = new Map<string, { value: Promise<V>; expiresAt: number }>();

  constructor(private readonly ttlMs: number, private readonly maxEntries: number, private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.store.size;
  }

  /** Cached value for `key`, or the result of `load()` (stored for `ttlMs`). */
  getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const t = this.now();
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > t) return hit.value;
    if (hit) this.store.delete(key);
    const value = load();
    this.store.set(key, { value, expiresAt: t + this.ttlMs });
    value.catch(() => {
      if (this.store.get(key)?.value === value) this.store.delete(key);
    });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}

/** 60 s, 200 filter sets. */
export const TRADES_SUMMARY_TTL_MS = 60_000;
export const TRADES_SUMMARY_MAX_ENTRIES = 200;

/** The process-wide /trades/page aggregates cache (routes/trades.ts reads it; every trade write clears it). */
export const tradesPageAggregatesCache = new BoundedPromiseCache<unknown>(TRADES_SUMMARY_TTL_MS, TRADES_SUMMARY_MAX_ENTRIES);

/** GET /stats/aggregate: the built aggregate per (traders, window, facets, page filters, lite) — same TTL / invalidation. */
export const statsAggregateCache = new BoundedPromiseCache<unknown>(TRADES_SUMMARY_TTL_MS, TRADES_SUMMARY_MAX_ENTRIES);

/** Other trade-derived caches (lib/riskData daily P&L…) cleared together with these; registered at module load. */
const dependents: (() => void)[] = [];
export function onTradesPageInvalidate(clear: () => void): void {
  dependents.push(clear);
}

/** Called next to invalidateDashboardCache() by every trade write (routes/trades.ts, routes/setups-auto.ts). */
export function invalidateTradesPageCache(): void {
  tradesPageAggregatesCache.clear();
  statsAggregateCache.clear();
  for (const clear of dependents) clear();
}
