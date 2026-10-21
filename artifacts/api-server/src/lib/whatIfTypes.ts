/**
 * «Что-если» engine — shared types and small pure helpers (lib/whatIf.ts re-exports all of them, so older imports keep
 * working). No I/O, no Date.now(), no Math.random(): the rule passes (whatIfPasses), the grid (whatIfGrid) and the
 * suggestion search (whatIfSuggest) build on these.
 */
import type { ErrorVocabCode } from "./tradingErrors";

/* ───────────────────────── Types ───────────────────────── */

export type Side = "long" | "short";
export type Horizon = "intraday" | "overnight" | "swing";
export type ResultKind = "win" | "loss" | "be";

export interface SimTrade {
  id: number;
  /** Trading day (New York calendar date), YYYY-MM-DD. */
  day: string;
  /** Day the result is realised (exit date of a multi-day hold); absent ⇒ `day`. */
  closeDay?: string;
  /** Minutes since NY midnight of the first entry fill (fractional allowed); null when unknown. */
  entryMin: number | null;
  ticker: string;
  side: Side | null;
  qty: number | null;
  entry: number | null;
  exit: number | null;
  /** Gross P&L ($, before fees). Null ⇒ the trade has no money result and is ignored by every money metric. */
  gross: number | null;
  /** Total costs (commission + ECN + regulatory), always ≥ 0. */
  fees: number;
  /** Hold time in seconds; null when unknown. */
  holdSec: number | null;
  r: number | null;
  stop: number | null;
  setup: string | null;
  /** Raw stored tags (the engine reads `mistakes` / `ptags` instead). */
  tags: string[];
  horizon: Horizon;
  result: ResultKind | null;
  /** Fee components from the broker when known (comm, ecn, sec, taf, cat, nscc, clr, …). */
  feeBreakdown?: Record<string, number> | null;
  /** Number of fills (orders) in the round trip; null ⇒ assume 2 (one entry, one exit). */
  fills?: number | null;
  /** Secondary order inside the day when entry times tie / are unknown (import order). */
  seq: number;
  /** Trader's own grade of the trade (A+, A, B, C); null / absent when not graded. */
  grade?: string | null;
  /** Owner of the trade: day rules run per trader-day (team scope); null / absent ⇒ one trader. */
  trader?: string | null;
  /** Close-auction (IMX) trade ENTERED inside the IMX window (lib/imx imxSql + the entry time, routes/whatif rowToSim). */
  imx?: boolean;
  /** Re-entry into the same ticker (trades.reentry_of set by the structure pass). */
  reentry?: boolean;
  /** Notional / the trader's 60-day median notional; null when unknown. */
  sizeRel?: number | null;
  /** A stop price is recorded (trades.stop / structure.stopPrice): true / false (none recorded), null = not derived. */
  hasStop?: boolean | null;
  /** Mistake vocabulary codes among the tags (aliases normalised). */
  mistakes?: ErrorVocabCode[];
  /** Personal tags (desk tags — IMX and the mistakes vocabulary — removed). */
  ptags?: string[];
}

export type Rule =
  | { type: "dailyLossLimit"; usd: number }
  | { type: "maxTradesPerDay"; n: number }
  | { type: "stopAfterLosses"; n: number }
  /** Keep only entries inside [from, to) in ET, "HH:MM". Either bound may be omitted. */
  | { type: "timeWindow"; from?: string | null; to?: string | null }
  /** Keep only trades whose entry price is inside [min, max]. */
  | { type: "priceRange"; min?: number | null; max?: number | null }
  | { type: "minHold"; seconds: number }
  | { type: "excludeTickers"; tickers: string[] }
  | { type: "excludeSide"; side: Side }
  /** Hypothetical tariff: commission per share with a per-order minimum, ECN per share; regulatory fees optionally kept. */
  | { type: "commissionPlan"; perShare: number; minPerOrder: number; ecnPerShare: number; keepRegulatory?: boolean }
  /** Approximation: every loss worse than −usd becomes −usd (we do not know whether price would have come back). */
  | { type: "capLoss"; usd: number }
  /** Keep only trades whose size (shares) is inside [min, max]. */
  | { type: "sizeRange"; min?: number | null; max?: number | null }
  /** Skip entries taken within `minutes` after a losing trade of the same trader closed the same day (revenge trades). */
  | { type: "afterLoss"; minutes: number }
  /** Skip trades of these setups (case-insensitive). Trades without a setup are kept. */
  | { type: "excludeSetups"; setups: string[] }
  /** Keep only trades graded at least `grade` (A+ > A > B > C); ungraded trades are dropped. */
  | { type: "minGrade"; grade: Grade }
  /** Skip close-auction (IMX) entries (entered inside the IMX window). */
  | { type: "excludeImx" }
  /** Skip re-entries into the same ticker. */
  | { type: "noReentry" }
  /** Keep only trades with a recorded stop (hasStop false goes, unknown stays); needs ≥ 15% of the trades recorded. */
  | { type: "requireStop" }
  /** Approximation: a position above x × the usual size is scaled down to x× (gross and fees scale alike). */
  | { type: "maxSizeRel"; x: number }
  /** Skip trades marked with any of these mistakes. */
  | { type: "excludeMistakes"; codes: ErrorVocabCode[] }
  /** Skip trades carrying any of these personal tags (case-insensitive). */
  | { type: "excludeTags"; tags: string[] }
  /** Stop the trader's day once it gave back `pct`% of a day profit that had reached +peak. */
  | { type: "profitGiveback"; peak: number; pct: number }
  /** Stop the trader's day once it is up +usd. */
  | { type: "dailyProfitTarget"; usd: number };

