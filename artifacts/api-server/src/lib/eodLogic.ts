// Pure «Закрытие дня» rules (no DB) — used by routes/eod.ts and checked offline with synthetic data.
import { addDays, isWeekend, nyDate, nyMinutes } from "./tradingDate";
import { errorMessage } from "./http/errors";

export type MissingField = "setup" | "grade";
export type MissingItem = { tradeId: number; ticker: string; fields: MissingField[] };
export type ReviewableTrade = { id: number; ticker: string; setup: string | null; confidenceGrade: string | null };

export const GRADES = ["A+", "A", "B", "C"] as const;

export function nextTradingDay(date: string): string {
  let d = addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
export function prevTradingDay(date: string): string {
  let d = addDays(date, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

/** Which required review fields a trade still lacks (setup + grade are mandatory to close the day). */
export function missingFields(t: { setup: string | null; confidenceGrade: string | null }): MissingField[] {
  const out: MissingField[] = [];
  if (!t.setup || !t.setup.trim()) out.push("setup");
  if (!t.confidenceGrade || !(GRADES as readonly string[]).includes(t.confidenceGrade)) out.push("grade");
  return out;
}

export function missingList(trades: ReviewableTrade[]): MissingItem[] {
  const out: MissingItem[] = [];
  for (const t of trades) {
    const fields = missingFields(t);
    if (fields.length) out.push({ tradeId: t.id, ticker: t.ticker, fields });
  }
  return out;
}

/** NYSE regular close, New York minutes (16:00). */
export const MARKET_CLOSE_MIN = 16 * 60;
/** NYSE early close (holiday_calendar «Early close 1pm ET»: day after Thanksgiving, Christmas Eve, July 3). */
export const EARLY_CLOSE_MIN = 13 * 60;

/** «16:00» / «13:00» — the close time of a NY minutes value (for the hint and the API payload). */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type CloseCheck = {
  ok: boolean; missing: MissingItem[]; reason: string | null; reasonCode?: "EOD_FUTURE_DAY" | "EOD_TOO_EARLY" | "EOD_INCOMPLETE";
  /** Today's session is still running: the day opens for closing at this NY time («16:00», «13:00» on an early close). */
  opensAt?: string;
};

/**
 * `reasonCode` = the API error code that blocks the close; `reason` = its RU text (translate the code per request).
 * Today can be closed only after the market close (Волна 0, item 0.5): `nowMinutes` = NY minutes now, `closeMinutes` =
 * the session's close (MARKET_CLOSE_MIN, EARLY_CLOSE_MIN on a short day). Without `nowMinutes` the time is not checked.
 * Today before the market close is EOD_TOO_EARLY with `opensAt` set.
 */
export function canCloseDay(args: { date: string; today: string; trades: ReviewableTrade[]; nowMinutes?: number; closeMinutes?: number }): CloseCheck {
  if (args.date > args.today) return { ok: false, missing: [], reason: errorMessage("EOD_FUTURE_DAY", "ru"), reasonCode: "EOD_FUTURE_DAY" };
  const closeAt = args.closeMinutes ?? MARKET_CLOSE_MIN;
  if (args.date === args.today && args.nowMinutes != null && args.nowMinutes < closeAt) {
    return { ok: false, missing: [], reason: errorMessage("EOD_TOO_EARLY", "ru", { opensAt: hhmm(closeAt) }), reasonCode: "EOD_TOO_EARLY", opensAt: hhmm(closeAt) };
  }
  const missing = missingList(args.trades);
  if (missing.length) return { ok: false, missing, reason: errorMessage("EOD_INCOMPLETE", "ru"), reasonCode: "EOD_INCOMPLETE" };
  return { ok: true, missing: [], reason: null };
}

export type Streaks = { closedStreak: number; reviewedStreak: number; closedTotal: number; lastClosed: string | null };

/**
 * closedStreak   — consecutive trading days (weekdays) ending today (if closed) or the previous trading day, all closed.
 * reviewedStreak — consecutive trading days WITH trades where every trade is fully reviewed
 *                  (setup + grade + followed-plan); days without trades neither count nor break it.
 */
export function computeStreaks(args: {
  today: string;
  closedDates: Set<string>;
  tradeDays: Map<string, { n: number; reviewed: number }>;
}): Streaks {
  const { today, closedDates, tradeDays } = args;
  const start = closedDates.has(today) ? today : prevTradingDay(today);
  let closedStreak = 0;
  for (let d = start, i = 0; i < 600; d = prevTradingDay(d), i++) {
    if (!closedDates.has(d)) break;
    closedStreak++;
  }
  let reviewedStreak = 0;
  let gap = 0;
  for (let d = today, i = 0; i < 600; d = prevTradingDay(d), i++) {
    const td = tradeDays.get(d);
    if (!td) {
      if (++gap > 60) break; // 60 trading days without a single trade: stop walking
      continue;
    }
    gap = 0;
    if (td.reviewed < td.n) break;
    reviewedStreak++;
  }
  const sorted = Array.from(closedDates).sort();
  return { closedStreak, reviewedStreak, closedTotal: closedDates.size, lastClosed: sorted.length ? sorted[sorted.length - 1] : null };
}

// ─── review SLA clock ───────────────────────────────────────────────────────

/** Curator review SLA: 24 trading hours (owner default 2026-10-19, OLGA-07 — weekends and full-day holidays pause it). */
export const REVIEW_SLA_HOURS = 24;

/**
 * Hours between `from` and `to` without the hours that fall on non-trading New York days (Saturday, Sunday and the
 * full-day market holidays in `closed`, YYYY-MM-DD). A day closed on Friday evening is not overdue on Sunday.
 * Walks one NY day at a time (≤ 2000 days); a DST day counts its real length ± the hour shift.
 */
export function tradingHoursBetween(from: Date | string | number, to: Date | number, closed: ReadonlySet<string> = new Set()): number {
  let t = new Date(from).getTime();
  const end = typeof to === "number" ? to : to.getTime();
  if (!Number.isFinite(t) || !Number.isFinite(end) || end <= t) return 0;
  let ms = 0;
  for (let i = 0; t < end && i < 2000; i++) {
    const at = new Date(t);
    const day = nyDate(at);
    const dayEnd = t + (1440 - nyMinutes(at)) * 60_000 - (at.getUTCSeconds() * 1000 + at.getUTCMilliseconds());
    const next = Math.min(Math.max(dayEnd, t + 1), end);
    if (!isWeekend(day) && !closed.has(day)) ms += next - t;
    t = next;
  }
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/** Trading days d with from < d ≤ to (weekends and full-day holidays in `closed` skipped): Friday → Monday = 1. */
export function tradingDaysAfter(from: string, to: string, closed: ReadonlySet<string> = new Set()): number {
  if (!from || !to || to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1), i = 0; d <= to && i < 4000; d = addDays(d, 1), i++) if (!isWeekend(d) && !closed.has(d)) n++;
  return n;
}
