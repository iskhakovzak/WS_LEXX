/**
 * «Тренажёр 2» series — SQL (sim_series, migration 0218) and the pure SeriesState builder. Results are never stored
 * twice: they are read from the series' sim_games rows (series_id, params.series.index) every time.
 *
 * Outcome of a dealt game: finished with trades → "traded" (r = game R); finished without trades → "no_trade" (r 0,
 * correct = the «Не торгую» verdict, null when the player watched to the end instead); skipped → "skipped". The game
 * being played and the prepared next one are not results yet.
 */
import { pool } from "@workspace/db";
import { INTRADAY_SPECS, type Difficulty, type IntradayTf, type SimMode, type SimTf } from "./scenario";

export type SeriesRow = {
  id: number; userId: number; mode: SimMode; difficulty: Difficulty; tf: IntradayTf | null; size: number; idx: number;
  status: "active" | "finished" | "abandoned";
};

export type SeriesOutcome = "traded" | "no_trade" | "skipped";
export type SeriesResult = { gameId: number; outcome: SeriesOutcome; r: number | null; correct: boolean | null };

export type SeriesState = {
  id: number; mode: SimMode; difficulty: Difficulty; tf: SimTf;
  size: number; index: number; finished: boolean; currentGameId: number | null;
  results: SeriesResult[];
  totals: { traded: number; noTrade: number; skipped: number; netR: number; correctNoTrade: number };
};

export type SeriesGameRow = { id: number; index: number; status: string; r: number; trades: number; correct: boolean | null };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Pure: the public state of a series from its row and its games. */
export function stateOf(s: SeriesRow, games: readonly SeriesGameRow[]): SeriesState {
  const sorted = [...games].sort((a, b) => a.index - b.index || a.id - b.id);
  const results: SeriesResult[] = [];
  for (const g of sorted) {
    if (g.index > s.idx) continue; // prepared / never dealt
    if (g.status === "finished") {
      results.push(g.trades > 0
        ? { gameId: g.id, outcome: "traded", r: r2(g.r), correct: null }
        : { gameId: g.id, outcome: "no_trade", r: 0, correct: g.correct });
    } else if (g.status === "skipped" || g.status === "abandoned") {
      results.push({ gameId: g.id, outcome: "skipped", r: null, correct: null });
    }
  }
  const current = sorted.find((g) => g.index === s.idx && g.status !== "prepared");
  return {
    id: s.id, mode: s.mode, difficulty: s.difficulty,
    tf: s.mode === "swing" ? "1d" : s.tf ?? INTRADAY_SPECS[s.difficulty].tf,
    size: s.size, index: s.idx, finished: s.status === "finished",
    currentGameId: s.status === "finished" ? null : current?.id ?? null,
    results,
    totals: {
      traded: results.filter((x) => x.outcome === "traded").length,
      noTrade: results.filter((x) => x.outcome === "no_trade").length,
      skipped: results.filter((x) => x.outcome === "skipped").length,
      netR: r2(results.reduce((a, x) => a + (x.r ?? 0), 0)),
      correctNoTrade: results.filter((x) => x.outcome === "no_trade" && x.correct === true).length,
    },
  };
}

type DbSeries = { id: number; user_id: number; mode: SimMode; difficulty: Difficulty; tf: IntradayTf | null; size: number; idx: number; status: SeriesRow["status"] };
const fromDb = (r: DbSeries): SeriesRow => ({
  id: Number(r.id), userId: Number(r.user_id), mode: r.mode, difficulty: r.difficulty, tf: r.tf ?? null, size: Number(r.size), idx: Number(r.idx), status: r.status,
});

export async function insertSeries(s: Omit<SeriesRow, "id" | "idx" | "status">): Promise<SeriesRow> {
  const { rows } = await pool.query<DbSeries>(
    `INSERT INTO sim_series (user_id, mode, difficulty, tf, size) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [s.userId, s.mode, s.difficulty, s.tf, s.size],
  );
  return fromDb(rows[0]);
}

export async function loadSeries(id: number): Promise<SeriesRow | null> {
  const { rows } = await pool.query<DbSeries>(`SELECT * FROM sim_series WHERE id = $1`, [id]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function activeSeriesId(userId: number): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(`SELECT id FROM sim_series WHERE user_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`, [userId]);
  return rows[0] ? Number(rows[0].id) : null;
}

export async function setSeriesIdx(id: number, idx: number): Promise<void> {
  await pool.query(`UPDATE sim_series SET idx = $2, updated_at = NOW() WHERE id = $1`, [id, idx]);
}

export async function closeSeries(id: number, status: "finished" | "abandoned"): Promise<void> {
  await pool.query(
    `UPDATE sim_series SET status = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'active'`,
    [id, status],
  );
}

export async function seriesGames(seriesId: number): Promise<SeriesGameRow[]> {
  const { rows } = await pool.query<{ id: number; idx: number | null; status: string; r: string | null; trades: number | null; correct: string | null }>(
    `SELECT id::int AS id, (params #>> '{series,index}')::int AS idx, status, r_total AS r, trades_count AS trades,
            result #>> '{noTrade,correct}' AS correct
       FROM sim_games WHERE series_id = $1 ORDER BY id`,
    [seriesId],
  );
  return rows.map((r) => ({
    id: Number(r.id), index: Number(r.idx ?? 0), status: String(r.status), r: Number(r.r) || 0, trades: Number(r.trades) || 0,
    correct: r.correct == null ? null : r.correct === "true",
  }));
}

/** The prepared (not yet dealt) game of a series at a position, or null. */
export async function preparedGameId(seriesId: number, index: number): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id::int AS id FROM sim_games WHERE series_id = $1 AND status = 'prepared' AND (params #>> '{series,index}')::int = $2 ORDER BY id DESC LIMIT 1`,
    [seriesId, index],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export async function seriesStateOf(id: number): Promise<SeriesState | null> {
  const s = await loadSeries(id);
  return s ? stateOf(s, await seriesGames(id)) : null;
}
