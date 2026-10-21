/**
 * Yahoo Finance options chain (primary provider of GET /api/options/chain).
 *   GET https://query2.finance.yahoo.com/v7/finance/options/{SYMBOL}?crumb=…[&date={unix 00:00 UTC}]
 * through the shared cookie/crumb session (marketDataService.fetchYahooWithSession). Without `date` Yahoo answers
 * the expiration list + the nearest expiration's chain. Quotes are delayed ~15 min.
 * Yahoo IV is a decimal (0.27 = 27 %); junk values (≈0 on dead strikes, > 500 %) become null and get no greeks.
 * `get` is injectable: tests never touch the network.
 */
import { fetchYahooWithSession } from "../marketDataService";
import { contractGreeks, labelOfTs, signedDte, dteFor, tsOfLabel } from "./greeks";
import type { ChainContract, ChainExpiration, ChainProvider, ChainSlice, ProviderOutcome } from "./types";

export type YahooOptionContract = {
  contractSymbol?: string;
  strike?: number;
  currency?: string;
  lastPrice?: number;
  change?: number;
  percentChange?: number;
  volume?: number;
  openInterest?: number;
  bid?: number;
  ask?: number;
  contractSize?: string;
  expiration?: number;
  lastTradeDate?: number;
  impliedVolatility?: number;
  inTheMoney?: boolean;
};

export type YahooOptionsResponse = {
  optionChain?: {
    result?: Array<{
      underlyingSymbol?: string;
      expirationDates?: number[];
      strikes?: number[];
      hasMiniOptions?: boolean;
      quote?: {
        symbol?: string;
        shortName?: string;
        longName?: string;
        regularMarketPrice?: number;
        regularMarketChange?: number;
        regularMarketChangePercent?: number;
        regularMarketPreviousClose?: number;
      };
      options?: Array<{ expirationDate?: number; hasMiniOptions?: boolean; calls?: YahooOptionContract[]; puts?: YahooOptionContract[] }>;
    }>;
    error?: unknown;
  };
};

/** Fetches one Yahoo URL (built from the session crumb). null = no session / network failure. */
export type YahooGet = (url: (s: { crumb: string }) => string) => Promise<Response | null>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Yahoo IV decimal → annual % (1 decimal), or null for the junk Yahoo sends on untraded strikes. */
export function yahooIvPct(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0.01 || v > 5) return null;
  return +(v * 100).toFixed(1);
}

function toContract(c: YahooOptionContract, type: "call" | "put", spot: number, label: string, now: Date): ChainContract | null {
  const strike = num(c.strike);
  if (!(strike > 0)) return null;
  const bid = num(c.bid), ask = num(c.ask), last = num(c.lastPrice);
  const mid = bid > 0 && ask > 0 ? +((bid + ask) / 2).toFixed(3) : last;
  const iv = yahooIvPct(c.impliedVolatility);
  return {
    contractSymbol: c.contractSymbol || `${type === "call" ? "C" : "P"}${strike}@${label}`,
    strike,
    bid,
    ask,
    last,
    mid,
    iv,
    volume: num(c.volume),
    openInterest: num(c.openInterest),
    inTheMoney: typeof c.inTheMoney === "boolean" ? c.inTheMoney : type === "call" ? spot > strike : spot < strike,
    change: num(c.change),
    changePct: +num(c.percentChange).toFixed(2),
    greeks: contractGreeks(spot, strike, iv, label, now, type),
  };
}

/** Pure: one Yahoo answer → the provider outcome (requested = YYYY-MM-DD or null for the nearest). */
export function parseYahooChain(json: YahooOptionsResponse, requested: string | null, now: Date): ProviderOutcome {
  const r = json?.optionChain?.result?.[0];
  if (!r || !Array.isArray(r.expirationDates) || r.expirationDates.length === 0) return { kind: "empty" };
  const q = r.quote ?? {};
  const price = num(q.regularMarketPrice);
  if (!(price > 0)) return { kind: "failed", error: "yahoo: no underlying price" };

  const expirations: ChainExpiration[] = [];
  for (const ts of r.expirationDates) {
    if (typeof ts !== "number") continue;
    const label = labelOfTs(ts);
    if (signedDte(label, now) < 0) continue;
    expirations.push({ timestamp: ts, label, dte: dteFor(label, now) });
  }
  expirations.sort((a, b) => a.timestamp - b.timestamp);

  const block = r.options?.[0];
  let chain: ChainSlice | null = null;
  if (block && typeof block.expirationDate === "number") {
    const label = labelOfTs(block.expirationDate);
    const want = requested ?? expirations[0]?.label ?? label;
    if (label === want) {
      const calls = (block.calls ?? []).map((c) => toContract(c, "call", price, label, now)).filter((c): c is ChainContract => c !== null);
      const puts = (block.puts ?? []).map((c) => toContract(c, "put", price, label, now)).filter((c): c is ChainContract => c !== null);
      calls.sort((a, b) => a.strike - b.strike);
      puts.sort((a, b) => a.strike - b.strike);
      const strikes = [...new Set([...calls, ...puts].map((c) => c.strike))].sort((a, b) => a - b);
      if (strikes.length) {
        chain = { expiration: label, expirationDate: block.expirationDate, daysToExpiry: dteFor(label, now), calls, puts, strikes };
      }
    }
  }
  const listed = requested == null || expirations.some((e) => e.label === requested);
  // A listed expiration that came back without contracts is a hiccup, not an answer: let the fallback try.
  if (!chain && listed) return { kind: "failed", error: `yahoo: empty chain for ${requested ?? "nearest"}` };

  return {
    kind: "ok",
    data: {
      name: q.shortName || q.longName || r.underlyingSymbol || q.symbol || "",
      underlying: {
        price,
        change: numOrNull(q.regularMarketChange) != null ? +num(q.regularMarketChange).toFixed(2) : null,
        changePct: numOrNull(q.regularMarketChangePercent) != null ? +num(q.regularMarketChangePercent).toFixed(2) : null,
      },
      expirations,
      chain,
    },
  };
}

export function yahooOptionsUrl(symbol: string, expiration: string | null, crumb: string): string {
  const date = expiration ? `&date=${tsOfLabel(expiration)}` : "";
  return `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}${date}`;
}

export function makeYahooChainProvider(get: YahooGet = fetchYahooWithSession): ChainProvider {
  return async (symbol, expiration, now) => {
    let resp: Response | null;
    try {
      resp = await get((s) => yahooOptionsUrl(symbol, expiration, s.crumb));
    } catch (e: unknown) {
      return { kind: "failed", error: `yahoo: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!resp) return { kind: "failed", error: "yahoo: no session" };
    if (resp.status === 404) return { kind: "empty" };
    if (!resp.ok) return { kind: "failed", error: `yahoo: HTTP ${resp.status}` };
    try {
      return parseYahooChain((await resp.json()) as YahooOptionsResponse, expiration, now);
    } catch (e: unknown) {
      return { kind: "failed", error: `yahoo: ${e instanceof Error ? e.message : String(e)}` };
    }
  };
}

export const yahooChainProvider: ChainProvider = makeYahooChainProvider();
