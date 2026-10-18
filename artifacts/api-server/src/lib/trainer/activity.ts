/**
 * Trainer activity of one trader for quests / achievements (lib/quests loaders read it; T-SERVER owns the tables):
 *   dailyPlayed  «Задача дня» challenge dates the trader finished (oldest first);
 *   drillDays    NY days with answered «Найди вход» drills: answers, first answers that passed;
 *   ownReplays   finished own-day replays («Мои дни») by NY finish day (the same rows lib/quests ownGames reads).
 * Never throws: a missing table (before migration 0211) reads as no activity.
 */
import { pool } from "@workspace/db";

export type TrainerActivity = {
  dailyPlayed: string[];
  drillDays: { day: string; answers: number; passed: number }[];
  ownReplays: { day: string; n: number }[];
};

export async function trainerActivity(trader: string): Promise<TrainerActivity> {
  const none = { rows: [] as never[] };
  const [daily, drills, own] = await Promise.all([
    pool.query<{ d: string }>(
      `SELECT g.params #>> '{daily,date}' AS d FROM sim_games g JOIN users u ON u.id = g.user_id
        WHERE u.name = $1 AND g.params ? 'daily' AND g.status = 'finished' ORDER BY 1`,
      [trader],
    ).catch(() => none),
    pool.query<{ d: string; answers: number; passed: number }>(
      `SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d, count(*)::int AS answers,
              count(*) FILTER (WHERE first AND passed)::int AS passed
         FROM trainer_drill_attempts WHERE trader = $1 GROUP BY 1 ORDER BY 1`,
      [trader],
    ).catch(() => none),
    pool.query<{ d: string; n: number }>(
      `SELECT to_char(g.finished_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d, count(*)::int AS n
         FROM sim_games g JOIN users u ON u.id = g.user_id
        WHERE u.name = $1 AND g.params ? 'own' AND g.status = 'finished' AND g.finished_at IS NOT NULL GROUP BY 1 ORDER BY 1`,
      [trader],
    ).catch(() => none),
  ]);
  return {
    dailyPlayed: daily.rows.map((r) => String(r.d)),
    drillDays: drills.rows.map((r) => ({ day: String(r.d), answers: Number(r.answers), passed: Number(r.passed) })),
    ownReplays: own.rows.map((r) => ({ day: String(r.d), n: Number(r.n) })),
  };
}
