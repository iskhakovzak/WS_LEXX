/**
 * Periods of «Итоги недели / месяца» (pure, unit-tested): a trading week (ISO week, Mon–Fri, New York dates — the
 * same weeks as «Отчёт недели») or a calendar month, which week reports cover it, and when the dashboard offers it.
 */
import { addDays } from "@/lib/trading-date";
import { isoWeekOf } from "@/lib/period-links";

export type PeriodKind = "week" | "month";

export interface WrappedPeriod {
  kind: PeriodKind;
  /** "2026-W42" or "2026-10". */
  key: string;
  /** First / last day, YYYY-MM-DD (week: Monday / Friday). */
  from: string;
  to: string;
  /** ISO weeks whose Mon–Fri overlap the period (the week reports to read). */
  weeks: string[];
}

const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sunday

/** Monday of an ISO week key, or null when the key is malformed. */
export function weekStart(key: string): string | null {
  const m = WEEK_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]), week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  const start = jan4.toISOString().slice(0, 10);
  return isoWeekOf(start) === key ? start : null;
}

function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** The period of a key; null when the key does not parse. */
export function periodOf(kind: PeriodKind, key: string): WrappedPeriod | null {
  if (kind === "week") {
    const from = weekStart(key);
    return from ? { kind, key, from, to: addDays(from, 4), weeks: [key] } : null;
  }
  const m = MONTH_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const from = `${m[1]}-${m[2]}-01`;
  const to = lastDayOfMonth(year, month);
  const weeks: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (wd === 0 || wd === 6) continue;
    const w = isoWeekOf(d);
    if (!weeks.includes(w)) weeks.push(w);
  }
  return { kind, key, from, to, weeks };
}

/** The latest finished trading week: on Saturday / Sunday the current one, else the previous one. */
export function lastClosedWeek(today: string): string {
  const wd = weekday(today);
  return isoWeekOf(wd === 0 || wd === 6 ? today : addDays(today, -7));
}

/** The latest finished calendar month ("2026-09" on any day of October 2026). */
export function lastClosedMonth(today: string): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export type SeenState = { week?: string; month?: string };

/**
 * What the dashboard line offers today (owner rule: one quiet line, never a banner, gone once opened or dismissed):
 *   week   from the Saturday after the week closes through the next Wednesday (Monday is the main day);
 *   month  the first 7 days of a new month.
 * A period already opened or dismissed (`seen`) is not offered again.
 */
export function dashOffer(today: string, seen: SeenState | null | undefined): { week: string | null; month: string | null } {
  const wd = weekday(today);
  const weekOpen = wd === 6 || wd === 0 || (wd >= 1 && wd <= 3);
  const week = weekOpen ? lastClosedWeek(today) : null;
  const month = Number(today.slice(8, 10)) <= 7 ? lastClosedMonth(today) : null;
  return {
    week: week && seen?.week !== week ? week : null,
    month: month && seen?.month !== month ? month : null,
  };
}
