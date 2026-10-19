/**
 * usage_events (migration 0214) — writes and retention.
 *
 *   insertUsageEvents(who, events)   POST /api/usage/batch: one multi-row INSERT (≤ 50 rows), ny_day from `at`
 *   pruneUsageEvents(days)           job usage.prune (nightly): rows older than usage.retentionDays
 */
import { pool } from "@workspace/db";
import { nyDate } from "../tradingDate";
import type { CleanEvent } from "./keys";

export type UsageActor = { id: number; name: string; role: string };

export async function insertUsageEvents(who: UsageActor, events: readonly CleanEvent[]): Promise<number> {
  if (!events.length) return 0;
  const r = await pool.query(
    `INSERT INTO usage_events (user_id, trader, role, kind, key, ny_day, at, meta)
     SELECT $1, $2, $3, x.kind, x.key, x.day, x.at, x.meta
       FROM unnest($4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::jsonb[]) AS x(kind, key, day, at, meta)`,
    [
      who.id, who.name, who.role,
      events.map((e) => e.kind),
      events.map((e) => e.key),
      events.map((e) => nyDate(e.at)),
      events.map((e) => e.at.toISOString()),
      events.map((e) => (e.meta ? JSON.stringify(e.meta) : null)),
    ],
  );
  return r.rowCount ?? events.length;
}

/** Deletes events older than `days` (configuration-driven data hygiene; the setting has a 14-day floor). */
export async function pruneUsageEvents(days: number): Promise<{ deleted: number; retentionDays: number }> {
  const keep = Math.max(14, Math.floor(days));
  const r = await pool.query(`DELETE FROM usage_events WHERE at < now() - make_interval(days => $1)`, [keep]);
  return { deleted: r.rowCount ?? 0, retentionDays: keep };
}
