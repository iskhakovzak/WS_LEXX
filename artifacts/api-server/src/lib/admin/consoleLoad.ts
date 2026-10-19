/**
 * Admin console helpers (routes/admin-console.ts): the review load per curator (OWNER-05) and the newest DB backup for
 * the Обзор «нет свежего бэкапа» item (OWNER-14). `groupReviewLoad` is pure (tests: lib/__tests__/adminAccess.test.ts).
 */
import { pool } from "@workspace/db";
import { latestBackupAt } from "../dbBackupCron";
import { marketClosedDays } from "../curatorStore";
import { QUEUE_DEFAULT_DAYS } from "../curatorLogic";
import { REVIEW_SLA_HOURS, tradingHoursBetween } from "../eodLogic";
import { nyDate } from "../tradingDate";

/** Newest stored DB backup, cached for 5 min (object storage listing). */
let backupCache: { at: number; last: Date | null } | null = null;
export async function lastBackupCached(): Promise<Date | null> {
  if (backupCache && Date.now() - backupCache.at < 5 * 60_000) return backupCache.last;
  const last = await latestBackupAt().catch(() => null);
  backupCache = { at: Date.now(), last };
  return last;
}

export type ReviewLoad = {
  slaHours: number;
  windowDays: number;
  curators: { name: string; wards: number; count: number; overdue: number }[];
  unassigned: { traders: number; count: number; overdue: number };
};

/**
 * Waiting days grouped by the trader's curator. Curators (role curator) are always listed, even with 0; admins only
 * with wards or waiting days. Days of traders without an (active staff) curator count as «без куратора».
 */
export function groupReviewLoad(
  days: readonly { curator: string | null; closedAt: Date | string }[],
  staff: readonly { name: string; role: string; wards: number }[],
  noCuratorTraders: number,
  closed: ReadonlySet<string>,
  now: number = Date.now(),
): ReviewLoad {
  const by = new Map<string | null, { count: number; overdue: number }>();
  for (const d of days) {
    const cell = by.get(d.curator ?? null) ?? { count: 0, overdue: 0 };
    cell.count++;
    if (tradingHoursBetween(d.closedAt, now, closed) > REVIEW_SLA_HOURS) cell.overdue++;
    by.set(d.curator ?? null, cell);
  }
  const curators = staff
    .filter((c) => c.role === "curator" || Number(c.wards) > 0 || by.has(c.name))
    .map((c) => ({ name: c.name, wards: Number(c.wards ?? 0), ...(by.get(c.name) ?? { count: 0, overdue: 0 }) }));
  const known = new Set(curators.map((c) => c.name));
  const orphan = { count: 0, overdue: 0 };
  for (const [k, v] of by) if (k === null || !known.has(k)) { orphan.count += v.count; orphan.overdue += v.overdue; }
  curators.sort((a, b) => b.overdue - a.overdue || b.count - a.count || a.name.localeCompare(b.name, "ru"));
  return { slaHours: REVIEW_SLA_HOURS, windowDays: QUEUE_DEFAULT_DAYS, curators, unassigned: { traders: noCuratorTraders, ...orphan } };
}

const rows = <T>(sql: string, params: unknown[] = []): Promise<T[]> => pool.query(sql, params).then((r) => r.rows as T[]).catch(() => []);

/**
 * The queue rule of routes/eod.ts (closed, not reviewed, not acknowledged, closed within QUEUE_DEFAULT_DAYS) per
 * curator, with SLA breaches in trading hours (lib/eodLogic).
 */
export async function reviewLoad(): Promise<ReviewLoad> {
  const [days, staff, noCurator, closed] = await Promise.all([
    rows<{ curator: string | null; closed_at: Date }>(
      `SELECT NULLIF(u.assigned_curator, '') AS curator, d.closed_at
         FROM eod_days d LEFT JOIN users u ON u.name = d.trader
        WHERE d.closed_at IS NOT NULL AND d.reviewed_at IS NULL
          AND d.closed_at > NOW() - make_interval(days => $1::int)
          AND NOT EXISTS (SELECT 1 FROM curator_queue_acks a WHERE a.revoked_at IS NULL AND a.item_id = 'eod:' || d.id)`,
      [QUEUE_DEFAULT_DAYS],
    ),
    rows<{ name: string; role: string; wards: number }>(
      `SELECT c.name, c.role, (SELECT COUNT(*)::int FROM users w WHERE w.assigned_curator = c.name AND w.active = true AND w.role = 'trader') AS wards
         FROM users c WHERE c.active = true AND c.role IN ('curator', 'admin') ORDER BY c.name`,
    ),
    rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'trader' AND active = true AND NULLIF(assigned_curator, '') IS NULL`),
    marketClosedDays(nyDate()).catch(() => new Set<string>()),
  ]);
  return groupReviewLoad(days.map((d) => ({ curator: d.curator, closedAt: d.closed_at })), staff, noCurator[0]?.n ?? 0, closed);
}
