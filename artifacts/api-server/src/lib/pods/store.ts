/**
 * Trading pods storage (tables trading_pods / trading_pod_members / trading_pod_posts, migration 0287; the stats and
 * their privacy are ./stats.ts). Pods live inside a desk group (desk_groups): its curator — or an admin — manages
 * them; only traders of that group can be members, each in one pod at most. SQL only; GET never writes.
 */
import { pool } from "@workspace/db";
import { closedSql, netPnlSql, resultSql, signedRSql } from "../tradeMath";
import type { Queryable } from "../interventions/log";
import type { MemberTotals } from "./stats";

export type PodMember = { id: number; name: string };
export type Pod = { id: number; groupId: number; groupName: string; curatorId: number | null; name: string; members: PodMember[]; createdAt: string };

const ACTIVE = `u.active = true AND COALESCE(u.banned, false) = false`;

async function loadPods(where: string, params: unknown[], db: Queryable): Promise<Pod[]> {
  const { rows } = await db.query(
    `SELECT p.id, p.group_id, g.name AS group_name, g.curator_id, p.name, p.created_at,
            COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
       FROM trading_pods p
       JOIN desk_groups g ON g.id = p.group_id AND g.archived_at IS NULL
       LEFT JOIN trading_pod_members m ON m.pod_id = p.id
       LEFT JOIN users u ON u.id = m.user_id AND ${ACTIVE}
      WHERE p.archived_at IS NULL AND ${where}
      GROUP BY p.id, g.name, g.curator_id
      ORDER BY g.name, p.name, p.id`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id), groupId: Number(r.group_id), groupName: String(r.group_name), curatorId: r.curator_id == null ? null : Number(r.curator_id),
    name: String(r.name), members: (r.members as PodMember[]).map((m) => ({ id: Number(m.id), name: String(m.name) })), createdAt: new Date(r.created_at).toISOString(),
  }));
}

export const podById = async (id: number, db: Queryable = pool) => (await loadPods(`p.id = $1`, [id], db))[0] ?? null;
export const podsOfGroups = (groupIds: readonly number[] | null, db: Queryable = pool) =>
  groupIds === null ? loadPods(`TRUE`, [], db) : loadPods(`p.group_id = ANY($1::int[])`, [[...groupIds]], db);
export async function podOfUser(userId: number, db: Queryable = pool): Promise<Pod | null> {
  return (await loadPods(`p.id = (SELECT pod_id FROM trading_pod_members WHERE user_id = $1)`, [userId], db))[0] ?? null;
}

