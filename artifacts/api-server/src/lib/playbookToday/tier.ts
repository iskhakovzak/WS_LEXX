/**
 * A member's tier on the trader ladder — the one resolution the playbook tier locks use (./service.ts loadPerson) and the
 * web shell reads through GET /api/permissions/me (`tier`) to pick the simple menu for new traders:
 * own academy stage → active enrolment → scaling tier → DEFAULT_STAGE («Джун») for a trader without one (lib/people/stage.ts — the
 * one stage resolution; a stored legacy «trainee» reads as Джун, Волна 1 п. 1.21 — so the simple menu and the playbook locks
 * of the newcomers now apply to Джуны). Staff (curator / admin) have no tier: `viewerTier` answers null for them.
 */
import { pool } from "@workspace/db";
import { pickStage } from "../people/stage";
import { isTierKey, type TierKey } from "./build";

const none = <T>() => ({ rows: [] as T[] });

/** Role + tier straight from the tables (no cache). `tier` is null for staff / unknown members without a stage source. */
export async function loadStaffTier(trader: string): Promise<{ staff: boolean; tier: string | null }> {
  const [user, own, enr, lim] = await Promise.all([
    pool.query<{ role: string }>(`SELECT role FROM users WHERE name = $1 LIMIT 1`, [trader]).catch(() => none<{ role: string }>()),
    pool.query<{ stage: string }>(`SELECT stage FROM academy_trader_stage WHERE user_name = $1`, [trader]).catch(() => none<{ stage: string }>()),
    pool.query<{ stage: string }>(
      `SELECT stage FROM academy_enrollments WHERE user_name = $1 AND archived_at IS NULL AND COALESCE(status, 'active') IN ('active', 'paused')
        ORDER BY joined_on DESC NULLS LAST, id DESC LIMIT 1`,
      [trader],
    ).catch(() => none<{ stage: string }>()),
    pool.query<{ tier: string | null }>(`SELECT tier FROM trader_risk_limits WHERE trader = $1`, [trader]).catch(() => none<{ tier: string | null }>()),
  ]);
  const role = user.rows[0]?.role ?? null;
  return {
    staff: role === "curator" || role === "admin",
    tier: pickStage(own.rows[0]?.stage, enr.rows[0]?.stage, lim.rows[0]?.tier, role),
  };
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; tier: TierKey | null }>();

/** The viewer's tier for the shell (cached TTL_MS per name); staff and unknown → null. */
export async function viewerTier(name: string | null | undefined): Promise<TierKey | null> {
  if (!name) return null;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tier;
  const p = await loadStaffTier(name);
  const tier = !p.staff && isTierKey(p.tier) ? p.tier : null;
  cache.set(name, { at: Date.now(), tier });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
  return tier;
}

/** Drop a cached tier (a stage / tier change elsewhere). */
export function forgetTier(name: string): void {
  cache.delete(name);
}
