/**
 * Desk groups (Волна 1 п. 1.19, owner decision 3): the desk is split into groups, each with its curator; a curator
 * sees his group by default («Моя группа / Все»). Storage of routes/desk-groups.ts plus the one «my people» read every
 * scope uses: lib/permissions (matrix scope `assigned`), lib/curatorRoster (curator cabinet), lib/academyPeople
 * (Academy mentor page), routes/academy-path.ts (funnel / requests) and routes/curator-requests.ts.
 *
 *   desk_groups (migration 0231)   id, name, curator_id → users.id, sort_order, archived_at (archived, never deleted)
 *   users.group_id                 the trader's group; NULL = «Без группы»
 *
 * The group's curator is also written to users.assigned_curator of its traders (moving a trader in, changing the
 * group's curator), so notifications and the older «assigned» readers keep reaching the right person.
 */
import { pool } from "@workspace/db";

type Row = Record<string, any>;
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type DeskGroupMember = { id: number; name: string };
export type DeskGroup = {
  id: number; name: string; curatorId: number | null; curatorName: string | null; sortOrder: number; members: DeskGroupMember[];
};
export type DeskGroupsState = {
  groups: DeskGroup[];
  /** Active traders without a group. */
  ungrouped: DeskGroupMember[];
  /** Who may lead a group: active curators and admins. */
  curators: DeskGroupMember[];
};

const ACTIVE_USER = `u.active = true AND COALESCE(u.banned, false) = false`;

/** Missing table (fresh DB before migration 0231) → nothing to read. */
async function soft<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "42P01" || code === "42703") return empty;
    throw err;
  }
}

/**
 * Active traders in the live groups led by `curator` (by name; the group stores the id). The «my group» half of every
 * «Моя группа» scope — callers add the older per-trader assignments (assigned_curator / mentor / risk manager).
 */
export async function groupMembersOf(curator: string | null | undefined, db: Queryable = pool): Promise<string[]> {
  if (!curator) return [];
  const { rows } = await soft(db.query(
    `SELECT u.name FROM users u
       JOIN desk_groups g ON g.id = u.group_id AND g.archived_at IS NULL
       JOIN users c ON c.id = g.curator_id
      WHERE c.name = $1 AND u.role = 'trader' AND ${ACTIVE_USER}
      ORDER BY u.name`,
    [curator],
  ), { rows: [] as Row[] });
  return rows.map((r) => String(r.name));
}

/** Everything the «Группы» screen shows: live groups with curator and members, traders without a group, curators. */
export async function loadDeskGroups(db: Queryable = pool): Promise<DeskGroupsState> {
  const [groups, people] = await Promise.all([
    soft(db.query(
      `SELECT g.id, g.name, g.curator_id, c.name AS curator_name, g.sort_order
         FROM desk_groups g LEFT JOIN users c ON c.id = g.curator_id
        WHERE g.archived_at IS NULL ORDER BY g.sort_order, lower(g.name), g.id`,
    ), { rows: [] as Row[] }),
    db.query(`SELECT u.id, u.name, u.role, u.group_id FROM users u WHERE ${ACTIVE_USER} AND u.role IN ('trader', 'curator', 'admin') ORDER BY u.name`),
  ]);
  const live = new Set(groups.rows.map((g) => Number(g.id)));
  const traders = people.rows.filter((p) => p.role === "trader");
  const member = (p: Row): DeskGroupMember => ({ id: Number(p.id), name: String(p.name) });
  return {
    groups: groups.rows.map((g) => ({
      id: Number(g.id), name: String(g.name), curatorId: g.curator_id == null ? null : Number(g.curator_id),
      curatorName: g.curator_name == null ? null : String(g.curator_name), sortOrder: Number(g.sort_order) || 0,
      members: traders.filter((t) => Number(t.group_id) === Number(g.id)).map(member),
    })),
    ungrouped: traders.filter((t) => t.group_id == null || !live.has(Number(t.group_id))).map(member),
    curators: people.rows.filter((p) => p.role === "curator" || p.role === "admin").map(member),
  };
}

/** An active curator / admin by id (null = not one — DESK_GROUP_CURATOR_INVALID). */
export async function curatorById(id: number, db: Queryable = pool): Promise<DeskGroupMember | null> {
  const { rows } = await db.query(`SELECT u.id, u.name FROM users u WHERE u.id = $1 AND u.role IN ('curator', 'admin') AND ${ACTIVE_USER}`, [id]);
  return rows[0] ? { id: Number(rows[0].id), name: String(rows[0].name) } : null;
}

