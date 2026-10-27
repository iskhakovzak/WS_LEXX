/**
 * Nightly in-app batch of reward pings (roadmap R3): a quest_done / achievement_earned for the trader is queued here
 * (table notification_batch_items, migration 0247) instead of a notification each; job notifications.rewards-batch
 * (src/jobs/definitions.ts, after the quests and gamification nightly runs) writes ONE in-app notification per person:
 *   quests (and maybe achievements) → quest_done   { variant: "batch", count, points, achievements }
 *   achievements only              → achievement_earned { variant: "batch", count }
 * Never Telegram. A type the person switched off (notification preferences) is not queued at all.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { deliveryVerdict } from "./notificationCore";
import { insertNotification, loadNotificationPrefs } from "./notifyUtils";

export type BatchType = "quest_done" | "achievement_earned";
export type BatchItem = { type: BatchType; params: Record<string, unknown> };

/** Queues a reward ping for the nightly batch. Never throws. */
export async function enqueueBatch(userName: string, type: BatchType, params: Record<string, unknown>, entityId?: string | null): Promise<void> {
  try {
    if (!deliveryVerdict(type, await loadNotificationPrefs(userName)).deliver) return;
    await pool.query(
      `INSERT INTO notification_batch_items (user_name, type, params, entity_id) VALUES ($1, $2, $3::jsonb, $4)`,
      [userName, type, JSON.stringify(params), entityId ?? null],
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, userName, type }, "notification batch: enqueue failed");
  }
}

/** The one notification of a person's pending items (pure). */
export function batchNotice(items: readonly BatchItem[]): { type: BatchType; params: Record<string, number | string> } | null {
  const quests = items.filter((i) => i.type === "quest_done");
  const achievements = items.filter((i) => i.type === "achievement_earned").length;
  if (quests.length) {
    const points = quests.reduce((s, q) => s + (typeof q.params.points === "number" ? q.params.points : 0), 0);
    return { type: "quest_done", params: { variant: "batch", count: quests.length, points, achievements } };
  }
  return achievements ? { type: "achievement_earned", params: { variant: "batch", count: achievements } } : null;
}

const QUESTS_LINK = "/ratings?tab=quests";

/** Writes one notification per person with pending items and marks them flushed. Idempotent per item. */
export async function flushBatches(o: { signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ id: string; user_name: string; type: BatchType; params: Record<string, unknown> | null }>(
    `SELECT id, user_name, type, params FROM notification_batch_items WHERE flushed_at IS NULL ORDER BY user_name, id`,
  );
  const byUser = new Map<string, { ids: number[]; items: BatchItem[] }>();
  for (const r of rows) {
    const u = byUser.get(r.user_name) ?? { ids: [], items: [] };
    u.ids.push(Number(r.id));
    u.items.push({ type: r.type, params: r.params ?? {} });
    byUser.set(r.user_name, u);
  }
  let notified = 0;
  for (const [userName, u] of byUser) {
    if (o.signal?.aborted) break;
    // Claim first: a second process (or a re-run) never writes the same batch twice.
    const { rowCount } = await pool.query(`UPDATE notification_batch_items SET flushed_at = now() WHERE id = ANY($1::bigint[]) AND flushed_at IS NULL`, [u.ids]);
    if (!rowCount) continue;
    const n = batchNotice(u.items);
    if (!n) continue;
    const id = await insertNotification({ userName, type: n.type, params: n.params, link: QUESTS_LINK, entityType: "batch", source: "quests" });
    if (id != null) notified++;
  }
  return { people: byUser.size, items: rows.length, notified };
}
