/**
 * The trader's ladder stage (Стажёр → Джун → Трейдер → Сеньор) — ONE resolution for every screen (Волна 0, item 0.6):
 * daily/me «До Джуна» (through lib/academyPathStore loadStageInfo → «Путь трейдера»), the shell menu tier and the playbook
 * tier locks (lib/playbookToday/tier.ts), the discussion audiences (lib/discussionAudience.ts), author notes.
 *
 * Precedence: approved transfer (academy_trader_stage) → active enrolment (academy_enrollments.stage) → risk tier
 * (trader_risk_limits.tier) → DEFAULT_STAGE for a member with the role `trader`, so the path shows criteria and the next
 * step from day one. Owner decision 2026-10-20: the default is «Джун» — «Стажёр» leaves the ladder in Волна 1; removing
 * it is a change of this one module (DEFAULT_STAGE, LEARNER sets in the callers read stage keys, not this default).
 * Staff without a stage stay without one.
 *
 * A promotion along the path (academy_trader_stage) also moves the risk tier: `syncRiskTier` writes
 * trader_risk_limits.tier in the caller's transaction (limits themselves are kept — the per-stage limit template is
 * owner decision 7).
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { isStageKey, type StageKey } from "../promotionEngine";
import { forgetTier } from "../playbookToday/tier";

/** The stage of a trader nobody assigned one to (owner decision 2026-10-20: «Джун»). */
export const DEFAULT_STAGE: StageKey = "junior";

export type StageSource = "path" | "enrollment" | "scaling" | "default";
export type StageInfo = { stage: StageKey | null; since: string | null; source: StageSource | null; cohortId: number | null };

/** The role that gets the default stage. */
export function isTraderRole(role: unknown): boolean {
  return typeof role === "string" && role.trim().toLowerCase() === "trader";
}

/** Pure precedence: own → enrolment → risk tier → DEFAULT_STAGE for a trader (no role / staff → null). */
export function pickStage(own: unknown, enrollment: unknown, tier: unknown, role?: unknown): StageKey | null {
  return resolveStage({ own, enrollment, tier, role }).stage;
}

/** Same as pickStage, with the source the stage came from. */
export function resolveStage(src: { own?: unknown; enrollment?: unknown; tier?: unknown; role?: unknown }): { stage: StageKey | null; source: StageSource | null } {
  if (isStageKey(src.own)) return { stage: src.own, source: "path" };
  if (isStageKey(src.enrollment)) return { stage: src.enrollment, source: "enrollment" };
  if (isStageKey(src.tier)) return { stage: src.tier, source: "scaling" };
  if (isTraderRole(src.role)) return { stage: DEFAULT_STAGE, source: "default" };
  return { stage: null, source: null };
}

type Row = Record<string, unknown>;
/** A source table may not exist yet on a fresh DB (created by its route on first use) — that source is simply empty. */
async function optional(label: string, sql: string, params: unknown[]): Promise<Row[]> {
  try {
    return (await pool.query(sql, params)).rows as Row[];
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "42P01" && code !== "42703") logger.warn({ err, label }, "stage: source read failed");
    return [];
  }
}

/**
 * Stage of each member (`users` = these names, null = everyone with a stage source plus every active trader).
 * Members with no stage at all (staff without a stage) are absent from the map.
 */
export async function loadStageInfo(users: readonly string[] | null): Promise<Map<string, StageInfo>> {
  const out = new Map<string, StageInfo>();
  if (users && users.length === 0) return out;
  const names = users ? [...users] : null;
  const where = (col: string, first: boolean) => (names ? `${first ? "WHERE" : "AND"} ${col} = ANY($1::text[])` : "");
  const params = names ? [names] : [];
  const [own, enr, lim, traders] = await Promise.all([
    optional("academy_trader_stage", `SELECT user_name, stage, since FROM academy_trader_stage ${where("user_name", true)}`, params),
    optional(
      "academy_enrollments",
      `SELECT DISTINCT ON (user_name) user_name, stage, joined_on::text AS joined_on, cohort_id
         FROM academy_enrollments
        WHERE archived_at IS NULL AND COALESCE(status, 'active') IN ('active','paused') ${where("user_name", false)}
        ORDER BY user_name, joined_on DESC NULLS LAST, id DESC`,
      params,
    ),
    optional("trader_risk_limits", `SELECT trader, tier FROM trader_risk_limits ${where("trader", true)}`, params),
    optional("users", `SELECT name, role FROM users WHERE active = true AND COALESCE(banned, false) = false AND role = 'trader' ${where("name", false)}`, params),
  ]);
  const ownBy = new Map(own.map((r) => [String(r.user_name), r]));
  const enrBy = new Map(enr.map((r) => [String(r.user_name), r]));
  const tierBy = new Map(lim.map((r) => [String(r.trader), r.tier]));
  const traderSet = new Set(traders.map((r) => String(r.name)));
  const all = new Set<string>([...ownBy.keys(), ...enrBy.keys(), ...tierBy.keys(), ...traderSet]);
  for (const name of all) {
    const o = ownBy.get(name);
    const e = enrBy.get(name);
    const { stage, source } = resolveStage({ own: o?.stage, enrollment: e?.stage, tier: tierBy.get(name), role: traderSet.has(name) ? "trader" : null });
    if (!stage) continue;
    const since = source === "path" ? (o?.since == null ? null : String(o.since)) : source === "enrollment" && e?.joined_on ? String(e.joined_on).slice(0, 10) : null;
    out.set(name, { stage, since, source, cohortId: e?.cohort_id == null ? null : Number(e.cohort_id) });
  }
  return out;
}

/** One member's stage (null: staff / unknown member without any stage source). */
export async function stageOf(user: string): Promise<StageKey | null> {
  return (await loadStageInfo([user])).get(user)?.stage ?? null;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Promotion / demotion along the path → the risk tier follows: trader_risk_limits.tier = the stage's scaling tier
 * (academy_stages.scaling_tier, default = the stage key). Run it on the transaction client of the stage change so
 * both land together (routes/academy-path.ts setStage, before COMMIT). A member without a limits row gets one with the
 * tier only (no limits — «no_limits» stays visible).
 */
export async function syncRiskTier(client: Queryable, user: string, stage: StageKey, actor: string): Promise<void> {
  await client.query(
    `INSERT INTO trader_risk_limits AS l (trader, tier, updated_by, updated_at)
     VALUES ($1, COALESCE((SELECT NULLIF(TRIM(s.scaling_tier), '') FROM academy_stages s WHERE s.key = $2), $2), $3, NOW())
     ON CONFLICT (trader) DO UPDATE SET tier = EXCLUDED.tier, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      WHERE l.tier IS DISTINCT FROM EXCLUDED.tier`,
    [user, stage, actor],
  );
  forgetTier(user); // the shell menu / playbook locks read the new tier on the next request
}
