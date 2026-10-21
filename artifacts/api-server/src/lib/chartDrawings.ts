/**
 * Chart drawings by ticker (Волна 2, item 2.12; audit 2026-10-20: drawings were kept per ticker + day, so a level drawn
 * yesterday on AAPL was not on today's AAPL chart). The viewer's drawings of a ticker are ONE set — the chart_drawings
 * row with day = TICKER_WIDE ('*'); migration 0235 merged the older per-day rows into it (those stay, unread).
 * Validation and the stored shape: lib/trainer/drawings.ts (drawingsSchema / normalizeDrawings, ≤ MAX_DRAWINGS).
 */
import { pool } from "@workspace/db";
import type { ChartDrawing } from "./trainer/types";

/** chart_drawings.day of the ticker-wide set. */
export const TICKER_WIDE = "*";

export async function loadTickerDrawings(userId: number, ticker: string): Promise<ChartDrawing[]> {
  const { rows } = await pool.query<{ drawings: ChartDrawing[] }>(
    `SELECT drawings FROM chart_drawings WHERE user_id = $1 AND ticker = $2 AND day = $3`,
    [userId, ticker, TICKER_WIDE],
  );
  return Array.isArray(rows[0]?.drawings) ? rows[0].drawings : [];
}

/** Replaces the ticker's set (an empty list keeps an empty row — no deletes). */
export async function saveTickerDrawings(userId: number, ticker: string, drawings: ChartDrawing[]): Promise<ChartDrawing[]> {
  await pool.query(
    `INSERT INTO chart_drawings (user_id, ticker, day, drawings) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, ticker, day) DO UPDATE SET drawings = EXCLUDED.drawings, updated_at = now()`,
    [userId, ticker, TICKER_WIDE, JSON.stringify(drawings)],
  );
  return drawings;
}
