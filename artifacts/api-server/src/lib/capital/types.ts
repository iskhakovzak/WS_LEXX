/**
 * Capital allocation engine («Распределение риска») — shared types. The engine (lib/capital/engine.ts, edge.ts) is
 * pure; the loader (load.ts) fills these from the DB, the service (service.ts) turns rows into proposals of the
 * scaling queue (scaling_proposals kind 'limits', migration 0270). Reasons are data (`CapReason`): the texts are
 * rendered per reader in lib/capital/text.ts (server ns `capital`).
 */
import type { RegimeKey } from "../marketRegime/regimes";

export type Direction = "raise" | "keep" | "cut";

/** Desk settings of the engine (lib/settings/registry `capital.*`), read once per run (settings.ts). */
export type CapitalSettings = {
  weights: { edge: number; regime: number; discipline: number };
  /** Max step of one proposal, % of the current daily loss limit. */
  maxStepUpPct: number;
  maxStepDownPct: number;
  /** A smaller change is not worth a decision (no churn). */
  minStepPct: number;
  /** Closed trades in the window a raise / an edge-based cut needs. */
  minTrades: number;
  /** Trading days of history the edge is measured on. */
  windowDays: number;
  includeJuniors: boolean;
  /** Discipline score (0–100) a raise needs / below which the limit is cut whatever the edge. */
  disciplineGate: number;
  disciplineCut: number;
  /** Hard band of the daily loss limit, % of the tier template (cap also ≤ the next tier's template). */
  floorPctOfTier: number;
  capPctOfTier: number;
  /** The desk's total daily loss limit may grow by at most this % per run (raises are scaled down to fit). */
  maxDeskGrowthPct: number;
};

/** One trading day of a trader (by close date): net $, trades, Σ signed R over the trades that have one, the desk regime. */
export type CapDay = { date: string; net: number; trades: number; rSum: number; rCount: number; regime: RegimeKey | null };

/** Discipline facts of the window (sources: behaviour engine index, rule_violations + trading_errors, eod_days, risk_alert_log). */
export type CapDiscipline = {
  /** Mean behaviour discipline index 0–100 (lib/disciplineIndex), null when the engine has no days. */
  index: number | null;
  tradedDays: number;
  /** Traded days whose EOD was closed. */
  closedDays: number;
  /** Rule violations + logged trading errors. */
  violations: number;
  /** Days the risk desk stopped the trader (risk_alert_log level 'breach'). */
  stopDays: number;
};

export type LadderAction = "promote" | "demote" | "hold" | "assign";

export type CapTraderInput = {
  trader: string;
  tierKey: string | null;
  /** Ladder stage (lib/people/stage): «Джун» is excluded unless settings say otherwise; BP bounds follow it. */
  junior: boolean;
  dailyLossLimit: number | null;
  weeklyLossLimit: number | null;
  buyingPower: number | null;
  days: CapDay[];
  discipline: CapDiscipline;
  /** The scaling plan's own recommendation (tier rules): a pending promotion / demotion goes first. */
  ladderAction: LadderAction | null;
  /** A tier proposal is already waiting in the queue. */
  pendingTier: boolean;
};

export type CapTier = { key: string; order: number; dailyLossLimit: number | null };

/** A posterior estimate (shrunk toward 0) with its 80 % interval; `pPos` = P(θ > 0). */
export type Estimate = { n: number; mean: number; se: number; theta: number; sd: number; lo80: number; hi80: number; pPos: number };

export type EdgeEstimate = {
  trades: number;
  days: number;
  /** Expectancy per trade in R (day-clustered bootstrap, shrunk toward 0); null without R. */
  r: Estimate | null;
  /** Net $ per day ÷ the daily loss limit («return on the risk budget»), shrunk toward 0; null without a limit or < 2 days. */
  u: Estimate | null;
  /** 2·P(edge > 0) − 1 averaged over R and $ (−1 … 1). */
  score: number | null;
  proven: boolean;
  negative: boolean;
};

export type RegimeEstimate = { regime: RegimeKey; days: number; u: Estimate | null; score: number | null };

export type DisciplineScore = { score: number | null; parts: { index: number | null; violations: number | null; closed: number | null; stops: number | null } };

export type GateCode =
  | "junior" | "noTier" | "ladder" | "tierPending" | "noLimit" | "fewTrades" | "disciplineBlock" | "disciplineCut"
  | "notProven" | "negativeEdge" | "neutral" | "atCap" | "atFloor" | "smallStep" | "deskCap";

/** A reason as data ($ already in dollars; R in R; shares in %). Rendered by lib/capital/text.ts. */
export type CapReason =
  | { code: "edge"; r: { theta: number; lo: number; hi: number; trades: number } | null; usd: { theta: number; lo: number; hi: number; days: number } | null }
  | { code: "regime"; regime: RegimeKey; usd: { theta: number; lo: number; hi: number } | null; days: number }
  | { code: "noRegime" }
  | { code: "discipline"; score: number | null; index: number | null; violations: number; closedPct: number | null; stopDays: number }
  | { code: "verdict"; direction: Direction; pct: number; fromDaily: number | null; toDaily: number | null; fromBp: number | null; toBp: number | null }
  | { code: "gate"; gate: GateCode; value?: number | null; limit?: number | null; action?: string };

export type Expected = { perDay: number; sdPerDay: number };

export type CapPlanRow = {
  trader: string;
  tierKey: string | null;
  direction: Direction;
  /** Signed step in % of the current daily loss limit (0 for keep). */
  stepPct: number;
  current: { dailyLossLimit: number | null; buyingPower: number | null };
  proposed: { dailyLossLimit: number | null; buyingPower: number | null };
  band: { floor: number | null; cap: number | null };
  composite: number | null;
  edge: EdgeEstimate;
  regime: RegimeEstimate | null;
  discipline: DisciplineScore;
  /** Expected change of the daily net $ (posterior × Δ limit; null for keep). */
  expected: Expected | null;
  reasons: CapReason[];
};

export type Interval80 = { mean: number; lo: number; hi: number };

export type DeskSummary = {
  traders: number;
  riskBefore: number;
  riskAfter: number;
  bpBefore: number;
  bpAfter: number;
  raised: { count: number; usd: number };
  cut: { count: number; usd: number };
  /** Where the risk moves from (cuts) and to (raises), biggest first. */
  from: { trader: string; delta: number }[];
  to: { trader: string; delta: number }[];
  /** Expected change of the desk's net $ (sum of posteriors; independent traders), per day and per 5-day week. */
  expectedPerDay: Interval80;
  expectedPerWeek: Interval80;
  deskCapApplied: boolean;
};

export type CapitalPlan = {
  asOf: string;
  regime: { key: RegimeKey; source: "today" | "week" } | null;
  rows: CapPlanRow[];
  desk: DeskSummary;
  settings: CapitalSettings;
};
