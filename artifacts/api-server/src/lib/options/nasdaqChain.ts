/**
 * NASDAQ options chain — fallback provider of GET /api/options/chain (was the only one before Yahoo).
 * api.nasdaq.com/api/quote/{sym}/option-chain returns every expiration in one table; no IV (the web derives it from
 * the mid price), so contracts carry `iv: null, greeks: null`. Delayed ~15 min.
 */
import { dteFor, signedDte } from "./greeks";
import type { ChainContract, ChainExpiration, ChainProvider, ChainSlice } from "./types";

const NASDAQ_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nasdaq.com/",
};

export type NasdaqRow = {
  expirygroup: string;
  expiryDate: string | null;
  strike: string | null;
  c_Last: string | null;
  c_Change: string | null;
  c_Bid: string | null;
  c_Ask: string | null;
  c_Volume: string | null;
  c_Openinterest: string | null;
  c_colour: boolean;
  p_Last: string | null;
  p_Change: string | null;
  p_Bid: string | null;
  p_Ask: string | null;
  p_Volume: string | null;
  p_Openinterest: string | null;
  p_colour: boolean;
  drillDownURL: string | null;
};

export type NasdaqResponse = { data: { totalRecord: number; lastTrade: string; table: { rows: NasdaqRow[] | null } } };

function parseNum(s: string | null | undefined): number {
  if (!s || s === "--") return 0;
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseSpot(lastTrade: string): number {
  const m = lastTrade.match(/\$([0-9,]+\.?[0-9]*)/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
}

/** "May 26, 2026" → { label: "2026-05-26", ts: unix seconds of 00:00 UTC that day } */
export function parseExpiryGroup(group: string): { label: string; ts: number } | null {
  const d = new Date(`${group} 12:00:00 UTC`);
  if (isNaN(d.getTime())) return null;
  const label = d.toISOString().slice(0, 10);
  return { label, ts: Math.floor(Date.parse(`${label}T00:00:00Z`) / 1000) };
}

/** Rows → Map<expirygroup, rows> (a group header row precedes its strikes). */
function groupRows(rows: NasdaqRow[]): Map<string, NasdaqRow[]> {
  const map = new Map<string, NasdaqRow[]>();
  let current = "";
  for (const row of rows) {
    if (row.expirygroup) {
      current = row.expirygroup;
      if (!map.has(current)) map.set(current, []);
    } else if (current && row.strike) {
      map.get(current)!.push(row);
    }
  }
  return map;
}

function buildContract(row: NasdaqRow, side: "call" | "put", spot: number, label: string): ChainContract {
  const strike = parseNum(row.strike);
  const isCall = side === "call";
  const bid = parseNum(isCall ? row.c_Bid : row.p_Bid);
  const ask = parseNum(isCall ? row.c_Ask : row.p_Ask);
  const last = parseNum(isCall ? row.c_Last : row.p_Last);
  const change = parseNum(isCall ? row.c_Change : row.p_Change);
  const symMatch = (row.drillDownURL ?? "").match(/\/([^/]+)$/);
  return {
    contractSymbol: symMatch ? symMatch[1].toUpperCase() : `${isCall ? "C" : "P"}${strike}@${label}`,
    strike,
    bid,
    ask,
    last,
    mid: bid > 0 && ask > 0 ? +((bid + ask) / 2).toFixed(3) : last,
    iv: null,
    volume: parseNum(isCall ? row.c_Volume : row.p_Volume),
    openInterest: parseNum(isCall ? row.c_Openinterest : row.p_Openinterest),
    inTheMoney: isCall ? spot > strike : spot < strike,
    change,
    changePct: last > 0 && change !== 0 ? +((change / (last - change)) * 100).toFixed(2) : 0,
    greeks: null,
  };
}

/** Asks all three asset classes in parallel (8 s each) and takes the first one that returns rows. null = none did. */
async function fetchNasdaqRaw(symbol: string): Promise<NasdaqResponse | null> {
  const sym = symbol.toLowerCase();
  const attempts = (["stocks", "etf", "index"] as const).map(async (assetclass) => {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/option-chain?assetclass=${assetclass}&limit=600&type=all`;
    const resp = await fetch(url, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) throw new Error(`nasdaq ${assetclass}: ${resp.status}`);
    const data = (await resp.json()) as NasdaqResponse;
    if (!data?.data?.table?.rows?.length) throw new Error(`nasdaq ${assetclass}: empty`);
    return data;
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

/** Pure: NASDAQ table → provider data (requested = YYYY-MM-DD or null for the nearest). */
export function parseNasdaqChain(raw: NasdaqResponse, symbol: string, requested: string | null, now: Date) {
  const rows = raw.data?.table?.rows ?? [];
  const spot = parseSpot(raw.data?.lastTrade ?? "");
  const grouped = groupRows(rows);
  const expirations: ChainExpiration[] = [];
  const byLabel = new Map<string, NasdaqRow[]>();
  for (const [group, list] of grouped) {
    const p = parseExpiryGroup(group);
    if (!p || signedDte(p.label, now) < 0 || byLabel.has(p.label)) continue;
    byLabel.set(p.label, list);
    expirations.push({ timestamp: p.ts, label: p.label, dte: dteFor(p.label, now) });
  }
  expirations.sort((a, b) => a.timestamp - b.timestamp);
  const want = requested ?? expirations[0]?.label ?? null;
  const exp = expirations.find((e) => e.label === want);
  let chain: ChainSlice | null = null;
  if (exp) {
    const list = byLabel.get(exp.label) ?? [];
    const calls = list.map((r) => buildContract(r, "call", spot, exp.label)).filter((c) => c.strike > 0);
    const puts = list.map((r) => buildContract(r, "put", spot, exp.label)).filter((c) => c.strike > 0);
    const strikes = [...new Set(calls.map((c) => c.strike))].sort((a, b) => a - b);
    chain = { expiration: exp.label, expirationDate: exp.timestamp, daysToExpiry: exp.dte, calls, puts, strikes };
  }
  return { spot, data: { name: symbol, underlying: { price: spot, change: null, changePct: null }, expirations, chain } };
}

export const nasdaqChainProvider: ChainProvider = async (symbol, expiration, now) => {
  let raw: NasdaqResponse | null;
  try {
    raw = await fetchNasdaqRaw(symbol);
  } catch (e: unknown) {
    return { kind: "failed", error: `nasdaq: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!raw) return { kind: "failed", error: "nasdaq: no rows in stocks/etf/index" };
  const { spot, data } = parseNasdaqChain(raw, symbol, expiration, now);
  if (data.expirations.length === 0) return { kind: "empty" };
  if (!(spot > 0)) return { kind: "failed", error: "nasdaq: no underlying price" };
  return { kind: "ok", data };
};
