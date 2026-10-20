/**
 * Limits by ladder level (Волна 1 п. 1.1 / 1.21, owner decision 7):
 *  - a trader who gets a stage and has NO limits yet receives the ladder template of that stage's tier (the same seed
 *    the leaderboard falls back to — lib/scalingSeed DEFAULT_TIERS — or the curator-edited scaling_tiers row). Limits a
 *    curator already set are never overwritten;
 *  - buying power (trader_risk_limits.buying_power) is set per trader: a junior 25 000 – 800 000 $, above junior no cap.
 */
import type { Tier } from "../scalingEngine";
import type { StageKey } from "../promotionEngine";

export const BP_MIN = 25_000;
/** Upper bound for a junior only; Трейдер / Сеньор have no cap. */
export const BP_MAX_JUNIOR = 800_000;

/** null = the value is fine; otherwise the bounds it broke (max null = no upper cap). */
export function buyingPowerProblem(bp: number | null | undefined, stage: StageKey | null): { min: number; max: number | null } | null {
  if (bp == null) return null; // not set — allowed (the curator fills it later)
  const max = stage === "junior" || stage == null ? BP_MAX_JUNIOR : null;
  if (bp < BP_MIN || (max != null && bp > max)) return { min: BP_MIN, max };
  return null;
}

/** Limit columns of trader_risk_limits a template fills (buying power is per trader, never from a template). */
export type TemplateLimits = {
  accountSize: number | null; dailyLossLimit: number | null; weeklyLossLimit: number | null; maxDrawdown: number | null;
  maxRiskPerTrade: number | null; maxPositionUsd: number | null; maxOvernightExposure: number | null;
  maxOpenPositions: number | null; allowOvernight: boolean; allowSwing: boolean;
};

/** The template of `tierKey` from the ladder tiers (null when the tier is unknown). */
export function templateLimitsFor(tiers: readonly Tier[], tierKey: string | null | undefined): TemplateLimits | null {
  const t = tierKey ? tiers.find((x) => x.key === tierKey) : undefined;
  if (!t) return null;
  return {
    accountSize: t.accountSize, dailyLossLimit: t.dailyLossLimit, weeklyLossLimit: t.weeklyLossLimit, maxDrawdown: t.maxDrawdown,
    maxRiskPerTrade: t.maxRiskPerTrade, maxPositionUsd: t.maxPositionUsd, maxOvernightExposure: t.maxOvernightExposure,
    maxOpenPositions: t.maxOpenPositions, allowOvernight: t.allowOvernight, allowSwing: t.allowSwing,
  };
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** A limits row with every limit empty (only the tier, as syncRiskTier writes it) counts as «no limits». */
const NO_LIMITS_SQL = `account_size IS NULL AND daily_loss_limit IS NULL AND weekly_loss_limit IS NULL AND max_drawdown IS NULL
  AND max_risk_per_trade IS NULL AND max_position_usd IS NULL AND max_overnight_exposure IS NULL AND max_open_positions IS NULL`;

/**
 * After a stage change (run on the transaction client, after syncRiskTier): fill the template of the trader's tier when
 * the trader has no limits at all; a change-log row records it. Returns true when limits were written.
 */
export async function applyStageDefaultLimits(client: Queryable, user: string, stage: StageKey, actor: string, tiers: readonly Tier[], reason: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT tier FROM trader_risk_limits WHERE trader = $1`, [user]);
  const tpl = templateLimitsFor(tiers, rows[0]?.tier ?? stage);
  if (!tpl) return false;
  const upd = await client.query(
    `UPDATE trader_risk_limits SET account_size = $2, daily_loss_limit = $3, weekly_loss_limit = $4, max_drawdown = $5,
            max_risk_per_trade = $6, max_position_usd = $7, max_overnight_exposure = $8, max_open_positions = $9,
            allow_overnight = $10, allow_swing = $11, updated_by = $12, updated_at = NOW()
      WHERE trader = $1 AND ${NO_LIMITS_SQL}
      RETURNING trader`,
    [user, tpl.accountSize, tpl.dailyLossLimit, tpl.weeklyLossLimit, tpl.maxDrawdown, tpl.maxRiskPerTrade, tpl.maxPositionUsd,
      tpl.maxOvernightExposure, tpl.maxOpenPositions, tpl.allowOvernight, tpl.allowSwing, actor],
  );
  if (!upd.rows.length) return false;
  await client.query(
    `INSERT INTO trader_risk_limit_events (trader, before, after, reason, changed_by) VALUES ($1, NULL, $2, $3, $4)`,
    [user, JSON.stringify({ ...tpl, tier: rows[0]?.tier ?? stage }), reason, actor],
  );
  return true;
}
