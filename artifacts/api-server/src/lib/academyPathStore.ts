import { pool } from "@workspace/db";
import { logger } from "./logger";
import { num } from "./tradeMath";
import { DEFAULT_TIERS, type Op, type Tier } from "./scalingEngine";
import {
  DEFAULT_CRITERIA, DEFAULT_STAGES, PROMO_METRIC_KEYS, isStageKey, sortStages,
  type Criterion, type PromoMetricKey, type StageKey, type StageMeta,
} from "./promotionEngine";

/**
 * Storage of «Путь трейдера» (routes/academy-path.ts): the default seed (tables: migrations), the ladder config
 * loaders (stages, criteria, scaling tiers) and per-user stage resolution. SQL only; no request handling.
 */

// ─── default seed ─────────────────────────────────────────────────────────────────

let ensured: Promise<void> | null = null;
/** Default stages and criteria on an empty ladder (tables: migrations 0234). Once per process; retried after a failure. */
export function ensureAcademyPathSeed(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const { rows: sc } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM academy_stages`);
      if (Number(sc[0]?.n ?? 0) === 0) {
        for (const s of DEFAULT_STAGES) {
          await pool.query(
            `INSERT INTO academy_stages (key, name, sort_order, description, scaling_tier, updated_by) VALUES ($1,$2,$3,$4,$5,'system') ON CONFLICT (key) DO NOTHING`,
            [s.key, s.name, s.order, s.description, s.scalingTier],
          );
        }
        logger.info("academy-path: seeded default stages");
      }
      // The former first stage («trainee») is not on the ladder any more (Волна 1 п. 1.21): its row stays in the table
      // (migration 0229 archives its criteria) and loadStages() only reads the keys of DEFAULT_STAGES.
      const { rows: cc } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM academy_stage_criteria`);
      if (Number(cc[0]?.n ?? 0) === 0) {
        let i = 0;
        for (const c of DEFAULT_CRITERIA) {
          await pool.query(
            `INSERT INTO academy_stage_criteria (from_stage, metric, op, value, window_days, label, enabled, sort_order, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system')`,
            [c.fromStage, c.metric, c.op, c.value, c.windowDays, c.label, c.enabled, i++],
          );
        }
        logger.info("academy-path: seeded default criteria");
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

// ─── config loaders ─────────────────────────────────────────────────────────

export async function loadStages(): Promise<StageMeta[]> {
  const { rows } = await pool.query(`SELECT * FROM academy_stages`);
  const byKey = new Map(rows.map((r: any) => [String(r.key), r]));
  return sortStages(DEFAULT_STAGES.map((d) => {
    const r: any = byKey.get(d.key);
    return r ? { key: d.key, name: String(r.name), order: Number(r.sort_order) || d.order, description: r.description ?? d.description, scalingTier: r.scaling_tier ?? null } : d;
  }));
}

export function rowToCriterion(r: any): Criterion {
  return {
    id: Number(r.id), fromStage: r.from_stage as StageKey, metric: r.metric as PromoMetricKey, op: r.op as Op, value: Number(r.value),
    windowDays: r.window_days == null ? null : Number(r.window_days), label: r.label ?? null, enabled: r.enabled !== false,
  };
}
export async function loadCriteria(): Promise<Criterion[]> {
  const { rows } = await pool.query(`SELECT * FROM academy_stage_criteria WHERE archived_at IS NULL ORDER BY sort_order, id`);
  return rows.map(rowToCriterion).filter((c) => isStageKey(c.fromStage) && PROMO_METRIC_KEYS.includes(c.metric));
}

/** Scaling tiers (read-only reuse of the scaling plan's table; defaults when it does not exist yet). */
export async function loadTiers(): Promise<Tier[]> {
  try {
    const { rows } = await pool.query(`SELECT * FROM scaling_tiers WHERE active = TRUE`);
    if (!rows.length) return DEFAULT_TIERS;
    return rows.map((r: any) => ({
      key: String(r.key), name: String(r.name), order: Number(r.sort_order) || 0,
      accountSize: num(r.account_size), dailyLossLimit: num(r.daily_loss_limit), weeklyLossLimit: num(r.weekly_loss_limit), maxDrawdown: num(r.max_drawdown),
      maxRiskPerTrade: num(r.max_risk_per_trade), maxPositionUsd: num(r.max_position_usd), maxOvernightExposure: num(r.max_overnight_exposure),
      maxOpenPositions: r.max_open_positions == null ? null : Number(r.max_open_positions), allowOvernight: r.allow_overnight === true, allowSwing: r.allow_swing === true,
      description: r.description ?? null,
    }));
  } catch {
    return DEFAULT_TIERS;
  }
}

export async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: string | null }>(`SELECT to_regclass($1)::text AS ok`, [name]);
  return !!rows[0]?.ok;
}

// ─── stage resolution ───────────────────────────────────────────────────────

/**
 * Stage of each user — the one resolution of lib/people/stage.ts (own table set by approvals → enrolment → scaling
 * tier → DEFAULT_STAGE («Джун») for a trader without a stage, source "default"). Kept here for the existing imports.
 */
export { loadStageInfo, type StageInfo } from "./people/stage";
