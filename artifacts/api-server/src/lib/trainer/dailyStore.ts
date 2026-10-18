/**
 * «Задача дня» — SQL (rules: dailyPick.ts; service: daily.ts). Tables: trainer_daily_challenges and the daily sim_games
 * rows (params.daily.date) — migration 0211_trainer.sql.
 */
import { pool } from "@workspace/db";
import type { DailyCandidate, DailyGameRow } from "./dailyPick";

export type ChallengeRow = { date: string; ticker: string; barsDay: string; tf: string; deskTraders: number };

const fromRow = (r: { date: string; ticker: string; bars_day: string; tf: string; desk_traders: number }): ChallengeRow => ({
  date: String(r.date), ticker: String(r.ticker), barsDay: String(r.bars_day), tf: String(r.tf), deskTraders: Number(r.desk_traders) || 0,
});

export async function challengeOf(date: string): Promise<ChallengeRow | null> {
  const { rows } = await pool.query(`SELECT date, ticker, bars_day, tf, desk_traders FROM trainer_daily_challenges WHERE date = $1`, [date]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Insert the pick unless the date already has one (another process / an earlier run); returns the row in force. */
export async function savePick(p: ChallengeRow & { features: Record<string, unknown> }): Promise<ChallengeRow> {
  await pool.query(
    `INSERT INTO trainer_daily_challenges (date, ticker, bars_day, tf, desk_traders, features)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (date) DO NOTHING`,
    [p.date, p.ticker, p.barsDay, p.tf, p.deskTraders, JSON.stringify(p.features)],
  );
  return (await challengeOf(p.date)) ?? p;
}

/** The last challenges before `date` (newest first): their ticker-days (no-repeat window) and tickers. */
export async function recentChallenges(date: string, limit: number): Promise<{ date: string; ticker: string; barsDay: string }[]> {
  const { rows } = await pool.query<{ date: string; ticker: string; bars_day: string }>(
    `SELECT date, ticker, bars_day FROM trainer_daily_challenges WHERE date < $1 ORDER BY date DESC LIMIT $2`,
    [date, limit],
  );
  return rows.map((r) => ({ date: String(r.date), ticker: String(r.ticker), barsDay: String(r.bars_day) }));
}

/** Challenge dates up to `date`, newest first (the streak walk). */
export async function challengeDates(date: string, limit = 400): Promise<string[]> {
  const { rows } = await pool.query<{ date: string }>(`SELECT date FROM trainer_daily_challenges WHERE date <= $1 ORDER BY date DESC LIMIT $2`, [date, limit]);
  return rows.map((r) => String(r.date));
}

/** Archived 1-minute ticker-days before `before` with the regular-session stats and the distinct desk traders. */
export async function dailyCandidates(before: string): Promise<DailyCandidate[]> {
  const { rows } = await pool.query<{
    symbol: string; day: string; rth_open: string | null; rth_high: string | null; rth_low: string | null; prev_close: string | null; volume: string; desk: number;
  }>(
    `SELECT a.symbol, a.day::text AS day, a.rth_open, a.rth_high, a.rth_low, a.prev_close, a.volume,
            (SELECT count(DISTINCT t.trader)::int FROM trades t
              WHERE t.deleted_at IS NULL AND t.ticker = a.symbol AND left(t.date, 10) = a.day::text) AS desk
       FROM candle_archive a
      WHERE a.tf = '1m' AND a.day < $1::date AND a.symbol ~ '^[A-Z]{1,5}$'`,
    [before],
  );
  return rows.map((r) => {
    const open = r.rth_open == null ? null : Number(r.rth_open);
    const hi = r.rth_high == null ? null : Number(r.rth_high), lo = r.rth_low == null ? null : Number(r.rth_low);
    const prev = r.prev_close == null ? null : Number(r.prev_close);
    return {
      ticker: r.symbol, day: r.day, open, volume: Number(r.volume) || 0, deskTraders: Number(r.desk) || 0,
      rangePct: open && hi != null && lo != null ? Math.round(((hi - lo) / open) * 10_000) / 100 : null,
      gapPct: open && prev ? Math.round(((open - prev) / prev) * 10_000) / 100 : null,
    };
  });
}

/** Finished daily games of a challenge date with the player names. */
export async function dailyGames(date: string): Promise<DailyGameRow[]> {
  const { rows } = await pool.query<{ user_id: number; name: string; r: string | null; trades: number | null }>(
    `SELECT g.user_id, u.name, g.r_total AS r, g.trades_count AS trades
       FROM sim_games g JOIN users u ON u.id = g.user_id
      WHERE g.params ? 'daily' AND g.params #>> '{daily,date}' = $1 AND g.status = 'finished'`,
    [date],
  );
  return rows.map((r) => ({ userId: Number(r.user_id), name: String(r.name), r: Number(r.r) || 0, trades: Number(r.trades) || 0 }));
}

/** Everyone who started the date's challenge (aliases are numbered over all of them). */
export async function dailyParticipants(date: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT DISTINCT u.name FROM sim_games g JOIN users u ON u.id = g.user_id
      WHERE g.params ? 'daily' AND g.params #>> '{daily,date}' = $1 AND g.status <> 'abandoned'`,
    [date],
  );
  return rows.map((r) => String(r.name));
}

/** The viewer's daily game of a date: id and status (null when not started). */
export async function myDailyGame(userId: number, date: string): Promise<{ id: number; status: string } | null> {
  const { rows } = await pool.query<{ id: number; status: string }>(
    `SELECT id::int AS id, status FROM sim_games WHERE user_id = $1 AND params ? 'daily' AND params #>> '{daily,date}' = $2 LIMIT 1`,
    [userId, date],
  );
  return rows[0] ? { id: Number(rows[0].id), status: String(rows[0].status) } : null;
}

/** Challenge dates the user finished. */
export async function playedDates(userId: number): Promise<Set<string>> {
  const { rows } = await pool.query<{ d: string }>(
    `SELECT params #>> '{daily,date}' AS d FROM sim_games WHERE user_id = $1 AND params ? 'daily' AND status = 'finished'`,
    [userId],
  );
  return new Set(rows.map((r) => String(r.d)));
}

/** Traders who traded the ticker that day (a relaxed pick: they are left out of the ranking). */
export async function tradersOfTickerDay(ticker: string, day: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ trader: string }>(
    `SELECT DISTINCT trader FROM trades WHERE deleted_at IS NULL AND ticker = $1 AND left(date, 10) = $2`,
    [ticker, day],
  );
  return new Set(rows.map((r) => String(r.trader)));
}
