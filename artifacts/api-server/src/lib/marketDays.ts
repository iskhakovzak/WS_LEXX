/**
 * The NYSE trading calendar of a NY date — the ONE session module (wave 1, 1.12).
 *
 *   isMarketClosed(date)  a weekend, or a full-day holiday (holiday_calendar «Market closed…», migrations 0016 / 0017 —
 *                         the rule of lib/daily/telegramJobs marketClosed; early closes still trade)
 *   sessionFor(date)      the day's session: closed / early close, open 09:30, close 16:00 or 13:00, post until 20:00
 *                         or 17:00 (lib/tradingDate DaySession). The close comes from lib/eodStore closeMinutesFor
 *                         («Early close 1pm ET» rows), so the day close check and every clock agree.
 *   knownSession(date)    the last sessionFor answer for a date, synchronously (cron getters); null until read once
 *
 * One read per date per process (the calendar is seeded once a year); a failed read counts as a regular open day.
 */
import { pool } from "@workspace/db";
import { daySession, EARLY_CLOSE_MIN, isWeekend, type DaySession } from "./tradingDate";
import { closeMinutesFor } from "./eodStore";

const known = new Map<string, boolean>();

export async function isMarketClosed(date: string): Promise<boolean> {
  if (isWeekend(date)) return true;
  const hit = known.get(date);
  if (hit !== undefined) return hit;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM holiday_calendar WHERE date::text = $1 AND type = 'holiday' AND description ILIKE 'market closed%' LIMIT 1`,
      [date],
    );
    const closed = rows.length > 0;
    if (known.size > 2000) known.clear();
    known.set(date, closed);
    return closed;
  } catch {
    return false;
  }
}

const sessions = new Map<string, DaySession>();

/** The session of a NY date (see the header). */
export async function sessionFor(date: string): Promise<DaySession> {
  const hit = sessions.get(date);
  if (hit) return hit;
  const closed = await isMarketClosed(date);
  const earlyClose = !closed && (await closeMinutesFor(date)) === EARLY_CLOSE_MIN;
  const s = daySession(date, { closed, earlyClose });
  if (sessions.size > 500) sessions.clear();
  sessions.set(date, s);
  return s;
}

/** The cached session of `date` (null before the first sessionFor of that date in this process). */
export function knownSession(date: string): DaySession | null {
  return sessions.get(date) ?? null;
}

/** Tests only. */
export function resetMarketDays(): void {
  known.clear();
  sessions.clear();
}
