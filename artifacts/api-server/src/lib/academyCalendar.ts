/**
 * Academy calendar helpers (routes/academy-path.ts): full-day market holidays for exam calendars (DENIS-22) and the
 * «no backfilled notice» rule for terminal exam statuses (DENIS-21 / OLGA-16).
 */
import { pool } from "@workspace/db";
import { addDays } from "./tradingDate";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Full-day market holidays in [from, to] (holiday_calendar «Market closed…», the daily loop's rule); empty on error. */
export async function marketClosedDays(from: string, to: string): Promise<Set<string>> {
  const { rows } = await pool
    .query<{ d: string }>(
      `SELECT date::text AS d FROM holiday_calendar WHERE type = 'holiday' AND description ILIKE 'market closed%' AND date::text >= $1 AND date::text <= $2`,
      [from, to],
    )
    .catch(() => ({ rows: [] as { d: string }[] }));
  return new Set(rows.map((r) => String(r.d).slice(0, 10)));
}

/** A terminal notice for a challenge that ended more than this many days ago would be a backfill — stored silently. */
const NOTICE_STALE_DAYS = 2;

/** The challenge was decided more than NOTICE_STALE_DAYS calendar days before `today` (pure; exported for tests). */
export function isStaleNotice(decidedOn: string, today: string): boolean {
  return YMD_RE.test(decidedOn) && addDays(decidedOn, NOTICE_STALE_DAYS) < today;
}
