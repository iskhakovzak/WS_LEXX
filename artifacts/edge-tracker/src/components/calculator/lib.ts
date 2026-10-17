/** Shared math, formatting and persistence helpers for the Calculator section. */
import { useEffect, useState } from "react";
import type React from "react";

export const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const LS_PREFIX = "ws_lexx_calc_";

/** useState persisted in localStorage (try/catch: private mode / quota never break the page). */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(v)); } catch { /* quota / private mode */ }
  }, [key, v]);
  return [v, setV];
}

/** Parse user numeric input, accepting decimal comma ("1,5") and spaces ("10 000"). NaN when empty/invalid. */
export function num(s: string | number | null | undefined): number {
  if (typeof s === "number") return s;
  if (s == null) return NaN;
  const t = String(s).replace(/[\s  ]/g, "").replace(",", ".");
  if (t === "") return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Fetch error → readable Russian message (server may return non-JSON). */
export async function fetchErrorMessage(r: Response, fallback: string): Promise<string> {
  const j = await r.json().catch(() => ({})) as { error?: string };
  if (r.status === 400) return "Некорректный тикер";
  if (r.status === 404) return j.error?.startsWith("Expiration") ? "Эта экспирация больше недоступна — выберите другую" : "Для этого тикера нет опционов";
  if (r.status === 401 || r.status === 403) return "Нет доступа — войдите заново";
  if (r.status >= 500) return "Источник данных недоступен, попробуйте позже";
  return j.error || fallback;
}

export type Quote = { price: number; atr: number | null; prevClose: number | null; name: string | null; change: number | null };

// ─── Desk limits (GET /api/risk/me) ──────────────────────────────────────────

/** Desk limits for the current trader. Every field optional: the endpoint may be absent (404) or partially filled. */
export type DeskLimits = {
  accountSize: number | null;
  maxRisk: number | null;
  dailyLoss: number | null;
  maxPosition: number | null;
  maxOvernight: number | null;
  allowOvernight: boolean | null;
  allowSwing: boolean | null;
  tier: string | null;
  /** Today's realised P&L (net) and the risk still on the table in open positions — both eat into the daily loss room. */
  todayPnl: number | null;
  openRisk: number | null;
};

function posNum(v: unknown): number | null {
  const n = num(v as string | number | null | undefined);
  return n > 0 ? n : null;
}

/** null = limits not available (anonymous, endpoint missing, network error) — callers must not fall back to a guessed account size. */
export async function fetchDeskLimits(): Promise<DeskLimits | null> {
  try {
    const r = await fetch(`${BASE}/api/risk/me`);
    if (!r.ok) return null;
    const j = await r.json() as { limits?: Record<string, unknown> | null; today?: { pnl?: unknown; openRisk?: unknown } | null };
    const l = j?.limits ?? {};
    // risk.ts returns camelCase; accept snake_case too (raw DB rows).
    const pick = (camel: string, snake: string) => l[camel] ?? l[snake];
    const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
    const pnl = num(j?.today?.pnl as string | number | null | undefined);
    const openRisk = num(j?.today?.openRisk as string | number | null | undefined);
    const tier = pick("tier", "tier");
    return {
      accountSize: posNum(pick("accountSize", "account_size")),
      maxRisk: posNum(pick("maxRiskPerTrade", "max_risk_per_trade")),
      dailyLoss: posNum(pick("dailyLossLimit", "daily_loss_limit")),
      maxPosition: posNum(pick("maxPositionUsd", "max_position_usd")),
      maxOvernight: posNum(pick("maxOvernightExposure", "max_overnight_exposure")),
      allowOvernight: bool(pick("allowOvernight", "allow_overnight")),
      allowSwing: bool(pick("allowSwing", "allow_swing")),
      tier: typeof tier === "string" && tier ? tier : null,
      todayPnl: Number.isFinite(pnl) ? pnl : null,
      openRisk: Number.isFinite(openRisk) && openRisk > 0 ? openRisk : null,
    };
  } catch {
    return null;
  }
}

/** Distinct broker accounts seen on the viewer's trades (PropReports / manual). Empty when none → selector hidden. */
export async function fetchBrokerAccounts(): Promise<string[]> {
  try {
    const r = await fetch(`${BASE}/api/trades`);
    if (!r.ok) return [];
    const j = await r.json() as unknown;
    const rows = Array.isArray(j) ? j : Array.isArray((j as { items?: unknown[] })?.items) ? (j as { items: unknown[] }).items : [];
    const out = new Set<string>();
    for (const t of rows as { brokerAccount?: unknown; broker_account?: unknown }[]) {
      const a = t.brokerAccount ?? t.broker_account;
      if (typeof a === "string" && a.trim()) out.add(a.trim());
    }
    return [...out].sort();
  } catch {
    return [];
  }
}

/** Last price (+ ATR) for one ticker via the shared stockdata endpoint. */
export async function fetchQuote(symbol: string): Promise<Quote | null> {
  const sym = symbol.trim().toUpperCase();
  const r = await fetch(`${BASE}/api/stockdata/quote?symbols=${encodeURIComponent(sym)}`);
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json() as Record<string, { price?: number | null; atr?: number | null; prevClose?: number | null; name?: string | null; change?: number | null } | undefined>;
  const q = j[sym];
  if (!q || typeof q.price !== "number" || !(q.price > 0)) return null;
  return {
    price: q.price,
    atr: typeof q.atr === "number" && q.atr > 0 ? q.atr : null,
    prevClose: typeof q.prevClose === "number" ? q.prevClose : null,
    name: q.name ?? null,
    change: typeof q.change === "number" ? q.change : null,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number) {
  const k = `${min}:${max}`;
  let f = nfCache.get(k);
  if (!f) { f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max }); nfCache.set(k, f); }
  return f;
}