/** Longest personal tag / setup name a rule takes (routes/whatif ruleSchema; the grid never emits a longer one). */
export const MAX_TAG_LEN = 60;
export const MAX_SETUP_LEN = 80;

export const GRADES = ["A+", "A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];
/** 0 = best (A+); null when the value is not a known grade. */
export function gradeRank(g: string | null | undefined): number | null {
  const i = GRADES.indexOf(String(g ?? "").trim().toUpperCase() as Grade);
  return i < 0 ? null : i;
}

export type RuleType = Rule["type"];

export type ExclusionReason =
  | "dailyLossLimit" | "maxTradesPerDay" | "stopAfterLosses" | "timeWindow" | "priceRange" | "minHold" | "excludeTickers" | "excludeSide"
  | "sizeRange" | "afterLoss" | "excludeSetups" | "minGrade"
  | "excludeImx" | "noReentry" | "requireStop" | "excludeMistakes" | "excludeTags" | "profitGiveback" | "dailyProfitTarget";
export type ChangeReason = "commissionPlan" | "capLoss" | "maxSizeRel";

export interface ExcludedTrade {
  id: number;
  day: string;
  ticker: string;
  net: number;
  reason: ExclusionReason;
  detail: string;
}

export interface ChangedTrade {
  id: number;
  day: string;
  ticker: string;
  reason: ChangeReason;
  before: number;
  after: number;
  detail: string;
  /** True when the number is an approximation (capLoss, maxSizeRel), not a recomputation from fills. */
  estimate: boolean;
}

export interface DayResult {
  day: string;
  net: number;
  gross: number;
  fees: number;
  trades: number;
}

export interface EquityPoint {
  day: string;
  net: number;
  cum: number;
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  be: number;
  gross: number;
  fees: number;
  net: number;
  /** W / (W + L), break-even excluded; null when no decided trades. */
  winRate: number | null;
  /** Σ net⁺ / |Σ net⁻|; null when there are no losses (never ∞). */
  profitFactor: number | null;
  /** Mean net per trade. */
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Canonical max drawdown (≤ 0): end-of-day cumulative net curve by close date (lib/tradeMath maxDrawdownByDay). */
  maxDrawdown: number;
  days: number;
  bestDay: DayResult | null;
  worstDay: DayResult | null;
  dailyMean: number | null;
  dailyStd: number | null;
  /** Sharpe-like: mean daily net / std of daily net, annualised by √252. Null when < 2 days or zero variance. */
  sharpe: number | null;
  maxLossStreak: number;
  /** fees / |gross|; null when gross is 0. */
  feePctOfGross: number | null;
  feePerTrade: number | null;
  shares: number;
  feePerShare: number | null;
  /** Σ R of the trades that have an R (stop / risk known); null when none has. Money rules (capLoss) do not change R. */
  totalR: number | null;
  /** Trades with a known R. */
  rCount: number;
}

export interface BootstrapSummary {
  iters: number;
  /** Number of days resampled (paired). */
  days: number;
  /** 95% CI of the total net difference (scenario − baseline) over the period. */
  diffTotal: { mean: number; lo: number; hi: number };
  /** 95% CI of mean daily net for baseline and scenario. */
  dailyExpectancy: { base: { mean: number; lo: number; hi: number }; scenario: { mean: number; lo: number; hi: number } };
  /** Distribution of a simulated 21-day month under the scenario. */
  month: { p5: number; p25: number; p50: number; p75: number; p95: number; probPositive: number };
  monthBase: { p5: number; p25: number; p50: number; p75: number; p95: number; probPositive: number };
  /** CI of the difference excludes zero. */
  significant: boolean;
  /** n < 30 days or n < 30 trades — too little to trust. */
  smallSample: boolean;
}

export interface SkippedRule { rule: RuleType; reason: string }

export interface ScenarioResult {
  rules: Rule[];
  baseline: Metrics;
  scenario: Metrics;
  baselineEquity: EquityPoint[];
  scenarioEquity: EquityPoint[];
  baselineDaily: DayResult[];
  scenarioDaily: DayResult[];
  excluded: ExcludedTrade[];
  changed: ChangedTrade[];
  skipped: SkippedRule[];
  /** Ids of the trades that remain in the scenario, in simulation order. */
  keptIds: number[];
  bootstrap: BootstrapSummary | null;
}

/* ───────────────────────── Small helpers ───────────────────────── */

export function netOf(t: SimTrade): number | null {
  return t.gross == null ? null : t.gross - Math.abs(t.fees);
}

/** "HH:MM" → minutes since midnight; null when malformed. */
export function parseHm(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function fmtHm(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Sort by day, entry time (unknown last), then import order. */
export function sortSim(trades: SimTrade[]): SimTrade[] {
  return [...trades].sort(
    (a, b) => a.day.localeCompare(b.day) || (a.entryMin ?? 1e9) - (b.entryMin ?? 1e9) || a.seq - b.seq || a.id - b.id,
  );
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Key of a trader-day: day rules (pass 3) and the grid's per-day quantiles work per trader inside a day. */
export function traderDayKey(t: { trader?: string | null; day: string }): string {
  return `${t.trader ?? ""}\u0001${t.day}`;
}

/* ───────────────────────── RNG (deterministic) ───────────────────────── */

/** mulberry32 — same seed ⇒ same resamples on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
