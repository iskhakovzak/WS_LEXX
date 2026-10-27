/**
 * The trader's day state — pure model (unit-tested in __tests__/dayState.test.ts). One answer to «what does this person
 * need first right now», shared by the dashboard (GET /api/me/state), the curator's team view and the silence job.
 *
 *   stopped        any halt of the risk desk (daily / weekly stop, max drawdown) — the same computeMetrics stop the
 *                  dashboard hero shows (routes/risk deskSnapshot = GET /risk/me inputs)
 *   paused         traded before, but no trades for ≥ dayState.pausedDays trading days (NYSE holidays skipped)
 *   newcomer       a trader (not staff) with fewer than dayState.newcomerTrades closed trades, within
 *                  dayState.newcomerMaxDays of the account (0 = no time bound)
 *   premarket / session / after_session   the time of day in New York; a weekend or a full-day holiday reads as
 *                  premarket (the next session is what is ahead)
 *
 * Precedence: stopped > paused > newcomer > the time of day. A paused newcomer is paused (the return matters more
 * than the path), a stopped one is stopped. Numbers come in as facts; nothing here computes P&L, win rate or drawdown.
 */
import { addDays, isWeekend } from "../tradingDate";
import { tradingDaysAfter } from "../eodLogic";

export const TRADER_STATES = ["stopped", "paused", "newcomer", "premarket", "session", "after_session"] as const;
export type TraderStateKey = (typeof TRADER_STATES)[number];
export type ClockState = "premarket" | "session" | "after_session";
/** NY phase of `today`: closed = weekend or full-day market holiday. */
export type DayPhase = "premarket" | "session" | "afterclose" | "closed";

export type DayStateCfg = {
  pausedDays: number;
  newcomerTrades: number;
  newcomerMaxDays: number;
  staleStepDays: number;
};

export type TradeDay = { date: string; trades: number; pnl: number | null };

export type StateFacts = {
  trader: string;
  today: string;
  phase: DayPhase;
  staff: boolean;
  halted: boolean;
  /** The stop rule when halted: "stop" (daily) | "weekly" | "drawdown". */
  stopState: string | null;
  closedTrades: number;
  accountAgeDays: number | null;
  /** Own days with trades up to today, ascending. */
  tradeDays: readonly TradeDay[];
  /** Days closed in the journal (eod_days.closed_at). */
  closedReviewDays: ReadonlySet<string>;
  /** Full-day market holidays. */
  marketClosed: ReadonlySet<string>;
};

export type Backlog = {
  /** Own trading days without a closed review (last BACKLOG_WINDOW_DAYS calendar days, finished sessions only). */
  count: number;
  /** Of them, older than `freshFrom` — never the main next step, summarised as one line. */
  stale: number;
  oldest: string | null;
  latest: string | null;
  /** The oldest day that may still be «the next step» (dayState.staleStepDays trading days back from today). */
  freshFrom: string;
};

export type TraderState = {
  trader: string;
  state: TraderStateKey;
  /** What the day would be without a stop / pause / newcomer path. */
  clock: ClockState;
  phase: DayPhase;
  today: string;
  stop: { state: string } | null;
  lastTrade: TradeDay | null;
  /** Trading days without trades since the last trade day (null = never traded). */
  silentDays: number | null;
  closedTrades: number;
  newcomer: { trades: number; target: number } | null;
  backlog: Backlog;
  thresholds: { pausedDays: number; newcomerTrades: number; staleStepDays: number };
};

/** Days with trades older than this many calendar days are history, not backlog (the dashboard's STALE_DAYS). */
export const BACKLOG_WINDOW_DAYS = 30;

const isOpenDay = (d: string, closed: ReadonlySet<string>) => !isWeekend(d) && !closed.has(d);

/** The open day `n` trading days before `date` (n = 0 → `date` itself, even when closed). */
export function tradingDaysBack(date: string, n: number, closed: ReadonlySet<string>): string {
  let d = date;
  for (let k = 0, i = 0; k < n && i < 4000; i++) {
    d = addDays(d, -1);
    if (isOpenDay(d, closed)) k++;
  }
  return d;
}

export function clockOf(phase: DayPhase): ClockState {
  if (phase === "session") return "session";
  if (phase === "afterclose") return "after_session";
  return "premarket";
}

