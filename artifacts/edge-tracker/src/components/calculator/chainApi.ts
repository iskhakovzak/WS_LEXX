/**
 * GET /api/options/chain client + pure helpers for the contract picker (strike ladder, derived IV / greeks, the AI
 * payload). The server answers Yahoo Finance (NASDAQ as fallback): expirations + the nearest chain in one request,
 * `source`, `delayMinutes`, and `sourceUnavailable` when every source failed.
 */
import { http } from "@/lib/api/http";
import { blackScholes, impliedVolPct } from "./lib";
import type { ChainData, ChainOption, Expiration } from "./strategies";

export type ChainSourceId = "yahoo" | "nasdaq";

export type ChainResponse = {
  symbol: string;
  name: string;
  spot: number;
  change: number | null;
  changePct: number | null;
  source: ChainSourceId | null;
  delayMinutes?: number;
  sourceUnavailable?: boolean;
  expirations: Expiration[];
  /** Chain fields: present when the answer carries a chain (always for the no-date request). */
  expiration?: string;
  expirationDate?: number;
  daysToExpiry?: number;
  calls?: ChainOption[];
  puts?: ChainOption[];
  strikes?: number[];
};

/** Brand names of the feeds (not translated). */
export const SOURCE_LABEL: Record<ChainSourceId, string> = { yahoo: "Yahoo Finance", nasdaq: "NASDAQ" };
export const DEFAULT_DELAY_MIN = 15;
/** Strikes shown on each side of the ATM (or the searched) strike before «more». */
export const LADDER_RADIUS = 10;

export function fetchChain(symbol: string, expiration: string | null): Promise<ChainResponse> {
  const query: Record<string, string> = { symbol: symbol.trim().toUpperCase() };
  if (expiration) query.expiration = expiration;
  return http.get<ChainResponse>("/api/options/chain", { query });
}

/** The chain part of an answer, or null when it carries none. */
export function chainOf(r: ChainResponse): ChainData | null {
  if (!Array.isArray(r.calls) || !Array.isArray(r.puts) || !Array.isArray(r.strikes) || r.daysToExpiry == null) return null;
  return {
    symbol: r.symbol, spot: r.spot, change: r.change, changePct: r.changePct, name: r.name,
    expirationDate: r.expirationDate ?? 0, daysToExpiry: r.daysToExpiry, calls: r.calls, puts: r.puts, strikes: r.strikes,
  };
}

/**
 * Fill what the feed left out: IV from the mid price (NASDAQ has none, Yahoo blanks dead strikes) and greeks from
 * Black-Scholes on that IV — so every row of the ladder has Δ.
 */
export function withDerivedGreeks(chain: ChainData, ratePct: number): ChainData {
  const T = Math.max(chain.daysToExpiry, 0.5) / 365;
  const r = ratePct / 100;
  const fill = (opts: ChainOption[], type: "call" | "put") => opts.map((o) => {
    if (o.iv != null && o.greeks) return o;
    const iv = o.iv ?? impliedVolPct(o.mid, chain.spot, o.strike, T, r, type);
    if (iv == null) return { ...o, iv: null, greeks: null };
    const b = blackScholes(chain.spot, o.strike, T, r, iv / 100, type);
    return { ...o, iv, greeks: o.greeks ?? { delta: b.delta, gamma: b.gamma, theta: b.theta, vega: b.vega } };
  });
  return { ...chain, calls: fill(chain.calls, "call"), puts: fill(chain.puts, "put") };
}

/** Index of the strike closest to `x` (−1 for an empty list). */
export function nearestIndex(strikes: readonly number[], x: number): number {
  let best = -1;
  for (let i = 0; i < strikes.length; i++) {
    if (best === -1 || Math.abs(strikes[i] - x) < Math.abs(strikes[best] - x)) best = i;
  }
  return best;
}

/** `radius` strikes on each side of the one nearest to `center`; how many stay hidden below / above. */
export function ladderWindow(strikes: readonly number[], center: number, radius: number): { rows: number[]; hiddenBelow: number; hiddenAbove: number } {
  const i = nearestIndex(strikes, center);
  if (i === -1) return { rows: [], hiddenBelow: 0, hiddenAbove: 0 };
  const from = Math.max(0, i - radius);
  const to = Math.min(strikes.length, i + radius + 1);
  return { rows: strikes.slice(from, to), hiddenBelow: from, hiddenAbove: strikes.length - to };
}

/** Strike typed in the search box → number, or null while it is empty / not a number. */
export function parseStrikeQuery(q: string): number | null {
  const t = q.replace(/[\s$]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ATM ±`radius` strikes only: the AI prompt never uses more, and a full SPY chain is hundreds of rows. */
export function compactForAi(chain: ChainData, radius = 15): Pick<ChainData, "calls" | "puts" | "strikes"> {
  const { rows } = ladderWindow(chain.strikes, chain.spot, radius);
  const keep = new Set(rows);
  return { strikes: rows, calls: chain.calls.filter((c) => keep.has(c.strike)), puts: chain.puts.filter((p) => keep.has(p.strike)) };
}
