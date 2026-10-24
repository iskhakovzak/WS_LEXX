/**
 * What-if rule contract shared by the what-if page and the analytics «Что если» tab: the rule shapes and the
 * URL encoding used by «Открыть Что если» links (?rules=…). The rule engine and editors live in components/what-if.
 */

import type { ErrorCode } from "./error-vocab";

export type Side = "long" | "short";

export type CommissionPlan = { type: "commissionPlan"; perShare: number; minPerOrder: number; ecnPerShare: number; keepRegulatory?: boolean };

export type Rule =
  | { type: "dailyLossLimit"; usd: number }
  | { type: "maxTradesPerDay"; n: number }
  | { type: "stopAfterLosses"; n: number }
  | { type: "timeWindow"; from?: string | null; to?: string | null }
  | { type: "priceRange"; min?: number | null; max?: number | null }
  | { type: "minHold"; seconds: number }
  | { type: "excludeTickers"; tickers: string[] }
  | { type: "excludeSide"; side: Side }
  | CommissionPlan
  | { type: "capLoss"; usd: number }
  | { type: "sizeRange"; min?: number | null; max?: number | null }
  | { type: "afterLoss"; minutes: number }
  | { type: "excludeSetups"; setups: string[] }
  | { type: "minGrade"; grade: Grade }
  | { type: "excludeImx" }
  | { type: "noReentry" }
  | { type: "requireStop" }
  /** Scale (estimate): a position above x × the usual size is counted at x×. */
  | { type: "maxSizeRel"; x: number }
  | { type: "excludeMistakes"; codes: ErrorCode[] }
  /** Personal tags only (IMX and the mistakes vocabulary have their own rules). */
  | { type: "excludeTags"; tags: string[] }
  /** Stop the day after giving back `pct`% of a day profit that reached +peak. */
  | { type: "profitGiveback"; peak: number; pct: number }
  | { type: "dailyProfitTarget"; usd: number }
  /** Pause after a WINNING trade (same trader-day). */
  | { type: "afterWin"; minutes: number }
  /** Once the realised day is at −usd: at most k more entries; with floor, none at −floor. */
  | { type: "redZone"; usd: number; k: number; floor?: number | null }
  /** No entries inside [from, to) ET. */
  | { type: "blockWindow"; from: string; to: string }
  | { type: "maxTradesPerTicker"; n: number }
  /** No re-entry into the same ticker for `minutes` after a loss in it. */
  | { type: "noReentryAfterLoss"; minutes: number }
  | { type: "excludeStrategies"; strategies: Strategy[] }
  /** Skip stocks reporting earnings that trading day. */
  | { type: "excludeEarnings" };

/** Strategies a rule may skip (api lib/whatIfTypes WHATIF_STRATEGIES). */
export const STRATEGIES = ["OPG", "Print", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const GRADES = ["A+", "A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

/** Rules → compact URL-safe string (base64url of JSON). Empty list → "". */
export function encodeRules(rules: Rule[]): string {
  if (!rules.length) return "";
  const json = JSON.stringify(rules);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
