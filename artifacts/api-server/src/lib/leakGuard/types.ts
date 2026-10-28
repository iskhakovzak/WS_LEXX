/**
 * Live leak guard (lib/leakGuard/*, migration 0267): shared types and codes. Texts live in i18n (server
 * `notifications.leak_guard`, web namespace `leakGuard`); the DB stores codes and numbers only.
 *
 *   pattern   after_loss      a closed losing trade → «pause N minutes» (re-entering right after a loss)
 *             first_trade     the session starts → «first trade at half size» (the «1-я сделка дня» leak)
 *             rule_violation  an auto rule was just broken → «pause W minutes» (trading on after a violation)
 *             near_stop       the day reached the warn share of the daily stop (live, with unrealized) → «pause»
 *   rule      reentry / green_to_red / open_window / idea_limit — desk rules for everyone (rules.ts), not personal costs
 *   level     soft  banner + notification with a countdown
 *             firm  soft + a required acknowledgement; the curator is told when it is ignored
 *             hard  firm + the trader is shown «на паузе» on the risk desk and the risk manager is told to act
 *             off   no guard for this trader
 */

import type { RulesCfg } from "./rules";

export const GUARD_PATTERNS = ["after_loss", "first_trade", "rule_violation", "near_stop", "reentry", "green_to_red", "open_window", "idea_limit"] as const;
/** Desk rule patterns (rules.ts): raised for everyone, not gated by the personal profile. */
export const RULE_PATTERNS = ["reentry", "green_to_red", "open_window", "idea_limit"] as const;
export type RulePattern = (typeof RULE_PATTERNS)[number];
/** Personal patterns (profile.ts): raised only when they cost this trader money. */
export type PersonalPattern = Exclude<GuardPattern, RulePattern>;
export const isRulePattern =(p: string): p is RulePattern => (RULE_PATTERNS as readonly string[]).includes(p);
export type GuardPattern = (typeof GUARD_PATTERNS)[number];

export const GUARD_LEVELS = ["soft", "firm", "hard"] as const;
export type GuardLevel = (typeof GUARD_LEVELS)[number];
export const LEVEL_CHOICES = ["off", "soft", "firm", "hard"] as const;
export type LevelChoice = (typeof LEVEL_CHOICES)[number];

/** How an event ended (settled). `late` = the at-risk trade happened before the guard could see the trigger. */
export const GUARD_OUTCOMES = ["complied", "ignored", "late", "no_trades", "unknown"] as const;
export type GuardOutcome = (typeof GUARD_OUTCOMES)[number];

/** Why an event was recorded without telling anyone. */
export type SilentReason = "quiet" | "cap" | "stale";

/** One minimal trade as the guard sees it (lib/behaviorEngine BehaviorTrade subset). Times: epoch ms. */
export type GuardTrade = {
  id: number;
  /** NY trading date of the entry. */
  date: string;
  result: "win" | "loss" | "be" | "open" | null;
  net: number | null;
  qty: number | null;
  entry: number | null;
  entryAt: number | null;
  exitAt: number | null;
  horizon: "intraday" | "overnight" | "swing";
  /** Ticker / side (ticker-scoped rule events count only later entries in the same ticker). */
  ticker?: string;
  side?: "long" | "short" | null;
};

/** A trader's personal numbers for one pattern (lookback history). */
export type PatternStat = {
  pattern: GuardPattern;
  /** Trigger occurrences in the history (losses / days / violations / warn crossings). */
  triggers: number;
  /** At-risk trades in the history (taken inside the window after a trigger). */
  atRisk: number;
  /** Average net of the at-risk trades and of every other trade (the trader's norm). */
  atRiskAvg: number | null;
  baselineAvg: number | null;
  /** Per at-risk trade: norm − at-risk average (positive = the leak costs this much per trade). */
  costPerTrade: number | null;
  /** Expected cost per trigger = Σ excess loss of the at-risk trades / triggers (the «saved» estimate when complied). */
  costPerTrigger: number | null;
  /** Welch t of at-risk vs norm (negative = at-risk trades are worse). */
  tStat: number | null;
  /** Costs this trader money: enough at-risk trades, a big enough cost, and a t below −minTStat. */
  costly: boolean;
  /** first_trade only: median notional of the first trade of the day (the «half size» reference). */
  medianNotional?: number | null;
};

export type PersonalProfile = Partial<Record<GuardPattern, PatternStat>>;

/** Guard settings resolved from the desk registry (lib/leakGuard/config.ts). */
export type GuardConfig = {
  enabled: boolean;
  patterns: Record<PersonalPattern, boolean>;
  pauseMinutes: number;
  violationPauseMinutes: number;
  nearStopPauseMinutes: number;
  /** first_trade «half size»: a first trade at most this share of the median first-trade notional complies. */
  firstTradeSizeRatio: number;
  minOccurrences: number;
  minCostUsd: number;
  minTStat: number;
  lookbackDays: number;
  ackMinutes: number;
  maxEventsPerDay: number;
  /** Share of the daily loss limit that counts as «close to the stop» (riskMetrics WARN_PCT / 100). */
  warnShare: number;
  levelByStage: Record<"junior" | "trader" | "senior", LevelChoice>;
  quiet: { enabled: boolean; fromMin: number; toMin: number };
  telegram: boolean;
  /** Desk rule patterns (rules.ts). */
  rules: RulesCfg;
};

/** A detected event before it is stored. */
export type GuardDraft = {
  trader: string;
  day: string;
  pattern: GuardPattern;
  sourceKey: string;
  triggerTradeId: number | null;
  triggeredAt: number;
  pauseUntil: number | null;
  /** The at-risk trade already happened when the guard saw the trigger (data latency). */
  late: boolean;
  /** Pause already over when detected: recorded for the latency numbers, nobody is told. */
  stale: boolean;
  costPerTrade: number | null;
  costPerTrigger: number | null;
  stats: Record<string, number | string | null>;
};

/** The settled result of one event. */
export type GuardSettlement = {
  outcome: GuardOutcome;
  atRiskIds: number[];
  /** Σ net of the at-risk trades (null when none). */
  actualNet: number | null;
  /** Estimated $ the trader kept by complying (costPerTrigger, scaled for first_trade by the size cut). */
  saved: number;
  /** Actual $ lost on the at-risk trades taken against the guard. */
  lost: number;
};
