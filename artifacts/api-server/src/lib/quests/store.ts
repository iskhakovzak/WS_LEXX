/**
 * Quests and achievements — storage (migration 0207). Idempotent by construction:
 *   • catalog quests: INSERT … ON CONFLICT DO NOTHING on (trader, scope, template, period) — a racing read or the
 *     nightly job creates nothing twice;
 *   • status changes: UPDATE … WHERE status = 'active' RETURNING — only the process that moved a quest out of «active»
 *     gets the row back (and sends its notification);
 *   • achievements: primary key (trader, line, tier) with ON CONFLICT DO NOTHING RETURNING.
 */
import { pool } from "@workspace/db";
import type { NewQuest, QuestUpdate } from "./engine";
import type { StoredQuest } from "./catalog";
import type { QuestScope, QuestStatus } from "./types";

type Row = {
  id: number; trader: string; scope: string; template: string; period: string; params: Record<string, unknown> | null;
  progress: number; target: number; status: string; reward_points: number; starts_on: string; ends_on: string | null;
  completed_on: string | null; assigned_by: string | null; note: string | null;
};

const COLS = `id, trader, scope, template, period, params, progress, target, status, reward_points, starts_on, ends_on, completed_on, assigned_by, note`;

export function rowToQuest(r: Row): StoredQuest {
  return {
    id: Number(r.id), trader: r.trader, scope: r.scope as QuestScope, template: r.template, period: r.period, params: r.params ?? {},
    progress: Number(r.progress), target: Number(r.target), status: r.status as StoredQuest["status"], rewardPoints: Number(r.reward_points),
    startsOn: String(r.starts_on), endsOn: r.ends_on, completedOn: r.completed_on, assignedBy: r.assigned_by, note: r.note,
  };
}

/** Every quest of a trader (cancelled ones too: they block nothing but keep history). */
export async function questsOf(trader: string): Promise<StoredQuest[]> {
  const { rows } = await pool.query<Row>(`SELECT ${COLS} FROM quest_instances WHERE trader = $1 ORDER BY id`, [trader]);
  return rows.map(rowToQuest);
}

export async function questById(id: number): Promise<StoredQuest | null> {
  const { rows } = await pool.query<Row>(`SELECT ${COLS} FROM quest_instances WHERE id = $1`, [id]);
  return rows[0] ? rowToQuest(rows[0]) : null;
}

/** Creates catalog quests (once). Returns the rows this call inserted. */
export async function createQuests(trader: string, list: readonly NewQuest[]): Promise<StoredQuest[]> {
  const out: StoredQuest[] = [];
  for (const q of list) {
    const { rows } = await pool.query<Row>(
      `INSERT INTO quest_instances (trader, scope, template, period, progress, target, status, reward_points, starts_on, ends_on, completed_on, notified_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $7 = 'active' THEN NULL ELSE $7 END)
       ON CONFLICT (trader, scope, template, period) WHERE scope <> 'curator' DO NOTHING
       RETURNING ${COLS}`,
      [trader, q.scope, q.template, q.period, q.progress, q.target, q.status, q.rewardPoints, q.startsOn, q.endsOn, q.completedOn],
    );
    if (rows[0]) out.push(rowToQuest(rows[0]));
  }
  return out;
}

/**
 * Applies progress / status. A status change happens only from «active»; the rows whose status this call changed are
 * returned (their notifications are this caller's job).
 */
export async function updateQuests(list: readonly QuestUpdate[]): Promise<StoredQuest[]> {
  const changed: StoredQuest[] = [];
  for (const u of list) {
    const { rows } = await pool.query<Row>(
      `UPDATE quest_instances SET progress = $2, target = $3, status = $4, completed_on = COALESCE(completed_on, $5),
              notified_status = CASE WHEN $4 = 'active' THEN notified_status ELSE $4 END, updated_at = now()
        WHERE id = $1 AND status = 'active' RETURNING ${COLS}`,
      [u.id, u.progress, u.target, u.status, u.completedOn],
    );
    if (rows[0] && u.status !== "active") changed.push(rowToQuest(rows[0]));
  }
  return changed;
}

