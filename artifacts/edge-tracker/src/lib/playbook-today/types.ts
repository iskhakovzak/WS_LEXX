/**
 * Playbook «Сегодня» — the morning-first playbook (owner 2026-10-18: traders open the playbook in the MORNING to
 * prepare; the library UI was built for curators). One call gives the day map, the setups that fit each window, the
 * trader's own edge per setup, tier locks and today's picks (stored in the personal plan).
 * Web mirror of api-server src/lib/playbookToday/types.ts — keep both identical.
 */

export type TextItem = { key: string; params?: Record<string, string | number | null> };

/** Windows of the NY session, in order. Setups belong to a window by their time of day (timeOfDay / folder). */
export type DayWindowKey = "premarket" | "open" | "trend" | "close";

export interface DayWindow {
  key: DayWindowKey;
  from: string; // "09:30" NY
  to: string; // "10:30" NY
  setupIds: number[];
}

/** The trader's own record with a setup (net R from their linked trades; money never needed here). */
export interface MyEdge {
  trades: number;
  wins: number;
  winRate: number | null; // 0..1
  avgR: number | null;
  totalR: number | null;
  /** «best» = their strongest setup with enough trades, «good», «careful» = negative expectancy, «new» = < 5 trades. */
  verdict: "best" | "good" | "careful" | "new";
  lastTradedOn: string | null;
}

export interface TodaySetup {
  id: number;
  /** Display code from the name, e.g. "1.3". */
  code: string | null;
  name: string;
  folder: string | null;
  window: DayWindowKey | null;
  /** NY time range from the card, e.g. {from:"09:35", to:"10:30"}. */
  time: { from: string; to: string } | null;
  /** Schematic picture key for the cheat sheet, e.g. "orb", "gap_go", "vwap_hold", "flag", "hod_break", "vwap_fade",
   * "failed_breakout", "parabolic", "day2", "gap_fill", "power_hour", "moc", "opening_drive", "red_to_green",
   * "first_pullback", "routine"; null = no picture. */
  schema: string | null;
  /** Locked for this viewer (tier gate): `cheat` is empty and `checklist` is [] (the API redacts them). */
  locked: boolean;
  /** Minimum tier key ("trainee" | "junior" | "trader" | "senior") or null = everyone. */
  minTier: string | null;
  /** How to unlock (quest/achievement condition), shown on the lock. */
  unlock: TextItem | null;
  myEdge: MyEdge | null;
  /** Cheat sheet lines (short, from the structured card). */
  cheat: { entry: string | null; stop: string | null; target: string | null; invalidation: string | null; gradeA: string[] };
  checklist: string[];
}

/** GET /api/playbook/today (viewer = trader; staff may pass ?trader=). */
export interface PlaybookToday {
  date: string; // NY trading day the picks are for
  nyMinutes: number;
  windows: DayWindow[];
  setups: TodaySetup[];
  /** Setups the trader picked for today (personal plan doc.setups). */
  picks: number[];
  /** 1R in $ for the size calculator: personal plan risk per trade, else risk-desk max_risk_per_trade; null = unknown. */
  oneR: { usd: number; source: "plan" | "limits" } | null;
  /** Untagged own trades waiting for a setup (the evening «разметь сделки» quest uses the same count). */
  untagged: number;
  /** NY close days `untagged` covers (the last 5 trading days) — the header names this period. */
  untaggedPeriod: { from: string; to: string } | null;
}

/** PUT /api/playbook/today/picks { setupIds } → PlaybookToday["picks"] (max 3, unlocked only). */
export interface TodayPicksBody { setupIds: number[] }
