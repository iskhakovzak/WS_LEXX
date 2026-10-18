/**
 * Is the market closed on a NY date: a weekend, or a full-day NYSE holiday (holiday_calendar «Market closed…», migrations
 * 0016 / 0017 — the rule of lib/daily/telegramJobs marketClosed; early closes still trade). One read per date per
 * process (the calendar is seeded once a year); a failed read counts as open.
 */
import { pool } from "@workspace/db";
import { isWeekend } from "./tradingDate";

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
