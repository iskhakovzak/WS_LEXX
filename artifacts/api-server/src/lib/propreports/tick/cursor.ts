/**
 * Durable step cursors (table propreports_cursors: key TEXT PK, value JSONB, updated_at). Keys are namespaced by the
 * owning step, e.g. "fills:acct:<account>", "backfill:<id>", "adjustments:acct:<accountId>". Values are small JSON.
 */
import { pool } from "@workspace/db";

type Queryable = { query: (typeof pool)["query"] };

export async function getCursor<T = unknown>(key: string, db: Queryable = pool): Promise<T | null> {
  const { rows } = await db.query(`SELECT value FROM propreports_cursors WHERE key = $1`, [key]);
  return rows[0] ? (rows[0].value as T) : null;
}

/** All cursors whose key starts with `prefix` (e.g. "fills:acct:"), as a key → value map. */
export async function getCursors<T = unknown>(prefix: string, db: Queryable = pool): Promise<Map<string, T>> {
  const { rows } = await db.query(`SELECT key, value FROM propreports_cursors WHERE key LIKE $1`, [`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]);
  return new Map(rows.map((r: { key: string; value: unknown }) => [r.key, r.value as T]));
}

export async function setCursor(key: string, value: unknown, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO propreports_cursors (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}
