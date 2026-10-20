/**
 * GET /api/options/chain — provider order Yahoo → NASDAQ, 5-minute bounded cache, honest `sourceUnavailable`.
 *   - the first provider that answers `ok` wins (its id goes to `source`);
 *   - `empty` from a provider (symbol has no options) with nobody `ok` → NO_DATA 404;
 *   - every provider failed → 200 with `sourceUnavailable: true` (not cached, the next request tries again);
 *   - the answer lists the expirations; the chain for `expiration` (or the nearest one when none was asked) is
 *     included, an expiration the winner does not list → EXPIRATION_NOT_FOUND 404 with the available dates.
 * `deps` are injectable: tests never touch the network.
 */
import { AppError } from "../http";
import { logger } from "../logger";
import { nasdaqChainProvider } from "./nasdaqChain";
import { yahooChainProvider } from "./yahooChain";
import type { ChainPayload, ChainProvider, ChainSourceId, ProviderChain } from "./types";

export const CHAIN_CACHE_TTL = 5 * 60_000;
const CACHE_MAX = 300;
export const DELAY_MINUTES = 15;

export type ChainDeps = { providers: { id: ChainSourceId; fetch: ChainProvider }[]; now: () => Date };

export const LIVE_CHAIN_DEPS: ChainDeps = {
  providers: [
    { id: "yahoo", fetch: yahooChainProvider },
    { id: "nasdaq", fetch: nasdaqChainProvider },
  ],
  now: () => new Date(),
};

const cache = new Map<string, { data: ChainPayload; ts: number }>();

/** Bounded cache: evict expired entries, then oldest, so arbitrary symbols can't grow memory forever. */
function cacheSet(key: string, data: ChainPayload, now: number): void {
  if (cache.size >= CACHE_MAX) {
    for (const [k, v] of cache) if (now - v.ts >= CHAIN_CACHE_TTL) cache.delete(k);
    while (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.delete(key);
  cache.set(key, { data, ts: now });
}

/** Tests: forget cached chains. */
export function _resetChainCache(): void { cache.clear(); }

const cacheKey = (symbol: string, expiration: string | null) => `${symbol}|${expiration ?? "nearest"}`;

function toPayload(symbol: string, source: ChainSourceId, d: ProviderChain): ChainPayload {
  return {
    symbol,
    name: d.name || symbol,
    spot: d.underlying.price,
    change: d.underlying.change,
    changePct: d.underlying.changePct,
    underlying: d.underlying,
    source,
    delayMinutes: DELAY_MINUTES,
    sourceUnavailable: false,
    expirations: d.expirations,
    ...(d.chain ?? {}),
  };
}

export function unavailablePayload(symbol: string): ChainPayload {
  return {
    symbol, name: symbol, spot: 0, change: null, changePct: null, underlying: { price: 0, change: null, changePct: null },
    source: null, delayMinutes: DELAY_MINUTES, sourceUnavailable: true, expirations: [],
  };
}

export async function getOptionsChain(symbol: string, expiration: string | null, deps: ChainDeps = LIVE_CHAIN_DEPS): Promise<ChainPayload> {
  const nowMs = deps.now().getTime();
  const key = cacheKey(symbol, expiration);
  const hit = cache.get(key);
  if (hit && nowMs - hit.ts < CHAIN_CACHE_TTL) return hit.data;

  let sawEmpty = false;
  const errors: string[] = [];
  for (const p of deps.providers) {
    const out = await p.fetch(symbol, expiration, deps.now());
    if (out.kind === "empty") { sawEmpty = true; continue; }
    if (out.kind === "failed") { errors.push(out.error); continue; }
    if (expiration && !out.data.chain) {
      throw new AppError("EXPIRATION_NOT_FOUND", 404, { expiration }, { available: out.data.expirations.map((e) => e.label) });
    }
    const payload = toPayload(symbol, p.id, out.data);
    cacheSet(key, payload, nowMs);
    // The nearest chain is also the answer for its own date: picking that chip later costs no request.
    if (!expiration && out.data.chain) cacheSet(cacheKey(symbol, out.data.chain.expiration), payload, nowMs);
    if (errors.length) logger.info({ symbol, source: p.id, errors }, "options chain: served by fallback");
    return payload;
  }
  if (sawEmpty) throw new AppError("NO_DATA");
  logger.warn({ symbol, expiration, errors }, "options chain: every source failed");
  return unavailablePayload(symbol);
}
