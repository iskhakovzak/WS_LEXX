/**
 * Normalised options-chain shape shared by every provider (lib/options/yahooChain, lib/options/nasdaqChain) and
 * returned by GET /api/options/chain (lib/options/chainService).
 */

export type ChainSourceId = "yahoo" | "nasdaq";

/** Per-contract greeks (Black-Scholes on the provider's IV). Theta per calendar day, vega per 1 pp of IV. */
export type ContractGreeks = { delta: number; gamma: number; theta: number; vega: number };

export type ChainContract = {
  contractSymbol: string;
  strike: number;
  bid: number;
  ask: number;
  last: number;
  /** (bid + ask) / 2 when both are quoted, otherwise the last trade. */
  mid: number;
  /** Implied volatility, annual %, or null when the provider gave none / an unusable value. */
  iv: number | null;
  volume: number;
  openInterest: number;
  inTheMoney: boolean;
  change: number;
  changePct: number;
  /** Only when `iv` is known. */
  greeks: ContractGreeks | null;
};

export type ChainExpiration = { timestamp: number; label: string; dte: number };

export type ChainUnderlying = { price: number; change: number | null; changePct: number | null };

export type ChainSlice = {
  /** YYYY-MM-DD */
  expiration: string;
  expirationDate: number;
  daysToExpiry: number;
  calls: ChainContract[];
  puts: ChainContract[];
  strikes: number[];
};

/** What a provider hands to the service: the expiration list, the underlying and (when found) one expiration's chain. */
export type ProviderChain = {
  name: string;
  underlying: ChainUnderlying;
  expirations: ChainExpiration[];
  /** null = the requested expiration is not in `expirations`. */
  chain: ChainSlice | null;
};

export type ProviderOutcome =
  | { kind: "ok"; data: ProviderChain }
  /** The provider answered and the symbol has no listed options. */
  | { kind: "empty" }
  /** Network / HTTP / parse failure — try the next provider. */
  | { kind: "failed"; error: string };

/** One provider: `expiration` YYYY-MM-DD, or null for the expiration list + the nearest chain. */
export type ChainProvider = (symbol: string, expiration: string | null, now: Date) => Promise<ProviderOutcome>;

/** Body of GET /api/options/chain. Chain fields are present when a chain was found (always for `expiration = null`). */
export type ChainPayload = {
  symbol: string;
  name: string;
  /** Kept flat for older clients; same values as `underlying`. */
  spot: number;
  change: number | null;
  changePct: number | null;
  underlying: ChainUnderlying;
  source: ChainSourceId | null;
  /** Free feeds are delayed ~15 minutes. */
  delayMinutes: number;
  sourceUnavailable: boolean;
  expirations: ChainExpiration[];
} & Partial<ChainSlice>;
