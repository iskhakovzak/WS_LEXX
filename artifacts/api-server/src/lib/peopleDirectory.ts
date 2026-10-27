/**
 * People directory + cross-script name search (RU / EN / UZ) — shared matcher @workspace/text-search.
 *
 *   users.name_latin (nullable) — optional Latin alias typed by an admin («Zakir Ishakov»); searched next to the name.
 *
 * Visibility: staff (team.read = desk) see everyone; a member under own / assigned scope sees only the names that
 * readScope(team.read) returns today (themselves + wards) plus staff (curators / admins are public on the desk anyway).
 */
import type { Request } from "express";
import { pool } from "@workspace/db";
import { searchItems, type MatchTier } from "@workspace/text-search";
import { readScope } from "./permissions";

export { cleanNameLatin } from "./people/nameLatin";

export type LatinNameChange = { id: number; name: string; nameLatin: string | null };

/**
 * Write Latin names (already cleaned) in one transaction, with one audit entry («user.name_latin», details
 * {name, from, to, bulk?}) per user whose value actually changed, in the same transaction. Returns the changes.
 * The caller reloads the display table (lib/people/latinNames → reloadLatinNames) when something changed.
 */
export async function saveLatinNames(items: readonly LatinNameChange[], actor: string, opts: { bulk?: boolean } = { bulk: true }): Promise<LatinNameChange[]> {
  if (!items.length) return [];
  const client = await pool.connect();
  const changed: LatinNameChange[] = [];
  try {
    await client.query("BEGIN");
    for (const it of items) {
      const { rows } = await client.query<{ prev: string | null }>(
        `UPDATE users u SET name_latin = $1 FROM (SELECT name_latin AS prev FROM users WHERE id = $2 FOR UPDATE) p
          WHERE u.id = $2 RETURNING p.prev`,
        [it.nameLatin, it.id],
      );
      if (!rows[0]) continue;
      const prev = rows[0].prev ?? null;
      if (prev === it.nameLatin) continue;
      await client.query(
        `INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES ($1, 'user.name_latin', 'user', $2, $3)`,
        [actor, String(it.id), JSON.stringify({ name: it.name, from: prev, to: it.nameLatin, ...(opts.bulk ? { bulk: true } : {}) })],
      );
      changed.push(it);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return changed;
}

export type DirectoryPerson = {
  id: number;
  name: string;
  nameLatin: string | null;
  role: string;
  curator: string | null;
  active: boolean;
  banned: boolean;
};

/** Every user row the caller may see (active first). */
export async function loadDirectory(req: Request, opts: { includeInactive?: boolean } = {}): Promise<DirectoryPerson[]> {
  const [{ rows }, visible] = await Promise.all([
    pool.query<{ id: number; name: string; name_latin: string | null; role: string; assigned_curator: string | null; active: boolean; banned: boolean }>(
      `SELECT id, name, name_latin, role, assigned_curator, active, COALESCE(banned, false) AS banned
         FROM users ${opts.includeInactive ? "" : "WHERE active = true"}
        ORDER BY active DESC, name`,
    ),
    readScope(req, "team.read"),
  ]);
  const allowed = visible === null ? null : new Set(visible);
  return rows
    .filter((u) => allowed === null || allowed.has(u.name) || u.role === "curator" || u.role === "admin")
    .map((u) => ({
      id: Number(u.id), name: String(u.name), nameLatin: u.name_latin ?? null, role: String(u.role),
      curator: u.assigned_curator ?? null, active: !!u.active, banned: !!u.banned,
    }));
}

export type PersonHit = DirectoryPerson & { score: number; tier: MatchTier; matched: "name" | "nameLatin" | "curator" };

/** Ranked people search: name and Latin alias first, curator name as a secondary field. */
export function searchPeople(people: DirectoryPerson[], q: string, limit = 20): PersonHit[] {
  const fields = ["name", "nameLatin", "curator"] as const;
  return searchItems(people, q, (p) => [p.name, p.nameLatin, { text: p.curator, weight: 0.5 }], { limit })
    .map((h) => ({ ...h.item, score: Math.round(h.score * 100) / 100, tier: h.tier, matched: fields[Math.max(0, h.field)] ?? "name" }));
}
