/**
 * Personal profile («Профиль»: характеристика + автобиография + аналитика) — shared types of the pure modules
 * (attributes.ts, timeline.ts, analytics.ts), the loader (load.ts) and the route (routes/profile.ts).
 *
 * Every text a person sees is built on the web from codes + params (ARCHITECTURE §0.5): the server sends attribute
 * keys, event kinds and numbers, never sentences.
 */

/** One closed trade with a P&L, as the profile reads it (net = gross − |fees|, day = NY close day). */
export type ProfileTrade = {
  day: string;
  /** Order inside the day: seconds after NY midnight of the entry (falls back to the day sequence). */
  seq: number;
  net: number;
  /** "win" | "loss" | "be" (canonical result). */
  result: "win" | "loss" | "be";
  side: "long" | "short" | null;
  horizon: "intraday" | "overnight" | "swing";
  holdSec: number | null;
  /** Seconds after NY midnight of the entry, null when unknown. */
  entrySec: number | null;
  ticker: string;
  setup: string | null;
  /** Entry price (for the price buckets of the style fingerprint). */
  price: number | null;
};

/** One trading day of a trader. `peak` = the highest intraday cumulative net after any trade of the day. */
export type DayAgg = { day: string; net: number; n: number; wins: number; losses: number; peak: number };

export const ATTR_KEYS = ["discipline", "risk", "stability", "edge", "patience", "execution", "recovery", "growth"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

/** How an attribute was measured (picks the explanation text on the web). */
export type AttrBasis =
  | "violations" | "noRules"
  | "limits" | "tail"
  | "days"
  | "bootstrap" | "shrunk"
  | "frequency"
  | "giveback"
  | "afterLoss"
  | "trend";

export type Attribute = {
  key: AttrKey;
  /** 0–100; null when there is almost nothing to measure (fewer than 3 units). */
  score: number | null;
  /** Units the score stands on (days, trades, pairs — `unit` says which). */
  sample: number;
  /** Units needed before the score is trusted. */
  minSample: number;
  unit: "days" | "trades" | "pairs";
  /** sample < minSample (or nothing to measure against): the web shows «мало данных», never a precise number. */
  low: boolean;
  basis: AttrBasis;
  /** Numbers behind the score for the explanation (money in $, shares 0..1). */
  inputs: Record<string, number | null>;
  /** Median score of the desk (traders with enough data); null when fewer than DESK_MIN traders qualify. */
  deskMedian: number | null;
};

export type RiskLimits = { dailyLoss: number | null; maxDrawdown: number | null };

export type AttrInput = {
  /** Closed trades of the scoring window, sorted by (day, seq). */
  trades: readonly ProfileTrade[];
  /** Rule violations in the window (not archived). */
  violations: number;
  /** Enabled rules the trader has (personal + desk). */
  rulesActive: number;
  limits: RiskLimits | null;
  /** Median trades per active day of the desk (null: unknown). */
  deskTradesPerDay: number | null;
  /** Desk prior of the per-trade expectancy ($) for partial pooling (null: none). */
  edgePrior: { mu: number; tau: number } | null;
  /** Seed part (trader name): bootstraps are reproducible per person. */
  seed: string;
};

export type Archetype = "newcomer" | "scalper" | "daytrader" | "swing" | "mixed";

export type ProfileSummary = {
  archetype: Archetype;
  /** The two strongest trusted attributes (score ≥ 60), strongest first. */
  top: AttrKey[];
  /** The weakest trusted attribute when it is below 60; null when everything trusted is ≥ 60. */
  weak: AttrKey | null;
  /** Fewer than 4 trusted attributes: the summary says so. */
  lowData: boolean;
};

export type TimelineKind =
  | "joined" | "first_trade" | "milestone_trades" | "stage_change" | "readiness" | "achievement"
  | "best_day" | "best_week" | "best_month" | "first_green_month" | "drawdown" | "recovery"
  | "rule_adopted" | "intervention";

export type TimelineEvent = { kind: TimelineKind; day: string; params: Record<string, string | number | null> };

export type Era = { month: string; trades: number; net: number; activeDays: number; winRate: number | null };
