/**
 * Screener themes → tickers: one Finviz export with the theme's filters (lib/finviz/client, the shared ≥ 3 s queue),
 * sorted by the user's order or by market cap, top SCREENER_MAX (50) tickers — callers take their 25 / 50. Results are cached per screener key (the same
 * sector picked by several users resolves once an hour) and stored on the theme row. Single-flight per key.
 * Finviz off → nothing is resolved (the theme says it needs Finviz).
 */
import { fetchExport } from "../finviz/client";
import { finvizEnabled } from "../finviz/presets";
import { logger } from "../logger";
import { nyDate } from "../tradingDate";
import { RESOLVE_TTL_MS, SCREENER_DEFAULT_ORDER, SCREENER_MAX, screenerKey, type ScreenerSpec } from "./personal";

export type ScreenerDeps = {
  enabled: () => boolean;
  now: () => number;
  /** The export's tickers in the requested order. */
  run: (spec: ScreenerSpec) => Promise<string[]>;
};

const LIVE: ScreenerDeps = {
  enabled: finvizEnabled,
  now: () => Date.now(),
  run: async (spec) => (await fetchExport({ filters: spec.filters, order: spec.order ?? SCREENER_DEFAULT_ORDER }, nyDate())).map((r) => r.ticker),
};

let deps: ScreenerDeps = LIVE;
const cache = new Map<string, { tickers: string[]; at: number }>();
const inflight = new Map<string, Promise<{ tickers: string[]; at: number } | null>>();

export function setScreenerDeps(d: Partial<ScreenerDeps>): () => void {
  deps = { ...LIVE, ...d };
  cache.clear();
  inflight.clear();
  return () => {
    deps = LIVE;
    cache.clear();
    inflight.clear();
  };
}

export const screenerEnabled = (): boolean => deps.enabled();

/** Top tickers of a screener (cached ≤ 1 h per key). null = Finviz off or the export failed. */
export function resolveScreener(spec: ScreenerSpec): Promise<{ tickers: string[]; at: number } | null> {
  if (!deps.enabled()) return Promise.resolve(null);
  const key = screenerKey(spec);
  const hit = cache.get(key);
  if (hit && deps.now() - hit.at < RESOLVE_TTL_MS) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      const tickers = [...new Set(await deps.run(spec))].slice(0, SCREENER_MAX);
      const out = { tickers, at: deps.now() };
      cache.set(key, out);
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      return out;
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), key }, "themes: screener resolve failed");
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}
