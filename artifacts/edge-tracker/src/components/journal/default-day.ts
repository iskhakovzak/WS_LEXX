/**
 * Default days of the evening screens (Волна 1, item 1.4) and the day a «Фокус на завтра» is for. Pure, unit-tested in
 * __tests__/default-day.test.ts.
 *
 *   journal       the last trading day that still has to be closed (trades, not closed) — not an empty today before
 *                 the close; nothing open → today (a weekday) / the last weekday (weekend)
 *   day report    the last day with trades
 *   weekly review Monday–Wednesday → the previous week (the one to assess); Thursday on → the current one
 *   focus day     the next trading day after the closed one — or the session still ahead when it is closed late
 */

/** NY minutes of the regular close (16:00). */
export const CLOSE_MIN = 16 * 60;
/** How far back an unclosed day still counts as «the day to close» (calendar days). */
export const OPEN_DAY_LOOKBACK = 14;

const dow = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const isWeekendYmd = (ymd: string) => [0, 6].includes(dow(ymd));
function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekdayStep(ymd: string, dir: 1 | -1): string {
  let d = shift(ymd, dir);
  while (isWeekendYmd(d)) d = shift(d, dir);
  return d;
}

/** Today on a weekday, else the last weekday (the day a weekend visit reviews). */
export function homeDay(today: string): string {
  return isWeekendYmd(today) ? weekdayStep(today, -1) : today;
}

/**
 * The journal's default day: the latest day with trades that is finished (before today, or today after the close)
 * and not closed yet, within OPEN_DAY_LOOKBACK days; else the home day.
 */
export function defaultJournalDay(v: {
  today: string;
  nyMinutes: number;
  tradeDays: readonly string[];
  /** Days already closed (closed or reviewed). */
  closed: ReadonlySet<string>;
}): string {
  const sessionOver = v.nyMinutes >= CLOSE_MIN || isWeekendYmd(v.today);
  const from = shift(v.today, -OPEN_DAY_LOOKBACK);
  const open = [...new Set(v.tradeDays)]
    .filter((d) => d >= from && (d < v.today || (d === v.today && sessionOver)) && !v.closed.has(d))
    .sort();
  return open.length ? open[open.length - 1]! : homeDay(v.today);
}

/** The day report's default day: the last day with trades (≤ today), else the home day. */
export function defaultReportDay(today: string, lastTradeDay: string | null | undefined): string {
  return lastTradeDay && lastTradeDay <= today ? lastTradeDay.slice(0, 10) : homeDay(today);
}

/** The weekly review opens last week on Monday–Wednesday (the week still to assess), this week from Thursday on. */
export function reviewLastWeek(today: string): boolean {
  const d = dow(today);
  return d >= 1 && d <= 3;
}

/**
 * The day the «Фокус на завтра» of `date` is for: the next trading day — or, when the day is closed late (Friday on
 * Tuesday), the session still ahead (today before the close, else the next weekday); never a day in the past.
 * Mirrors api lib/eodStore focusDayFor.
 */
export function focusDayFor(date: string, today: string, nyMinutes: number): string {
  const next = weekdayStep(date, 1);
  const ahead = !isWeekendYmd(today) && nyMinutes < CLOSE_MIN ? today : weekdayStep(today, 1);
  return next >= ahead ? next : ahead;
}

/** Minutes since New York midnight of an instant (default: now). */
export function nyMinutesOf(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const [h, m] = parts.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