/** 1234.5 → "1,234.50" (en-US, as everywhere in the app) */
export function fmtNum(n: number, digits = 2, minDigits = digits): string {
  if (!Number.isFinite(n)) return "—";
  return nf(Math.min(minDigits, digits), digits).format(n);
}
/** $ amount, sign before the currency: "−$1,234.50" */
export function fmtUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `${n < 0 ? "−" : ""}$${fmtNum(Math.abs(n), digits)}`;
}
/** Always-signed $ amount: "+$120", "−$80" */
export function fmtUsdSigned(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  const s = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${s}$${fmtNum(Math.abs(n), digits)}`;
}
export function fmtPct(n: number, digits = 1, signed = false): string {
  if (!Number.isFinite(n)) return "—";
  const s = signed && n > 0 ? "+" : n < 0 ? "−" : "";
  return `${s}${fmtNum(Math.abs(n), digits)}%`;
}
/** Compact $ for chart axes: $1.2k */
export function fmtUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1_000_000) return `${s}$${fmtNum(a / 1_000_000, 1, 0)}M`;
  if (a >= 1_000) return `${s}$${fmtNum(a / 1_000, 1, 0)}k`;
  return `${s}$${fmtNum(a, a < 10 ? 2 : 0, 0)}`;
}

export const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px rgb(0 0 0 / 0.3)",
  backdropFilter: "blur(24px)",
};

// ─── Black-Scholes ───────────────────────────────────────────────────────────

export function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export type OptType = "call" | "put";
export type Greeks = { price: number; delta: number; gamma: number; theta: number; vega: number; rho: number; d1: number; d2: number };

/** T in years, r and sigma as decimals. Theta per calendar day, vega/rho per 1 pp. */
export function blackScholes(S: number, K: number, T: number, r: number, sigma: number, type: OptType): Greeks {
  if (!(S > 0) || !(K > 0)) return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, d1: 0, d2: 0 };
  if (!(T > 0) || !(sigma > 0)) {
    // At expiry (or zero vol) the option is worth its intrinsic value, not 0.
    const isC = type === "call";
    const intrinsic = isC ? Math.max(0, S - K) : Math.max(0, K - S);
    const delta = isC ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
    return { price: intrinsic, delta, gamma: 0, theta: 0, vega: 0, rho: 0, d1: 0, d2: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const Nd1 = normCdf(d1), Nd2 = normCdf(d2);
  const nd1 = normPdf(d1);
  const discK = K * Math.exp(-r * T);
  const isCall = type === "call";
  const price = isCall ? S * Nd1 - discK * Nd2 : discK * normCdf(-d2) - S * normCdf(-d1);
  const delta = isCall ? Nd1 : Nd1 - 1;
  const gamma = nd1 / (S * sigma * sqrtT);
  const thetaYr = isCall
    ? -(S * nd1 * sigma) / (2 * sqrtT) - r * discK * Nd2
    : -(S * nd1 * sigma) / (2 * sqrtT) + r * discK * normCdf(-d2);
  const theta = thetaYr / 365;
  const vega = (S * nd1 * sqrtT) / 100;
  const rho = (isCall ? discK * T * Nd2 : -discK * T * normCdf(-d2)) / 100;
  return { price, delta, gamma, theta, vega, rho, d1, d2 };
}

/** Implied volatility (annual, %) from an option price via bisection. null if price is outside no-arbitrage bounds. */
export function impliedVolPct(price: number, S: number, K: number, T: number, r: number, type: OptType): number | null {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const discK = K * Math.exp(-r * T);
  const lower = type === "call" ? Math.max(0, S - discK) : Math.max(0, discK - S);
  const upper = type === "call" ? S : discK;
  if (price <= lower + 1e-4 || price >= upper) return null;
  let lo = 0.005, hi = 5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (blackScholes(S, K, T, r, mid, type).price > price) hi = mid; else lo = mid;
  }
  const v = ((lo + hi) / 2) * 100;
  return v > 0.6 && v < 499 ? +v.toFixed(1) : null;
}

/** Risk-neutral probability (0..1) that the underlying finishes above X at expiry (lognormal). */
export function probAbove(S: number, X: number, T: number, r: number, sigma: number): number | null {
  if (!(S > 0) || !(T > 0) || !(sigma > 0)) return null;
  if (!(X > 0)) return 1;
  const d2 = (Math.log(S / X) + (r - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normCdf(d2);
}

// ─── Multi-leg positions (B-S + strategy builder + advisor) ──────────────────

export type LegKind = OptType | "stock";
export type Leg = {
  id: string;
  kind: LegKind;
  side: "buy" | "sell";
  /** Option strike, or stock entry price. */
  strike: number;
  /** Option premium per share (ignored for stock). */
  premium: number;
  /** Contracts for options, shares for stock. */
  qty: number;
};

export const newLegId = () => Math.random().toString(36).slice(2, 9);

const mult = (l: Leg) => (l.kind === "stock" ? 1 : 100);
const sgn = (l: Leg) => (l.side === "buy" ? 1 : -1);

/** P&L of one leg at expiry if the underlying is at S. */
export function legPnlAtExpiry(l: Leg, S: number): number {
  if (l.kind === "stock") return sgn(l) * l.qty * (S - l.strike);
  const intrinsic = l.kind === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
  return sgn(l) * l.qty * mult(l) * (intrinsic - l.premium);
}
export function pnlAtExpiry(legs: Leg[], S: number): number {
  let s = 0;
  for (const l of legs) s += legPnlAtExpiry(l, S);
  return s;
}
/** Mark-to-model P&L today (B-S with given days/IV) if the underlying is at S. */
export function pnlNow(legs: Leg[], S: number, T: number, r: number, sigma: number): number {
  let s = 0;
  for (const l of legs) {
    if (l.kind === "stock") { s += sgn(l) * l.qty * (S - l.strike); continue; }
    const v = blackScholes(S, l.strike, T, r, sigma, l.kind).price;
    s += sgn(l) * l.qty * 100 * (v - l.premium);
  }
  return s;
}
/** Net debit (+) / credit (−) in $ for the whole position (options only; stock cost excluded). */
export function netPremium(legs: Leg[]): number {
  let s = 0;
  for (const l of legs) if (l.kind !== "stock") s += sgn(l) * l.qty * 100 * l.premium;
  return s;
}
export function positionGreeks(legs: Leg[], S: number, T: number, r: number, sigma: number) {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) {
    if (l.kind === "stock") { g.delta += sgn(l) * l.qty; continue; }
    const b = blackScholes(S, l.strike, T, r, sigma, l.kind);
    const k = sgn(l) * l.qty * 100;
    g.delta += b.delta * k; g.gamma += b.gamma * k; g.theta += b.theta * k; g.vega += b.vega * k;
  }
  return g;
}

export type PayoffSummary = {
  maxProfit: number | null; // null = unlimited
  maxLoss: number | null;   // positive number = loss size; null = unlimited
  breakevens: number[];
  probProfit: number | null; // 0..1
};

/** Max profit/loss, breakevens and probability of profit at expiry. Unbounded detection via slope beyond the last strike. */
export function analyzePayoff(legs: Leg[], spot: number, T: number, r: number, sigma: number): PayoffSummary {
  if (!legs.length || !(spot > 0)) return { maxProfit: 0, maxLoss: 0, breakevens: [], probProfit: null };
  const strikes = legs.map((l) => l.strike).filter((k) => k > 0);
  const hi = Math.max(spot, ...strikes) * 3;
  const N = 1200;
  let maxP = -Infinity, minP = Infinity;
  const bes: number[] = [];
  let prevX = 0, prevY = pnlAtExpiry(legs, 0);
  maxP = Math.max(maxP, prevY); minP = Math.min(minP, prevY);
  let prob = 0;
  const canProb = T > 0 && sigma > 0;
  let prevAbove = 1;
  for (let i = 1; i <= N; i++) {
    const x = (hi * i) / N;
    const y = pnlAtExpiry(legs, x);
    maxP = Math.max(maxP, y); minP = Math.min(minP, y);
    if ((prevY < 0 && y >= 0) || (prevY > 0 && y <= 0)) {
      const bx = prevY === y ? x : prevX + ((0 - prevY) * (x - prevX)) / (y - prevY);
      if (!bes.some((b) => Math.abs(b - bx) < hi / N)) bes.push(bx);
    }
    if (canProb) {
      const above = probAbove(spot, x, T, r, sigma) ?? 0;
      if ((prevY + y) / 2 > 0) prob += prevAbove - above;
      prevAbove = above;
    }
    prevX = x; prevY = y;
  }
  // Slope beyond the highest strike decides unlimited profit/loss on the upside.
  const slope = pnlAtExpiry(legs, hi * 1.1) - pnlAtExpiry(legs, hi);
  if (canProb && prevY > 0) prob += prevAbove;
  return {
    maxProfit: slope > 1e-6 ? null : maxP,
    maxLoss: slope < -1e-6 ? null : Math.max(0, -minP),
    breakevens: bes.filter((b) => b > 0.01),
    probProfit: canProb ? Math.min(1, Math.max(0, prob)) : null,
  };
}

/** Sensible strike increment for a given underlying price. */
export function strikeStep(spot: number): number {
  if (spot < 5) return 0.5;
  if (spot < 25) return 1;
  if (spot < 200) return 2.5;
  if (spot < 500) return 5;
  return 10;
}
export function roundStrike(x: number, step: number): number {
  return +(Math.round(x / step) * step).toFixed(2);
}
