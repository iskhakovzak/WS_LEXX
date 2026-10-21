/**
 * Black-Scholes greeks for chain contracts + expiry-date helpers. The formulas are the ones of the web calculator
 * (edge-tracker components/calculator/lib.ts `blackScholes`), so the chain's Δ matches what the B-S form shows.
 */
import { nyDate, nyMinutes, REGULAR_CLOSE_MIN } from "../tradingDate";
import type { ContractGreeks } from "./types";

/** Default risk-free rate for chain greeks (the calculator's default field value). */
export const CHAIN_RATE = 0.045;
const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;

function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** S, K in $, T in years, r and sigma as decimals. */
export function bsGreeks(S: number, K: number, T: number, r: number, sigma: number, type: "call" | "put"): ContractGreeks {
  const isCall = type === "call";
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) {
    const delta = isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
    return { delta, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const nd1 = normPdf(d1);
  const discK = K * Math.exp(-r * T);
  const thetaYr = isCall
    ? -(S * nd1 * sigma) / (2 * sqrtT) - r * discK * normCdf(d2)
    : -(S * nd1 * sigma) / (2 * sqrtT) + r * discK * normCdf(-d2);
  return {
    delta: +(isCall ? normCdf(d1) : normCdf(d1) - 1).toFixed(3),
    gamma: +(nd1 / (S * sigma * sqrtT)).toFixed(4),
    theta: +(thetaYr / 365).toFixed(3),
    vega: +((S * nd1 * sqrtT) / 100).toFixed(3),
  };
}

const labelMs = (label: string) => Date.parse(`${label}T00:00:00Z`);

/** Calendar days from today's New York date to the expiration date (0 on expiry day, never negative). */
export function dteFor(label: string, now: Date): number {
  const diff = Math.round((labelMs(label) - labelMs(nyDate(now))) / DAY_MS);
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

/** Days to expiry, negative once the expiration is already in the past (for filtering stale dates). */
export function signedDte(label: string, now: Date): number {
  return Math.round((labelMs(label) - labelMs(nyDate(now))) / DAY_MS);
}

/**
 * Epoch ms of the 16:00 New York close on a YYYY-MM-DD date — 20:00 UTC under EDT, 21:00 UTC under EST (the NY offset
 * of that day, read at 12:00 UTC: the same rule as lib/propreports/freshness nyInstant).
 */
export function expiryCloseMs(label: string): number {
  const offsetMin = 12 * 60 - nyMinutes(new Date(labelMs(label) + 12 * 3_600_000));
  return labelMs(label) + (REGULAR_CLOSE_MIN + offsetMin) * 60_000;
}

/** Years until the 16:00 New York close of the expiration day (0 once it passed). */
export function yearsToExpiry(label: string, now: Date): number {
  return Math.max(0, (expiryCloseMs(label) - now.getTime()) / YEAR_MS);
}

/** YYYY-MM-DD of a unix timestamp (UTC calendar date: providers stamp expirations at 00:00 UTC). */
export function labelOfTs(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Unix seconds of 00:00 UTC on a YYYY-MM-DD date (Yahoo's `date=` parameter). */
export function tsOfLabel(label: string): number {
  return Math.floor(labelMs(label) / 1000);
}

/** Greeks for one contract, or null without a usable IV (annual %). */
export function contractGreeks(spot: number, strike: number, ivPct: number | null, label: string, now: Date, type: "call" | "put"): ContractGreeks | null {
  if (ivPct == null || !(ivPct > 0)) return null;
  return bsGreeks(spot, strike, yearsToExpiry(label, now), CHAIN_RATE, ivPct / 100, type);
}