export async function insertCuratorQuest(q: {
  trader: string; template: string; target: number; rewardPoints: number; startsOn: string; endsOn: string; assignedBy: string; note: string | null;
}): Promise<StoredQuest> {
  const { rows } = await pool.query<Row>(
    `INSERT INTO quest_instances (trader, scope, template, period, target, reward_points, starts_on, ends_on, assigned_by, note)
     VALUES ($1, 'curator', $2, 'curator', $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
    [q.trader, q.template, q.target, q.rewardPoints, q.startsOn, q.endsOn, q.assignedBy, q.note],
  );
  return rowToQuest(rows[0]!);
}

export async function activeCuratorQuests(trader: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM quest_instances WHERE trader = $1 AND scope = 'curator' AND status = 'active'`,
    [trader],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Final status set by a person (cancel / manual complete); null when the quest was no longer active. */
export async function closeQuest(id: number, status: QuestStatus | "cancelled", by: string, today: string): Promise<StoredQuest | null> {
  const { rows } = await pool.query<Row>(
    `UPDATE quest_instances SET status = $2, progress = CASE WHEN $2 = 'done' THEN target ELSE progress END,
            completed_on = CASE WHEN $2 = 'done' THEN $4 ELSE completed_on END,
            cancelled_by = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancelled_by END, notified_status = $2, updated_at = now()
      WHERE id = $1 AND status = 'active' RETURNING ${COLS}`,
    [id, status, by, today],
  );
  return rows[0] ? rowToQuest(rows[0]) : null;
}

/** Done quests' bonus points by completion day (lib/daily/rewards adds them to the discipline points / level). */
export async function donePoints(trader: string): Promise<{ completedOn: string; rewardPoints: number; status: "done" }[]> {
  const { rows } = await pool
    .query<{ completed_on: string; reward_points: number }>(
      `SELECT completed_on, reward_points FROM quest_instances WHERE trader = $1 AND status = 'done' AND reward_points <> 0 AND completed_on IS NOT NULL`,
      [trader],
    )
    .catch(() => ({ rows: [] as { completed_on: string; reward_points: number }[] }));
  return rows.map((r) => ({ completedOn: String(r.completed_on), rewardPoints: Number(r.reward_points), status: "done" as const }));
}

/** Quests a trader finished on `date` (evening card line). */
export async function questsDoneOn(trader: string, date: string): Promise<number> {
  const { rows } = await pool
    .query<{ n: string }>(`SELECT count(*) AS n FROM quest_instances WHERE trader = $1 AND status = 'done' AND completed_on = $2`, [trader, date])
    .catch(() => ({ rows: [] as { n: string }[] }));
  return Number(rows[0]?.n ?? 0);
}

/** The «quest assigned» notification of a quest the curator cancelled is read: it no longer asks for anything. */
export async function markAssignedNoticeRead(trader: string, questId: number): Promise<void> {
  await pool
    .query(
      `UPDATE notifications SET is_read = true, read_at = COALESCE(read_at, now())
        WHERE user_name = $1 AND type = 'quest_assigned' AND entity_type = 'quest' AND entity_id = $2 AND is_read = false`,
      [trader, String(questId)],
    )
    .catch(() => undefined);
}

// ─── achievements ───────────────────────────────────────────────────────────

/** `detail` — what a dynamic line is about (setup / slice / path step); `quiet` — stored seen (no ceremony: history). */
export type StoredAchievement = { line: string; tier: string; date: string; target: number; detail?: Record<string, unknown> | null; quiet?: boolean };

export async function achievementsOf(trader: string): Promise<StoredAchievement[]> {
  const { rows } = await pool
    .query<{ line: string; tier: string; earned_on: string; target: number }>(
      `SELECT line, tier, earned_on, target FROM trader_achievements WHERE trader = $1`,
      [trader],
    )
    .catch(() => ({ rows: [] as { line: string; tier: string; earned_on: string; target: number }[] }));
  return rows.map((r) => ({ line: r.line, tier: r.tier, date: String(r.earned_on), target: Number(r.target) }));
}

/** Stores one tier (once). True when this call awarded it. */
export async function insertAchievement(trader: string, a: StoredAchievement): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO trader_achievements (trader, line, tier, earned_on, target, detail, seen_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, CASE WHEN $7::boolean THEN now() END)
     ON CONFLICT (trader, line, tier) DO NOTHING RETURNING line`,
    [trader, a.line, a.tier, a.date, a.target, a.detail ? JSON.stringify(a.detail) : null, !!a.quiet],
  );
  return rows.length > 0;
}

/** Moves a stored tier to the day its target was really reached (lib/quests/achievements dateFixes). */
export async function fixAchievementDate(trader: string, a: StoredAchievement): Promise<boolean> {
  const r = await pool.query(
    `UPDATE trader_achievements SET earned_on = $4 WHERE trader = $1 AND line = $2 AND tier = $3 AND target = $5 AND earned_on <> $4`,
    [trader, a.line, a.tier, a.date, a.target],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Discipline badges stored by an older process (trader_badges) — mapped into the lines without a notification. */
export async function legacyBadges(trader: string): Promise<{ badge: string; date: string; target: number }[]> {
  const { rows } = await pool
    .query<{ badge: string; awarded_on: string; target: number }>(`SELECT badge, awarded_on, target FROM trader_badges WHERE trader = $1`, [trader])
    .catch(() => ({ rows: [] as { badge: string; awarded_on: string; target: number }[] }));
  return rows.map((r) => ({ badge: r.badge, date: String(r.awarded_on), target: Number(r.target) }));
}

// ─── events and the curator view ────────────────────────────────────────────

/** Records a site action quests count (first time per ref). Never throws. */
export async function recordQuestEvent(trader: string, kind: "desk_day_open", ref: string, day: string): Promise<boolean> {
  const r = await pool
    .query(`INSERT INTO quest_events (trader, kind, ref, day) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [trader, kind, ref, day])
    .catch(() => ({ rowCount: 0 }));
  return (r.rowCount ?? 0) > 0;
}

