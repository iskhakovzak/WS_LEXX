/**
 * The archived daily numbers of many (ticker, day) pairs at once (candle archive: the regular-session open / high /
 * low / close and the previous close — the same row lib/catalyst/store dayMoves reads, without the per-day query).
 * Read-only. A pair without an archived day is simply absent: callers count it as «no data», never guess.
 */
import { pool } from "@workspace/db";
import type { Queryable } from "../interventions/log";
import type { DayBar } from "./family";

export const barKey = (day: string, ticker: string): string => `${day}|${ticker.toUpperCase()}`;

/** At most this many pairs per query (a desk window of three weeks stays far below it). */
const CHUNK = 5000;

export async function dayBarsOf(pairs: readonly { ticker: string; day: string }[], db: Queryable = pool): Promise<Map<string, DayBar>> {
  const out = new Map<string, DayBar>();
  const uniq = [...new Map(pairs.map((p) => [barKey(p.day, p.ticker), { ticker: p.ticker.toUpperCase(), day: p.day }])).values()]
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day));
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const part = uniq.slice(i, i + CHUNK);
    const { rows } = await db.query(
      `SELECT DISTINCT ON (a.symbol, a.day) a.symbol, a.day::text AS day, a.rth_open::float8 AS o, a.rth_high::float8 AS h,
              a.rth_low::float8 AS l, a.rth_close::float8 AS c, a.prev_close::float8 AS p
         FROM candle_archive a
         JOIN unnest($1::text[], $2::date[]) AS x(symbol, day) ON x.symbol = a.symbol AND x.day = a.day
        WHERE a.prev_close > 0 AND a.rth_open > 0 AND a.rth_close > 0 AND a.rth_high > 0 AND a.rth_low > 0
        ORDER BY a.symbol, a.day, a.extended, a.tf`,
      [part.map((p) => p.ticker), part.map((p) => p.day)],
    );
    for (const r of rows) {
      out.set(barKey(String(r.day), String(r.symbol)), { open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c), prevClose: Number(r.p) });
    }
  }
  return out;
}
