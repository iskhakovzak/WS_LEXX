/**
 * «Тренажёр» — ONE trainer instead of three (chart-lab «Тренировка», the simulator, «Мои худшие дни»), owner
 * decision 2026-10-18. Modes:
 *   my_days    — relive an own losing trade up to the real entry (existing sim own mode);
 *   daily      — «Задача дня»: the same ticker-day for the whole desk, picked at 08:30 NY; desk ranking by R; reveal and
 *                discussion after the player finishes (and for everyone after the close);
 *   find_entry — «Найди вход»: 20–30 s drills on playbook setups: bars up to the decision window, the trader clicks
 *                the entry; scored by distance to the reference entry; feeds setup mastery;
 *   free       — the fair random game (existing sim intraday/swing).
 * All attempts are stored on the server (no browser-only stats) and feed quests / achievements / mastery.
 * Money: R-based only; names in desk rankings follow privacy.hideNamesFromTraders (aliases for traders).
 * Web mirror of api-server src/lib/trainer/types.ts — keep identical.
 */
export type TextItem = { key: string; params?: Record<string, string | number | null> };
export type TrainerMode = "my_days" | "daily" | "find_entry" | "free";

export interface DailyChallengeState {
  date: string; // NY date of the challenge
  /** Hidden until the viewer finished (or the session closed): the ticker and the real date of the bars. */
  revealed: { ticker: string; barsDate: string } | null;
  played: boolean;
  activeGameId: number | null;
  /** The viewer's daily game of this date in any status (active / finished / abandoned) — opens the review after it. */
  gameId?: number | null;
  my: { r: number | null; rank: number | null; of: number } | null;
  /** Desk ranking (after the viewer finished, or once the ranked window closed). label = name (staff / names shown) or alias key "t<n>". */
  ranking: { label: string; me: boolean; r: number | null; trades: number }[];
  streak: number; // days in a row the viewer played the daily challenge
  /** The ranked window (Волна 1, item 1.8): from the challenge day's close until the next trading day's pick time, NY
   * dates and HH:MM; `open` = new ranked games may start now. Absent on older servers. */
  window?: { from: { date: string; time: string }; until: { date: string; time: string }; open: boolean };
}

/** «Контекст дня» of a trainer exercise (server lib/sim/context.ts DayContext; catalyst rules lib/sim/catalyst.ts). */
export interface TrainerCatalyst {
  kind: "earnings" | "news";
  source: "earnings" | "news" | "event" | "big7" | "analyst";
  /** After the previous close / before the open / during the session; null = unknown. */
  timing: "prevAfter" | "pre" | "session" | null;
  /** Before the reveal: the headline with the ticker, company names and dates masked («***»), or null (generic text). */
  headline: string | null;
  publisher: string | null;
  /** Analyst action: up / down / init, or "targets" = several firms moved their targets (firms = how many). */
  analyst: { action: string; firm: string | null; from: string | null; to: string | null; firms?: number } | null;
  /** After the reveal only. */
  full: { headline: string | null; at: string | null; url: string | null } | null;
}

export interface TrainerDayContext {
  /** Gap % vs the previous close: premarket price (gapAt "pre") or the open ("open"). */
  gapPct: number | null;
  gapAt: "pre" | "open";
  minGapPct: number;
  catalysts: TrainerCatalyst[];
  /** usd: 2 significant digits, null before the reveal for a mega cap; basis "day" = shares × the previous close. */
  cap: { usd: number | null; bucket: "nano" | "micro" | "small" | "mid" | "large" | "mega"; basis: "day" | "now" } | null;
  floatShares: number | null;
  pmVolume: number | null;
}

export interface FindEntryDrill {
  id: number;
  setupId: number;
  setupCode: string | null;
  setupName: string;
  side: "long" | "short";
  tf: "1m" | "2m" | "5m";
  /** Bars shown (fake timeline like the simulator; real ticker/date hidden until answered). */
  bars: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  /** The window (bar indices) in which the entry should be picked. */
  window: { from: number; to: number };
  /** «Контекст дня» + the daily chart before the day (fake dates); absent on older servers. */
  context?: {
    day: TrainerDayContext;
    daily: { t: number; o: number; h: number; l: number; c: number; v: number }[];
    levels: { pdc: number | null; hi52: number | null; lo52: number | null };
  };
}

export interface FindEntryAnswer {
  score: number; // 0..100
  ideal: { barIndex: number; price: number };
  yours: { barIndex: number; price: number };
  explanation: TextItem;
  revealed: { ticker: string; date: string; source: "playbook_example" | "desk_trade" };
  barsAfter: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  masteryDelta: number;
  /** «Контекст дня» with the full catalyst text; absent on older servers. */
  context?: { day: TrainerDayContext };
}

/** GET /api/trainer/home */
export interface TrainerHome {
  daily: DailyChallengeState;
  myDays: { candidates: number; active: { gameId: number; ticker: string } | null };
  findEntry: {
    setups: {
      setupId: number; code: string | null; name: string; drills: number; masteryLevel: number;
      /** Mastery points now / needed for the next level (null at the top) and the passed drills behind them (UMID-18). */
      masteryPoints?: number; masteryNext?: number | null; drillsPassed?: number;
    }[];
    streak: number;
    /** Passed drills per mastery point (gamification.masteryDrillsPerPoint) and the pass score (trainer.drillPassScore). */
    drillsPerPoint?: number;
    passScore?: number;
  };
  stats: { attempts30d: number; avgR30d: number | null; beatReal: number; findEntryAccuracy: number | null };
}

/** GET/PUT /api/chart/drawings?ticker=&date= — per-user drawings on a ticker-day (replay / analysis). */
export interface ChartDrawing {
  id: string;
  kind: "hline" | "trend" | "rect";
  points: { t: number; p: number }[]; // unix seconds + price
  label?: string | null;
  color?: "accent" | "up" | "down" | "warn" | null; // theme roles, not hex
  /** The trade a note belongs to (/chart-lab notes); absent = the ticker in general. */
  tradeId?: number | null;
}
