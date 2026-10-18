/**
 * Season points storage (gamification_season_points, migration 0212): every rewards / quests evaluation of a trader
 * (lib/quests/service evaluateTrader → afterEvaluation) writes the trader's score for the current season and the one
 * before it (so the last days of a month land after the 1st too); the ranking is then one SELECT. A finished season is
 * finalized once by the nightly job (gamification_seasons: the final ranking — top-3 recognition and season_rank
 * rewards read it).
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { rankRows, type Ranked, type SeasonScore } from "./season";

export async function writeSeasonScore(season: string, trader: string, s: SeasonScore): Promise<void> {
  await pool
    .query(
      `INSERT INTO gamification_season_points (season, trader, discipline_points, quest_points, points, active) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (season, trader) DO UPDATE SET discipline_points = EXCLUDED.discipline_points, quest_points = EXCLUDED.quest_points,
              points = EXCLUDED.points, active = EXCLUDED.active, updated_at = now()
        WHERE (gamification_season_points.points, gamification_season_points.discipline_points, gamification_season_points.quest_points, gamification_season_points.active)
              IS DISTINCT FROM (EXCLUDED.points, EXCLUDED.discipline_points, EXCLUDED.quest_points, EXCLUDED.active)`,
      [season, trader, s.discipline, s.quests, s.points, s.active],
    )
    .catch((err) => logger.warn({ err: (err as Error)?.message, trader, season }, "season: store failed"));
}

export type SeasonRow = { trader: string; points: number; active: boolean };

/** Stored scores of a season (any trader that was ever evaluated in it). */
export async function seasonRows(season: string): Promise<SeasonRow[]> {
  const { rows } = await pool
    .query<{ trader: string; points: number; active: boolean }>(`SELECT trader, points, active FROM gamification_season_points WHERE season = $1`, [season])
    .catch(() => ({ rows: [] as { trader: string; points: number; active: boolean }[] }));
  return rows.map((r) => ({ trader: String(r.trader), points: Number(r.points), active: !!r.active }));
}

/** The final ranking of a finalized season, or null. */
export async function finalRanking(season: string): Promise<Ranked[] | null> {
  const { rows } = await pool
    .query<{ ranking: Ranked[] }>(`SELECT ranking FROM gamification_seasons WHERE season = $1`, [season])
    .catch(() => ({ rows: [] as { ranking: Ranked[] }[] }));
  return rows[0] ? (rows[0].ranking ?? []).map((r) => ({ trader: String(r.trader), points: Number(r.points), rank: Number(r.rank) })) : null;
}

/** Finished seasons where the trader placed (for season_rank rewards). */
export async function seasonPlaces(trader: string): Promise<{ season: string; rank: number }[]> {
  const { rows } = await pool
    .query<{ season: string; rank: number }>(
      `SELECT s.season, (r ->> 'rank')::int AS rank FROM gamification_seasons s, jsonb_array_elements(s.ranking) r WHERE r ->> 'trader' = $1`,
      [trader],
    )
    .catch(() => ({ rows: [] as { season: string; rank: number }[] }));
  return rows.map((r) => ({ season: String(r.season), rank: Number(r.rank) }));
}

/**
 * Stores the final ranking once: the given participants' scores (points > 0 only — nobody is ranked on nothing).
 * Returns the ranking when this call finalized the season, null when it was already final or has no scores at all
 * (a month before the rollout is never frozen as an empty season).
 */
export async function finalizeSeason(season: string, traders: readonly string[]): Promise<Ranked[] | null> {
  const set = new Set(traders);
  const ranked = rankRows((await seasonRows(season)).filter((r) => set.has(r.trader) && r.points > 0));
  if (!ranked.length) return null;
  const { rows } = await pool.query<{ season: string }>(
    `INSERT INTO gamification_seasons (season, ranking) VALUES ($1, $2::jsonb) ON CONFLICT (season) DO NOTHING RETURNING season`,
    [season, JSON.stringify(ranked)],
  );
  return rows[0] ? ranked : null;
}
