/**
 * Rewards catalog storage (reward_items / reward_grants, migrations 0212, 0217). Idempotent by construction: eligibility
 * is INSERT … ON CONFLICT (item, trader, ref) DO UPDATE only of a «revoked» row … RETURNING (only the call that inserted
 * or revived it notifies); status changes are UPDATE … WHERE status IN (…) RETURNING; a grant takes one from the stock
 * in the same transaction. «revoked» rows (stale eligibility) are never answered to the API.
 */
import { pool } from "@workspace/db";
import type { RewardGrant, RewardItem } from "./types";

type ItemRow = {
  id: number; title: string; description: string | null; condition_kind: string; condition_ref: string; condition_tier: string | null;
  condition_rank: number | null; active: boolean; stock: number | null;
};
type GrantRow = {
  id: number; item_id: number; trader: string; ref: string; status: string; eligible_at: Date; requested_at: Date | null; decided_at: Date | null;
  decided_by: string | null; note: string | null; title?: string | null;
};

const ITEM_COLS = `id, title, description, condition_kind, condition_ref, condition_tier, condition_rank, active, stock`;
const GRANT_COLS = `g.id, g.item_id, g.trader, g.ref, g.status, g.eligible_at, g.requested_at, g.decided_at, g.decided_by, g.note`;

export function rowToItem(r: ItemRow): RewardItem {
  return {
    id: Number(r.id), title: r.title, description: r.description,
    condition: { kind: r.condition_kind as RewardItem["condition"]["kind"], ref: r.condition_ref ?? "", tier: r.condition_tier, rank: r.condition_rank == null ? null : Number(r.condition_rank) },
    active: !!r.active, stock: r.stock == null ? null : Number(r.stock),
  };
}

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

export function rowToGrant(r: GrantRow): RewardGrant {
  const at = r.status === "eligible" ? r.eligible_at : r.status === "requested" ? (r.requested_at ?? r.eligible_at) : (r.decided_at ?? r.eligible_at);
  return {
    id: Number(r.id), itemId: Number(r.item_id), trader: r.trader, status: r.status as RewardGrant["status"], at: iso(at)!, by: r.decided_by,
    note: r.note, ref: r.ref ?? "", title: r.title ?? null,
  };
}

export async function listItems(o: { activeOnly?: boolean } = {}): Promise<RewardItem[]> {
  const { rows } = await pool
    .query<ItemRow>(`SELECT ${ITEM_COLS} FROM reward_items ${o.activeOnly ? "WHERE active = true" : ""} ORDER BY active DESC, id`)
    .catch(() => ({ rows: [] as ItemRow[] }));
  return rows.map(rowToItem);
}