/** Is another live group already called `name` (case-insensitive)? */
export async function groupNameTaken(name: string, exceptId: number | null, db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM desk_groups WHERE archived_at IS NULL AND lower(name) = lower($1) AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
    [name, exceptId],
  );
  return rows.length > 0;
}

export async function liveGroup(id: number, db: Queryable = pool): Promise<{ id: number; name: string; curatorId: number | null } | null> {
  const { rows } = await db.query(`SELECT id, name, curator_id FROM desk_groups WHERE id = $1 AND archived_at IS NULL`, [id]);
  return rows[0] ? { id: Number(rows[0].id), name: String(rows[0].name), curatorId: rows[0].curator_id == null ? null : Number(rows[0].curator_id) } : null;
}

export async function insertGroup(name: string, curatorId: number | null, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO desk_groups (name, curator_id, sort_order)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM desk_groups WHERE archived_at IS NULL), 0)) RETURNING id`,
    [name, curatorId],
  );
  return Number(rows[0].id);
}

/**
 * Rename / change curator / reorder / archive one live group. A new curator becomes assigned_curator of its traders;
 * archiving releases its traders to «Без группы» (their assigned curator stays).
 */
export async function updateGroup(
  id: number,
  patch: { name?: string; curator?: DeskGroupMember | null; sortOrder?: number; archived?: boolean },
  db: Queryable = pool,
): Promise<void> {
  if (patch.archived) {
    await db.query(`UPDATE desk_groups SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL`, [id]);
    await db.query(`UPDATE users SET group_id = NULL WHERE group_id = $1`, [id]);
    return;
  }
  await db.query(
    `UPDATE desk_groups SET name = COALESCE($2, name), curator_id = CASE WHEN $3::boolean THEN $4::int ELSE curator_id END,
            sort_order = COALESCE($5, sort_order), updated_at = now()
      WHERE id = $1 AND archived_at IS NULL`,
    [id, patch.name ?? null, patch.curator !== undefined, patch.curator?.id ?? null, patch.sortOrder ?? null],
  );
  if (patch.curator) {
    await db.query(`UPDATE users SET assigned_curator = $2 WHERE group_id = $1 AND role = 'trader'`, [id, patch.curator.name]);
  }
}

/** Move an active trader into a group (null = «Без группы»); the group's curator becomes his assigned curator. */
export async function moveTrader(userId: number, groupId: number | null, db: Queryable = pool): Promise<{ name: string; from: number | null } | null> {
  const { rows } = await db.query(`SELECT u.name, u.group_id FROM users u WHERE u.id = $1 AND u.role = 'trader' AND ${ACTIVE_USER}`, [userId]);
  if (!rows[0]) return null;
  await db.query(
    `UPDATE users SET group_id = $2,
            assigned_curator = COALESCE((SELECT c.name FROM desk_groups g JOIN users c ON c.id = g.curator_id WHERE g.id = $2), assigned_curator)
      WHERE id = $1`,
    [userId, groupId],
  );
  return { name: String(rows[0].name), from: rows[0].group_id == null ? null : Number(rows[0].group_id) };
}

/**
 * «Моя группа / Все» for curator lists: `raw` = group | all (older clients: mine | desk). Without a choice a viewer who
 * leads anyone (group or assignments) sees them, else everyone. Returns the names to keep (null = everyone).
 */
export function pickScope(raw: unknown, mine: readonly string[]): { scope: "group" | "all"; names: Set<string> | null } {
  const want = raw === "group" || raw === "mine" ? "group" : raw === "all" || raw === "desk" ? "all" : null;
  const scope = want ?? (mine.length ? "group" : "all");
  return { scope, names: scope === "group" ? new Set(mine) : null };
}

/** The viewer's people: traders of his groups + traders assigned to him (curator / mentor / risk manager). */
export async function myPeople(viewer: string | null | undefined, db: Queryable = pool): Promise<string[]> {
  if (!viewer) return [];
  const [group, assigned] = await Promise.all([
    groupMembersOf(viewer, db),
    db.query(
      `SELECT u.name FROM users u WHERE ${ACTIVE_USER} AND u.role = 'trader'
          AND (u.assigned_curator = $1 OR u.assigned_mentor = $1 OR u.assigned_risk_manager = $1)`,
      [viewer],
    ).then((r) => r.rows.map((x) => String(x.name))).catch(() => [] as string[]),
  ]);
  return [...new Set([...group, ...assigned])].sort((a, b) => a.localeCompare(b, "ru"));
}