/** `note` — the curator's note on the quest (shown next to the result in the cabinet). */
export type QuestEvent = { trader: string; questId: number; template: string; status: "done" | "failed" | "expired"; at: string; note: string | null };

type QuestEventRow = { trader: string; id: number; template: string; status: string; at: string; note: string | null };

/** Row → event. */
function toQuestEvent(r: QuestEventRow): QuestEvent {
  return { trader: r.trader, questId: Number(r.id), template: r.template, status: r.status as QuestEvent["status"], at: String(r.at), note: r.note ?? null };
}

/** Curator quests of `traders` that finished since `from` (NY day), newest first. */
export async function curatorQuestEvents(traders: readonly string[], from: string): Promise<QuestEvent[]> {
  if (!traders.length) return [];
  const { rows } = await pool
    .query<QuestEventRow>(
      `SELECT trader, id, template, status, COALESCE(completed_on, to_char(updated_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')) AS at, note
         FROM quest_instances
        WHERE scope = 'curator' AND trader = ANY($1::text[]) AND status IN ('done', 'failed', 'expired')
          AND to_char(updated_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') >= $2
        ORDER BY updated_at DESC LIMIT 200`,
      [traders, from],
    )
    .catch(() => ({ rows: [] as QuestEventRow[] }));
  return rows.map(toQuestEvent);
}

/** Traders that have active quests or played a part today (the nightly rollover's list). */
export async function tradersWithActiveQuests(): Promise<string[]> {
  const { rows } = await pool
    .query<{ trader: string }>(`SELECT DISTINCT trader FROM quest_instances WHERE status = 'active'`)
    .catch(() => ({ rows: [] as { trader: string }[] }));
  return rows.map((r) => r.trader);
}