export type ManagedGroup = { id: number; name: string; curatorId: number | null; traders: PodMember[] };
/** Live groups `curatorId` leads (null = every group: an admin), with their active traders. */
export async function managedGroups(curatorId: number | null, db: Queryable = pool): Promise<ManagedGroup[]> {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.curator_id,
            COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]') AS traders
       FROM desk_groups g LEFT JOIN users u ON u.group_id = g.id AND u.role = 'trader' AND ${ACTIVE}
      WHERE g.archived_at IS NULL AND ($1::int IS NULL OR g.curator_id = $1)
      GROUP BY g.id ORDER BY g.sort_order, lower(g.name), g.id`,
    [curatorId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), curatorId: r.curator_id == null ? null : Number(r.curator_id), traders: r.traders as PodMember[] }));
}

/** Which of `userIds` are active traders of group `groupId`. */
export async function tradersOfGroup(groupId: number, userIds: readonly number[], db: Queryable = pool): Promise<number[]> {
  if (!userIds.length) return [];
  const { rows } = await db.query(`SELECT u.id FROM users u WHERE u.id = ANY($1::int[]) AND u.group_id = $2 AND u.role = 'trader' AND ${ACTIVE}`, [[...userIds], groupId]);
  return rows.map((r) => Number(r.id));
}

/** Members already in another pod (a trader is in one pod at most). */
export async function inOtherPod(userIds: readonly number[], podId: number | null, db: Queryable = pool): Promise<number[]> {
  if (!userIds.length) return [];
  const { rows } = await db.query(`SELECT user_id FROM trading_pod_members WHERE user_id = ANY($1::int[]) AND ($2::int IS NULL OR pod_id <> $2)`, [[...userIds], podId]);
  return rows.map((r) => Number(r.user_id));
}

export async function createPod(groupId: number, name: string, memberIds: readonly number[], by: string): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(`INSERT INTO trading_pods (group_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`, [groupId, name, by]);
    const id = Number(rows[0].id);
    await c.query(`INSERT INTO trading_pod_members (pod_id, user_id) SELECT $1, unnest($2::int[])`, [id, [...memberIds]]);
    await c.query("COMMIT");
    return id;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function updatePod(id: number, x: { name?: string; memberIds?: readonly number[]; archived?: boolean }): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (x.name) await c.query(`UPDATE trading_pods SET name = $2, updated_at = now() WHERE id = $1`, [id, x.name]);
    if (x.archived) {
      await c.query(`UPDATE trading_pods SET archived_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await c.query(`DELETE FROM trading_pod_members WHERE pod_id = $1`, [id]);
    } else if (x.memberIds) {
      await c.query(`DELETE FROM trading_pod_members WHERE pod_id = $1 AND NOT (user_id = ANY($2::int[]))`, [id, [...x.memberIds]]);
      await c.query(`INSERT INTO trading_pod_members (pod_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`, [id, [...x.memberIds]]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Per member: closed trades of [from, to] (NY entry day) with $ (net), the decided count and R — the stats input. */
export async function memberTotals(names: readonly string[], from: string, to: string, db: Queryable = pool): Promise<MemberTotals[]> {
  if (!names.length) return [];
  const { rows } = await db.query(
    `SELECT t.trader, COUNT(*)::int AS trades,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'win')::int AS wins, COUNT(*) FILTER (WHERE ${resultSql("t")} = 'loss')::int AS losses,
            SUM(${netPnlSql("t")})::float8 AS net, COALESCE(SUM(${signedRSql("t")}), 0)::float8 AS sum_r, COUNT(${signedRSql("t")})::int AS r_trades
       FROM trades t
      WHERE t.deleted_at IS NULL AND t.trader = ANY($1::text[]) AND ${closedSql("t")}
        AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(t.date, 10) BETWEEN $2 AND $3
      GROUP BY t.trader`,
    [[...names], from, to],
  );
  const by = new Map(rows.map((r) => [String(r.trader), r]));
  return names.map((n) => {
    const r = by.get(n);
    return {
      trader: n, trades: r ? Number(r.trades) : 0, wins: r ? Number(r.wins) : 0, losses: r ? Number(r.losses) : 0,
      net: r?.net == null ? null : Number(r.net), sumR: r ? Number(r.sum_r) : 0, rTrades: r ? Number(r.r_trades) : 0,
    };
  });
}

// ─── feed and weekly review ───────────────────────────────────────────────────────────────────────────────────────

export type PodPost = { id: number; kind: "post" | "review"; week: string | null; body: string; author: string; updatedBy: string | null; createdAt: string; updatedAt: string };
const POST_COLS = `id, kind, week, body, author, updated_by, created_at, updated_at`;
const toPost = (r: any): PodPost => ({
  id: Number(r.id), kind: r.kind, week: r.week ?? null, body: String(r.body), author: String(r.author), updatedBy: r.updated_by ?? null,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

export async function podFeed(podId: number, limit = 50, db: Queryable = pool): Promise<PodPost[]> {
  const { rows } = await db.query(`SELECT ${POST_COLS} FROM trading_pod_posts WHERE pod_id = $1 AND kind = 'post' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`, [podId, limit]);
  return rows.map(toPost);
}

export async function addPost(podId: number, body: string, author: string, db: Queryable = pool): Promise<PodPost> {
  const { rows } = await db.query(`INSERT INTO trading_pod_posts (pod_id, kind, body, author) VALUES ($1, 'post', $2, $3) RETURNING ${POST_COLS}`, [podId, body, author]);
  return toPost(rows[0]);
}

export async function postById(podId: number, id: number, db: Queryable = pool): Promise<PodPost | null> {
  const { rows } = await db.query(`SELECT ${POST_COLS} FROM trading_pod_posts WHERE pod_id = $1 AND id = $2 AND deleted_at IS NULL`, [podId, id]);
  return rows[0] ? toPost(rows[0]) : null;
}

export async function deletePost(id: number, db: Queryable = pool): Promise<void> {
  await db.query(`UPDATE trading_pod_posts SET deleted_at = now() WHERE id = $1`, [id]);
}

export async function podReview(podId: number, week: string, db: Queryable = pool): Promise<PodPost | null> {
  const { rows } = await db.query(`SELECT ${POST_COLS} FROM trading_pod_posts WHERE pod_id = $1 AND kind = 'review' AND week = $2 AND deleted_at IS NULL`, [podId, week]);
  return rows[0] ? toPost(rows[0]) : null;
}

/** The one shared review of a pod-week: created by the first writer, then edited by anyone in the pod. */
export async function saveReview(podId: number, week: string, body: string, by: string, db: Queryable = pool): Promise<PodPost> {
  const { rows } = await db.query(
    `INSERT INTO trading_pod_posts (pod_id, kind, week, body, author, updated_by) VALUES ($1, 'review', $2, $3, $4, $4)
     ON CONFLICT (pod_id, week) WHERE kind = 'review' AND deleted_at IS NULL
     DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING ${POST_COLS}`,
    [podId, week, body, by],
  );
  return toPost(rows[0]);
}
