/**
 * People lookups for the academy cohorts routes (routes/academy-cohorts.ts): a cohort's mentor (who may edit it),
 * the reader's wards («мои люди») and the desk tier of students (one tier everywhere). OLGA-18 / OLGA-19.
 */
import { pool } from "@workspace/db";
import { STAGES, stageLabelFor, type Stage } from "./academyCohorts";
import type { Lang } from "../i18n";

/** The cohort's mentor (null = none); undefined when the cohort does not exist. */
export async function cohortMentor(id: number): Promise<string | null | undefined> {
  const { rows } = await pool.query<{ mentor: string | null }>(`SELECT c.mentor FROM academy_cohorts c WHERE c.id = $1`, [id]);
  return rows[0] ? rows[0].mentor : undefined;
}

/** Active traders assigned to `me` as curator / mentor / risk manager — the /curator group. */
export async function wardsOf(me: string | null): Promise<Set<string>> {
  if (!me) return new Set();
  const { rows } = await pool
    .query<{ name: string }>(
      `SELECT name FROM users WHERE active = true AND COALESCE(banned, false) = false AND role = 'trader'
          AND (assigned_curator = $1 OR assigned_mentor = $1 OR assigned_risk_manager = $1)`,
      [me],
    )
    .catch(() => ({ rows: [] as { name: string }[] }));
  return new Set(rows.map((r) => r.name));
}

/** The risk-desk tier (trader_risk_limits.tier) per trader; traders without limits are absent. */
export async function deskTiers(names: readonly string[]): Promise<Map<string, string>> {
  if (!names.length) return new Map();
  const { rows } = await pool
    .query<{ trader: string; tier: string | null }>(`SELECT trader, tier FROM trader_risk_limits WHERE trader = ANY($1::text[])`, [names])
    .catch(() => ({ rows: [] as { trader: string; tier: string | null }[] }));
  return new Map(rows.filter((r) => r.tier).map((r) => [r.trader, String(r.tier)]));
}

/** `deskTier` / `deskTierLabel` of an enrollment row (null when the tier is unknown or not a ladder stage). */
export function deskTierOf(tier: string | undefined, lang: Lang): { deskTier: Stage | null; deskTierLabel: string | null } {
  const deskTier = tier && (STAGES as readonly string[]).includes(tier) ? (tier as Stage) : null;
  return { deskTier, deskTierLabel: deskTier ? stageLabelFor(deskTier, lang) : null };
}

/**
 * «Мои люди» on the mentor page (OLGA-18): students of my cohorts PLUS my wards (the /curator group) in whatever cohort
 * they are; `all` (or no cohorts and no wards) → every live cohort. `load(cohortIds, names)` reads the enrollments of
 * those cohorts or people; enrollments of archived cohorts are dropped. Returns them and the cohorts to show.
 */
export async function mentorPeople<E extends { cohort_id: number; user_name: string }>(
  me: string | null,
  liveCohorts: readonly { id: number; mentor: string | null }[],
  all: boolean,
  load: (cohortIds: number[], names: string[]) => Promise<E[]>,
): Promise<{ enr: E[]; cohortIds: Set<number>; scoped: boolean; ownCohorts: number }> {
  const mineIds = new Set(liveCohorts.filter((c) => c.mentor === me).map((c) => c.id));
  const wards = all ? new Set<string>() : await wardsOf(me);
  const scoped = !all && (mineIds.size > 0 || wards.size > 0);
  const live = new Set(liveCohorts.map((c) => c.id));
  const rows = await load(scoped ? [...mineIds] : [...live], scoped ? [...wards] : []);
  const enr = rows.filter((e) => live.has(e.cohort_id));
  return { enr, cohortIds: scoped ? new Set([...mineIds, ...enr.map((e) => e.cohort_id)]) : live, scoped, ownCohorts: mineIds.size };
}
