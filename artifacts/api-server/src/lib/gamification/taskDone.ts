/**
 * «Выполнил задание куратора» (Волна 2 п. 2.13): the trader presses «Готово» on a curator task (the manual quest
 * «curator_task»); the curator is told and still confirms it (POST /quests/:id/complete gives the quest's own points).
 * The report itself is a small discipline event: TASK_DONE_POINTS, at most once per trader and NY day, never for the
 * same task twice (routes/curator.ts POST /curator/tasks/:id/done).
 *
 * Storage without a new table:
 *   • the task is stamped once — quest_instances.params.traderDoneOn = the NY day (markTaskReported, only while active);
 *   • the points are a quest_events row (kind «curator_task_done», ref = the NY day; primary key (trader, kind, ref) ⇒
 *     one per day even under a race) — taskDoneBonuses() returns them shaped like done quests, so lib/quests/service
 *     adds them to the discipline points and the season score exactly like a quest's bonus.
 */
import { pool } from "@workspace/db";

export const TASK_DONE_POINTS = 5;
export const TASK_DONE_KIND = "curator_task_done";

export type TaskDoneBonus = { status: "done"; completedOn: string; rewardPoints: number };

/** Stamps the task as reported by the trader on `day` (only an active, not yet reported curator_task of `trader`). */
export async function markTaskReported(id: number, trader: string, day: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE quest_instances SET params = COALESCE(params, '{}'::jsonb) || jsonb_build_object('traderDoneOn', $3::text), updated_at = now()
      WHERE id = $1 AND trader = $2 AND scope = 'curator' AND template = 'curator_task' AND status = 'active'
        AND NOT (COALESCE(params, '{}'::jsonb) ? 'traderDoneOn')`,
    [id, trader, day],
  );
  return (r.rowCount ?? 0) > 0;
}

/** The day's points for a reported task: true when this call awarded them (the first report of the NY day). */
export async function awardTaskDone(trader: string, day: string): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO quest_events (trader, kind, ref, day) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
    [trader, TASK_DONE_KIND, day],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Days with «выполнил задание куратора» points → rows shaped like done quests (never throws: no table → none). */
export async function taskDoneBonuses(trader: string): Promise<TaskDoneBonus[]> {
  const { rows } = await pool
    .query<{ day: string }>(`SELECT day FROM quest_events WHERE trader = $1 AND kind = $2`, [trader, TASK_DONE_KIND])
    .catch(() => ({ rows: [] as { day: string }[] }));
  return bonusRows(rows.map((r) => String(r.day)));
}

/** One bonus per distinct day (pure; anything but a YYYY-MM-DD day is ignored). */
export function bonusRows(days: readonly string[]): TaskDoneBonus[] {
  return [...new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().map((d) => ({ status: "done" as const, completedOn: d, rewardPoints: TASK_DONE_POINTS }));
}
