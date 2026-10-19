/**
 * Who takes part and who hides: active trader accounts, their curator (users.assigned_curator = the curator league
 * team), the per-user switch users.settings.shareAchievements (default on; off = left out of recognition, other traders'
 * rankings and the public titles), the chosen titles. Every loader degrades to «nobody» on a DB error.
 */
import { pool } from "@workspace/db";

export type Participant = { name: string; curator: string | null; share: boolean };

/** Active traders (role trader) with their curator and share switch. */
export async function participants(): Promise<Participant[]> {
  const { rows } = await pool
    .query<{ name: string; curator: string | null; share: boolean }>(
      `SELECT name, assigned_curator AS curator, COALESCE(settings ->> 'shareAchievements', 'true') <> 'false' AS share
         FROM users WHERE active = true AND role = 'trader'`,
    )
    .catch(() => ({ rows: [] as { name: string; curator: string | null; share: boolean }[] }));
  return rows.map((r) => ({ name: String(r.name), curator: r.curator ? String(r.curator) : null, share: r.share !== false }));
}

/** Users (any role) who switched achievements sharing off. */
export async function hiddenUsers(names?: readonly string[]): Promise<Set<string>> {
  const { rows } = await pool
    .query<{ name: string }>(
      `SELECT name FROM users WHERE settings ->> 'shareAchievements' = 'false' AND ($1::text[] IS NULL OR name = ANY($1::text[]))`,
      [names ?? null],
    )
    .catch(() => ({ rows: [] as { name: string }[] }));
  return new Set(rows.map((r) => String(r.name)));
}

export async function sharesAchievements(name: string): Promise<boolean> {
  return !(await hiddenUsers([name])).has(name);
}

/** Role and curator of one user (null when unknown). */
export async function userInfo(name: string): Promise<{ role: string; active: boolean; curator: string | null } | null> {
  const { rows } = await pool
    .query<{ role: string; active: boolean; curator: string | null }>(
      `SELECT role, active, assigned_curator AS curator FROM users WHERE name = $1 LIMIT 1`,
      [name],
    )
    .catch(() => ({ rows: [] as { role: string; active: boolean; curator: string | null }[] }));
  return rows[0] ?? null;
}

/** Active admins (reward requests of traders without a curator go to them). */
export async function activeAdmins(): Promise<string[]> {
  const { rows } = await pool
    .query<{ name: string }>(`SELECT name FROM users WHERE active = true AND role = 'admin'`)
    .catch(() => ({ rows: [] as { name: string }[] }));
  return rows.map((r) => String(r.name));
}

/** Chosen titles (gamification_profiles.active_title), not yet checked against what is earned. */
export async function chosenTitles(traders?: readonly string[]): Promise<Map<string, string>> {
  const { rows } = await pool
    .query<{ trader: string; active_title: string }>(
      `SELECT trader, active_title FROM gamification_profiles WHERE active_title IS NOT NULL AND ($1::text[] IS NULL OR trader = ANY($1::text[]))`,
      [traders ?? null],
    )
    .catch(() => ({ rows: [] as { trader: string; active_title: string }[] }));
  return new Map(rows.map((r) => [String(r.trader), String(r.active_title)]));
}

export async function setChosenTitle(trader: string, key: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO gamification_profiles (trader, active_title) VALUES ($1, $2)
     ON CONFLICT (trader) DO UPDATE SET active_title = EXCLUDED.active_title, updated_at = now()`,
    [trader, key],
  );
}
