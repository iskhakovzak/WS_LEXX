/**
 * One-time seeds (migration 0274 seed_markers): a seed that ran once on this database is never run again, so a person
 * who renames a seeded setup, clears its tags or empties a seeded list does not get the defaults back after a restart.
 */
import { pool } from "@workspace/db";

export async function seedDone(key: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM seed_markers WHERE key = $1`, [key]);
  return rows.length > 0;
}

export async function markSeedDone(key: string): Promise<void> {
  await pool.query(`INSERT INTO seed_markers (key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
}