export async function itemById(id: number): Promise<RewardItem | null> {
  const { rows } = await pool.query<ItemRow>(`SELECT ${ITEM_COLS} FROM reward_items WHERE id = $1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

const itemParams = (i: Omit<RewardItem, "id">) => [
  i.title.trim(), i.description?.trim() || null, i.condition.kind, (i.condition.ref ?? "").trim(), i.condition.tier ?? null, i.condition.rank ?? null, i.active, i.stock,
];

export async function insertItem(i: Omit<RewardItem, "id">, by: string): Promise<RewardItem> {
  const { rows } = await pool.query<ItemRow>(
    `INSERT INTO reward_items (title, description, condition_kind, condition_ref, condition_tier, condition_rank, active, stock, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING ${ITEM_COLS}`,
    [...itemParams(i), by],
  );
  return rowToItem(rows[0]!);
}

export async function updateItem(id: number, i: Omit<RewardItem, "id">, by: string): Promise<RewardItem | null> {
  const { rows } = await pool.query<ItemRow>(
    `UPDATE reward_items SET title = $2, description = $3, condition_kind = $4, condition_ref = $5, condition_tier = $6, condition_rank = $7,
            active = $8, stock = $9, updated_by = $10, updated_at = now()
      WHERE id = $1 RETURNING ${ITEM_COLS}`,
    [id, ...itemParams(i), by],
  );
  return rows[0] ? rowToItem(rows[0]) : null;
}

const GRANT_FROM = `FROM reward_grants g JOIN reward_items i ON i.id = g.item_id`;

export async function grantsOf(trader: string): Promise<RewardGrant[]> {
  const { rows } = await pool
    .query<GrantRow>(`SELECT ${GRANT_COLS}, i.title ${GRANT_FROM} WHERE g.trader = $1 AND g.status <> 'revoked' ORDER BY g.id`, [trader])
    .catch(() => ({ rows: [] as GrantRow[] }));
  return rows.map(rowToGrant);
}

export async function grantById(id: number): Promise<RewardGrant | null> {
  const { rows } = await pool.query<GrantRow>(`SELECT ${GRANT_COLS}, i.title ${GRANT_FROM} WHERE g.id = $1`, [id]);
  return rows[0] ? rowToGrant(rows[0]) : null;
}

/** Requested grants of `traders` (null = everyone), oldest first. */
export async function requestedGrants(traders: readonly string[] | null): Promise<RewardGrant[]> {
  if (traders && !traders.length) return [];
  const { rows } = await pool
    .query<GrantRow>(
      `SELECT ${GRANT_COLS}, i.title ${GRANT_FROM} WHERE g.status = 'requested' AND ($1::text[] IS NULL OR g.trader = ANY($1::text[])) ORDER BY g.requested_at, g.id`,
      [traders],
    )
    .catch(() => ({ rows: [] as GrantRow[] }));
  return rows.map(rowToGrant);
}

export async function pendingCount(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM reward_grants WHERE status = 'requested'`).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(rows[0]?.n ?? 0);
}

/** Inserts an eligibility once (or revives a revoked one); the row when this call inserted / revived it. */
export async function insertEligible(itemId: number, trader: string, ref: string): Promise<RewardGrant | null> {
  const { rows } = await pool.query<GrantRow>(
    `WITH ins AS (INSERT INTO reward_grants (item_id, trader, ref) VALUES ($1, $2, $3)
                  ON CONFLICT (item_id, trader, ref) DO UPDATE
                    SET status = 'eligible', eligible_at = now(), decided_at = NULL, note = NULL, updated_at = now()
                    WHERE reward_grants.status = 'revoked'
                  RETURNING *)
     SELECT ${GRANT_COLS.replaceAll("g.", "ins.")}, i.title FROM ins JOIN reward_items i ON i.id = ins.item_id`,
    [itemId, trader, ref],
  );
  return rows[0] ? rowToGrant(rows[0]) : null;
}

/** eligible → revoked (stale eligibility); the revoked rows. */
export async function revokeGrants(ids: readonly number[]): Promise<{ id: number; trader: string }[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query<{ id: number; trader: string }>(
    `UPDATE reward_grants SET status = 'revoked', decided_at = now(), note = 'stale', updated_at = now()
      WHERE id = ANY($1::int[]) AND status = 'eligible' RETURNING id, trader`,
    [ids],
  );
  return rows.map((r) => ({ id: Number(r.id), trader: String(r.trader) }));
}

/** Open eligible grants of one item (re-checked when an admin edits its condition). */
export async function eligibleGrantsOfItem(itemId: number): Promise<RewardGrant[]> {
  const { rows } = await pool
    .query<GrantRow>(`SELECT ${GRANT_COLS}, i.title ${GRANT_FROM} WHERE g.item_id = $1 AND g.status = 'eligible' ORDER BY g.id`, [itemId])
    .catch(() => ({ rows: [] as GrantRow[] }));
  return rows.map(rowToGrant);
}

/** Marks the `type` notifications about these grants read (everyone's): a revoked «Доступна награда», a decided «просит награду». */
export async function markGrantNoticesRead(type: "reward_eligible" | "reward_requested", grantIds: readonly number[]): Promise<void> {
  if (!grantIds.length) return;
  await pool
    .query(
      `UPDATE notifications SET is_read = true, read_at = COALESCE(read_at, now())
        WHERE type = $1 AND entity_type = 'reward_grant' AND entity_id = ANY($2::text[]) AND is_read = false`,
      [type, grantIds.map(String)],
    )
    .catch(() => undefined);
}

export type RewardStats = { requested: number; granted: number; grantedMonth: number; declined: number; activeItems: number; items: number };

/** Admin overview numbers: open requests, rewards handed out (all time / since `monthStart`), the catalog size. */
export async function rewardStats(monthStart: string): Promise<RewardStats> {
  const { rows } = await pool
    .query<{ requested: number; granted: number; granted_month: number; declined: number; active_items: number; items: number }>(
      `SELECT (SELECT COUNT(*) FROM reward_grants WHERE status = 'requested')::int AS requested,
              (SELECT COUNT(*) FROM reward_grants WHERE status = 'granted')::int AS granted,
              (SELECT COUNT(*) FROM reward_grants WHERE status = 'granted'
                  AND decided_at >= ($1::date)::timestamp AT TIME ZONE 'America/New_York')::int AS granted_month,
              (SELECT COUNT(*) FROM reward_grants WHERE status = 'declined')::int AS declined,
              (SELECT COUNT(*) FROM reward_items WHERE active)::int AS active_items,
              (SELECT COUNT(*) FROM reward_items)::int AS items`,
      [monthStart],
    )
    .catch(() => ({ rows: [] as { requested: number; granted: number; granted_month: number; declined: number; active_items: number; items: number }[] }));
  const r = rows[0];
  return {
    requested: Number(r?.requested ?? 0), granted: Number(r?.granted ?? 0), grantedMonth: Number(r?.granted_month ?? 0),
    declined: Number(r?.declined ?? 0), activeItems: Number(r?.active_items ?? 0), items: Number(r?.items ?? 0),
  };
}

/** The last `n` granted rewards (admin history), newest first. */
export async function recentGranted(n: number): Promise<RewardGrant[]> {
  const { rows } = await pool
    .query<GrantRow>(`SELECT ${GRANT_COLS}, i.title ${GRANT_FROM} WHERE g.status = 'granted' ORDER BY g.decided_at DESC NULLS LAST, g.id DESC LIMIT $1`, [n])
    .catch(() => ({ rows: [] as GrantRow[] }));
  return rows.map(rowToGrant);
}

/** eligible → requested (the trader's oldest eligible grant of the item); null when there is none. */
export async function requestGrant(itemId: number, trader: string): Promise<RewardGrant | null> {
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE reward_grants SET status = 'requested', requested_at = now(), updated_at = now()
      WHERE id = (SELECT id FROM reward_grants WHERE item_id = $1 AND trader = $2 AND status = 'eligible' ORDER BY id LIMIT 1) AND status = 'eligible'
      RETURNING id`,
    [itemId, trader],
  );
  return rows[0] ? grantById(Number(rows[0].id)) : null;
}

export type Decision = { ok: true; grant: RewardGrant } | { ok: false; code: "REWARD_GRANT_DECIDED" | "REWARD_OUT_OF_STOCK" };

/** eligible | requested → granted (one from the stock) | declined, in one transaction. */
export async function decideGrant(id: number, status: "granted" | "declined", by: string, note: string | null): Promise<Decision> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const g = await client.query<{ item_id: number; status: string }>(`SELECT item_id, status FROM reward_grants WHERE id = $1 FOR UPDATE`, [id]);
    if (!g.rows[0] || !["eligible", "requested"].includes(g.rows[0].status)) {
      await client.query("ROLLBACK");
      return { ok: false, code: "REWARD_GRANT_DECIDED" };
    }
    if (status === "granted") {
      const s = await client.query(
        `UPDATE reward_items SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock - 1 END, updated_at = now() WHERE id = $1 AND (stock IS NULL OR stock > 0)`,
        [g.rows[0].item_id],
      );
      if (!s.rowCount) {
        await client.query("ROLLBACK");
        return { ok: false, code: "REWARD_OUT_OF_STOCK" };
      }
    }
    await client.query(
      `UPDATE reward_grants SET status = $2, decided_at = now(), decided_by = $3, note = $4, updated_at = now() WHERE id = $1`,
      [id, status, by, note],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { ok: true, grant: (await grantById(id))! };
}
