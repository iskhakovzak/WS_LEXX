/**
 * Tick lease: one row per lease name in propreports_tick_lease (holder, expires_at). Not a session advisory lock — the
 * tick spans several pooled connections, and a lock held by a hung or killed run would otherwise outlive it. A lease
 * that is not released (crash, timeout) simply expires.
 */
import { pool } from "@workspace/db";

type Queryable = { query: (typeof pool)["query"] };

export const TICK_LEASE = "tick";

/** Take the lease when it is free or expired. Returns true when `holder` now holds it. */
export async function acquireLease(name: string, holder: string, ttlSeconds: number, db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO propreports_tick_lease (name, holder, acquired_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + make_interval(secs => $3))
     ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, acquired_at = EXCLUDED.acquired_at, expires_at = EXCLUDED.expires_at
       WHERE propreports_tick_lease.expires_at < NOW()
     RETURNING holder`,
    [name, holder, ttlSeconds],
  );
  return rows[0]?.holder === holder;
}

/** Release only our own lease (a lease that expired and was taken by another tick is left alone). */
export async function releaseLease(name: string, holder: string, db: Queryable = pool): Promise<void> {
  await db.query(`UPDATE propreports_tick_lease SET expires_at = NOW() WHERE name = $1 AND holder = $2`, [name, holder]);
}

export async function leaseInfo(name: string, db: Queryable = pool): Promise<{ holder: string; acquiredAt: string; expiresAt: string; active: boolean } | null> {
  const { rows } = await db.query(`SELECT holder, acquired_at, expires_at, expires_at > NOW() AS active FROM propreports_tick_lease WHERE name = $1`, [name]);
  const r = rows[0];
  return r ? { holder: String(r.holder), acquiredAt: new Date(r.acquired_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString(), active: !!r.active } : null;
}