/** Has today's session finished (its trades can be closed, a day without trades counts as silent)? */
const sessionOver = (phase: DayPhase) => phase === "afterclose" || phase === "closed";

/** Trading days without trades after `last` — up to today once the session is over, else up to yesterday. */
export function silentDaysOf(last: string | null, today: string, phase: DayPhase, closed: ReadonlySet<string>): number | null {
  if (!last) return null;
  const ref = sessionOver(phase) ? today : addDays(today, -1);
  return tradingDaysAfter(last.slice(0, 10), ref, closed);
}

export function backlogOf(f: Pick<StateFacts, "today" | "phase" | "tradeDays" | "closedReviewDays" | "marketClosed">, staleStepDays: number): Backlog {
  const windowFrom = addDays(f.today, -BACKLOG_WINDOW_DAYS);
  const lastClosable = sessionOver(f.phase) ? f.today : addDays(f.today, -1);
  const open = f.tradeDays
    .filter((d) => d.trades > 0 && d.date >= windowFrom && d.date <= lastClosable && !f.closedReviewDays.has(d.date))
    .map((d) => d.date)
    .sort();
  const freshFrom = tradingDaysBack(f.today, Math.max(1, staleStepDays), f.marketClosed);
  return { count: open.length, stale: open.filter((d) => d < freshFrom).length, oldest: open[0] ?? null, latest: open.at(-1) ?? null, freshFrom };
}

export function isNewcomer(f: Pick<StateFacts, "staff" | "closedTrades" | "accountAgeDays">, cfg: Pick<DayStateCfg, "newcomerTrades" | "newcomerMaxDays">): boolean {
  if (f.staff || cfg.newcomerTrades <= 0 || f.closedTrades >= cfg.newcomerTrades) return false;
  return cfg.newcomerMaxDays <= 0 || f.accountAgeDays == null || f.accountAgeDays <= cfg.newcomerMaxDays;
}

/** The state with its precedence (see the header). */
export function resolveState(f: StateFacts, cfg: DayStateCfg): TraderState {
  const lastTrade = [...f.tradeDays].reverse().find((d) => d.trades > 0) ?? null;
  const silentDays = silentDaysOf(lastTrade?.date ?? null, f.today, f.phase, f.marketClosed);
  const clock = clockOf(f.phase);
  const newcomer = isNewcomer(f, cfg);
  const paused = lastTrade != null && silentDays != null && silentDays >= Math.max(1, cfg.pausedDays);
  const state: TraderStateKey = f.halted ? "stopped" : paused ? "paused" : newcomer ? "newcomer" : clock;
  return {
    trader: f.trader,
    state,
    clock,
    phase: f.phase,
    today: f.today,
    stop: f.halted ? { state: f.stopState ?? "stop" } : null,
    lastTrade,
    silentDays,
    closedTrades: f.closedTrades,
    newcomer: newcomer ? { trades: f.closedTrades, target: cfg.newcomerTrades } : null,
    backlog: backlogOf(f, cfg.staleStepDays),
    thresholds: { pausedDays: cfg.pausedDays, newcomerTrades: cfg.newcomerTrades, staleStepDays: cfg.staleStepDays },
  };
}

// ─── the silence signal (job traders.silence) ───────────────────────────────

export type SilenceFinding =
  | { kind: "silence"; trader: string; days: number; last: string }
  | { kind: "reviews"; trader: string; count: number; oldest: string };

/**
 * Who the curator should hear about tonight: a trader silent for ≥ pausedDays trading days (not when stopped — the stop
 * is the curator's item then), and a trader with ≥ missedReviewDays unclosed day reviews.
 */
export function silenceFindings(states: readonly TraderState[], cfg: { pausedDays: number; missedReviewDays: number }): SilenceFinding[] {
  const out: SilenceFinding[] = [];
  for (const s of states) {
    if (s.state !== "stopped" && s.lastTrade && s.silentDays != null && s.silentDays >= Math.max(1, cfg.pausedDays)) {
      out.push({ kind: "silence", trader: s.trader, days: s.silentDays, last: s.lastTrade.date });
    }
    if (s.backlog.oldest && s.backlog.count >= Math.max(1, cfg.missedReviewDays)) {
      out.push({ kind: "reviews", trader: s.trader, count: s.backlog.count, oldest: s.backlog.oldest });
    }
  }
  return out;
}
