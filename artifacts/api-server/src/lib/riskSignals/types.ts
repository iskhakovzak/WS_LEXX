/**
 * Live in-session risk signals (lib/riskSignals/*, migration 0291): shared types and codes. Texts live in i18n (server
 * `notifications.risk_signal`, web namespace `riskSignals`); the DB stores codes and numbers only.
 *
 *   signal          level            severity   what
 *   stop_proximity  "70" / "90"      warn/crit  the day's loss reached that % of the daily loss limit (dashboard numbers)
 *   loss_streak     "3"              warn       N losing trades in a row today (by exit time)
 *   revenge         "size" / "pace"  critical   right after a loss: an entry much bigger than the trader's median size,
 *                                               or entries much faster than the trader's usual pace
 *   off_plan        ticker           warn       a trade on a ticker / setup outside today's plan (only with a plan)
 *   banned_window   "HH:MM"          warn       an entry inside a restricted window around a high-impact event
 *
 * One alert per trader / day / signal / level (UNIQUE in risk_signal_alerts).
 */

export const SIGNALS = ["stop_proximity", "loss_streak", "revenge", "off_plan", "banned_window"] as const;
export type Signal = (typeof SIGNALS)[number];
export const isSignal = (v: unknown): v is Signal => (SIGNALS as readonly string[]).includes(v as string);

export type SignalSeverity = "warn" | "critical";

/** One trade as the signals see it (subset of lib/behaviorEngine BehaviorTrade + the playbook link). Times: epoch ms. */
export type SignalTrade = {
  id: number;
  ticker: string;
  result: "win" | "loss" | "be" | "open" | null;
  /** Net $ (pnl − |fees|, lib/tradeMath), null while unknown. */
  net: number | null;
  qty: number | null;
  entry: number | null;
  entryAt: number | null;
  exitAt: number | null;
  /** Entry minute of the NY day (9:30 → 570). */
  entryMin: number | null;
  playbookId: number | null;
};

/** The trader's own normal (lookback days before the day): median position size and entry pace. */
export type Baseline = {
  trades: number;
  /** Median |qty × entry| in $. */
  medianNotional: number | null;
  /** Entries per minute of the active session (first entry → last fill of each day). */
  entriesPerMin: number | null;
};

/** Today's plan: own plan tickers (+ the desk plan's in-play), picked playbook setups. null = no own plan today. */
export type PlanContext = { tickers: ReadonlySet<string>; setups: ReadonlySet<number> } | null;

/** A restricted window in NY minutes of the day (inclusive), around one event time. */
export type BannedWindow = { key: string; startMin: number; endMin: number; event: string };

export type SignalConfig = {
  enabled: boolean;
  /** Ascending % of the daily loss limit; the last one is critical. */
  stopPcts: number[];
  streakLosses: number;
  revengeWindowMin: number;
  revengeSizeRatio: number;
  revengePaceRatio: number;
  offPlan: boolean;
  newsBeforeMin: number;
  newsAfterMin: number;
  lookbackDays: number;
  savedMinSample: number;
  telegram: boolean;
};

/** Everything the detectors need about one trader's day. */
export type DayContext = {
  trades: SignalTrade[];
  dailyLimit: number | null;
  plan: PlanContext;
  windows: BannedWindow[];
  baseline: Baseline | null;
};

export type HitStats = Record<string, number | string | null>;

export type Hit = {
  signal: Signal;
  level: string;
  severity: SignalSeverity;
  /** Trigger time, epoch ms. */
  at: number;
  tradeId: number | null;
  stats: HitStats;
};
