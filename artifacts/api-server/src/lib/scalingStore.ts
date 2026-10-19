/**
 * «План масштабирования» storage: tables (additive, created lazily on the first request — never at import time, so
 * tests and tools without a DB stay quiet), default seed, row mappers and loaders. Used by routes/scaling.ts.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { DEFAULT_RULES, DEFAULT_TIERS, sortTiers, type MetricKey, type Op, type Rule, type RuleKind, type Tier, type Unit } from "./scalingEngine";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// ─── tables ─────────────────────────────────────────────────────────────────

let ensured: Promise<void> | null = null;
export function ensureTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scaling_tiers (
          key TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          account_size NUMERIC(14,2),
          daily_loss_limit NUMERIC(12,2),
          weekly_loss_limit NUMERIC(12,2),
          max_drawdown NUMERIC(12,2),
          max_risk_per_trade NUMERIC(12,2),
          max_position_usd NUMERIC(14,2),
          max_overnight_exposure NUMERIC(14,2),
          max_open_positions INTEGER,
          allow_overnight BOOLEAN NOT NULL DEFAULT FALSE,
          allow_swing BOOLEAN NOT NULL DEFAULT FALSE,
          description TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS scaling_rules (
          id SERIAL PRIMARY KEY,
          kind TEXT NOT NULL,
          metric TEXT NOT NULL,
          op TEXT NOT NULL,
          value NUMERIC(14,4) NOT NULL,
          unit TEXT NOT NULL DEFAULT 'abs',
          window_days INTEGER NOT NULL DEFAULT 20,
          tier_key TEXT,
          label TEXT,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS scaling_proposals (
          id SERIAL PRIMARY KEY,
          trader TEXT NOT NULL,
          action TEXT NOT NULL,
          from_tier TEXT,
          to_tier TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          source TEXT NOT NULL DEFAULT 'auto',
          reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
          snapshot JSONB,
          comment TEXT,
          created_by TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          decided_by TEXT,
          decided_at TIMESTAMPTZ,
          decision_comment TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS scaling_proposals_pending_uniq ON scaling_proposals(trader) WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS scaling_proposals_trader_idx ON scaling_proposals(trader, created_at DESC);
        CREATE TABLE IF NOT EXISTS scaling_history (
          id SERIAL PRIMARY KEY,
          trader TEXT NOT NULL,
          action TEXT NOT NULL,
          from_tier TEXT,
          to_tier TEXT NOT NULL,
          proposal_id INTEGER,
          actor TEXT NOT NULL,
          comment TEXT,
          limits JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS scaling_history_trader_idx ON scaling_history(trader, created_at DESC);
      `);
      const { rows: tc } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM scaling_tiers`);
      if (Number(tc[0]?.n ?? 0) === 0) {
        for (const t of DEFAULT_TIERS) await upsertTier(pool, t, "system");
        logger.info("scaling: seeded default tiers");
      }
      const { rows: rc } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM scaling_rules`);
      if (Number(rc[0]?.n ?? 0) === 0) {
        let i = 0;
        for (const r of DEFAULT_RULES) await insertRule(pool, r, i++, "system");
        logger.info("scaling: seeded default rules");
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export async function upsertTier(q: Queryable, t: Tier, actor: string): Promise<void> {
  await q.query(
    `INSERT INTO scaling_tiers (key, name, sort_order, account_size, daily_loss_limit, weekly_loss_limit, max_drawdown, max_risk_per_trade,
        max_position_usd, max_overnight_exposure, max_open_positions, allow_overnight, allow_swing, description, active, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,NOW())
     ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, account_size = EXCLUDED.account_size,
        daily_loss_limit = EXCLUDED.daily_loss_limit, weekly_loss_limit = EXCLUDED.weekly_loss_limit, max_drawdown = EXCLUDED.max_drawdown,
        max_risk_per_trade = EXCLUDED.max_risk_per_trade, max_position_usd = EXCLUDED.max_position_usd,
        max_overnight_exposure = EXCLUDED.max_overnight_exposure, max_open_positions = EXCLUDED.max_open_positions,
        allow_overnight = EXCLUDED.allow_overnight, allow_swing = EXCLUDED.allow_swing, description = EXCLUDED.description,
        active = TRUE, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [t.key, t.name, t.order, t.accountSize, t.dailyLossLimit, t.weeklyLossLimit, t.maxDrawdown, t.maxRiskPerTrade, t.maxPositionUsd,
      t.maxOvernightExposure, t.maxOpenPositions, t.allowOvernight, t.allowSwing, t.description ?? null, actor],
  );
}

export async function insertRule(q: Queryable, r: Omit<Rule, "id">, order: number, actor: string): Promise<number> {
  const { rows } = await q.query(
    `INSERT INTO scaling_rules (kind, metric, op, value, unit, window_days, tier_key, label, enabled, sort_order, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING id`,
    [r.kind, r.metric, r.op, r.value, r.unit, r.windowDays, r.tierKey, r.label, r.enabled, order, actor],
  );
  return Number(rows[0].id);
}

export function rowToTier(r: any): Tier {
  return {
    key: String(r.key),
    name: String(r.name),
    order: Number(r.sort_order) || 0,
    accountSize: num(r.account_size),
    dailyLossLimit: num(r.daily_loss_limit),
    weeklyLossLimit: num(r.weekly_loss_limit),
    maxDrawdown: num(r.max_drawdown),
    maxRiskPerTrade: num(r.max_risk_per_trade),
    maxPositionUsd: num(r.max_position_usd),
    maxOvernightExposure: num(r.max_overnight_exposure),
    maxOpenPositions: r.max_open_positions == null ? null : Number(r.max_open_positions),
    allowOvernight: r.allow_overnight === true,
    allowSwing: r.allow_swing === true,
    description: r.description ?? null,
  };
}

export function rowToRule(r: any): Rule {
  return {
    id: Number(r.id),
    kind: r.kind as RuleKind,
    metric: r.metric as MetricKey,
    op: r.op as Op,
    value: Number(r.value),
    unit: (r.unit ?? "abs") as Unit,
    windowDays: Number(r.window_days) || 20,
    tierKey: r.tier_key ?? null,
    label: r.label ?? null,
    enabled: r.enabled !== false,
  };
}

export async function loadTiers(): Promise<Tier[]> {
  const { rows } = await pool.query(`SELECT * FROM scaling_tiers WHERE active = TRUE ORDER BY sort_order ASC, key ASC`);
  return sortTiers(rows.map(rowToTier));
}
export async function loadRules(): Promise<Rule[]> {
  const { rows } = await pool.query(`SELECT * FROM scaling_rules ORDER BY sort_order ASC, id ASC`);
  return rows.map(rowToRule);
}

export type LimitsRow = {
  trader: string; tier: string | null; accountSize: number | null; dailyLossLimit: number | null; weeklyLossLimit: number | null;
  maxDrawdown: number | null; maxRiskPerTrade: number | null; maxPositionUsd: number | null; maxOvernightExposure: number | null;
  maxOpenPositions: number | null; allowOvernight: boolean; allowSwing: boolean; updatedBy: string | null; updatedAt: string | null;
};
export function rowToLimits(r: any): LimitsRow {
  return {
    trader: String(r.trader),
    tier: r.tier ?? null,
    accountSize: num(r.account_size),
    dailyLossLimit: num(r.daily_loss_limit),
    weeklyLossLimit: num(r.weekly_loss_limit),
    maxDrawdown: num(r.max_drawdown),
    maxRiskPerTrade: num(r.max_risk_per_trade),
    maxPositionUsd: num(r.max_position_usd),
    maxOvernightExposure: num(r.max_overnight_exposure),
    maxOpenPositions: r.max_open_positions == null ? null : Number(r.max_open_positions),
    allowOvernight: r.allow_overnight !== false,
    allowSwing: r.allow_swing !== false,
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}
export async function loadLimits(trader: string | null): Promise<Map<string, LimitsRow>> {
  const { rows } = await pool
    .query(`SELECT * FROM trader_risk_limits WHERE ($1::text IS NULL OR trader = $1)`, [trader])
    .catch(() => ({ rows: [] as any[] }));
  return new Map(rows.map((r: any) => [String(r.trader), rowToLimits(r)]));
}
