import { z } from "zod";
import { pool } from "@workspace/db";
import {
  PLAN_MEDIA_MAX_PER_PLAN,
  PLAN_MEDIA_MAX_PER_TICKER,
  allowedMediaIds,
  collectPlanMediaIds,
  filterPlanMedia,
  parseTradingViewUrl,
} from "./planMedia";
import { isMistakeId } from "./daily/engine";
import { PlanPicksFields } from "./playbookToday/plan";

/**
 * «План дня» storage pieces for routes/gameplan.ts: idempotent DDL (game_plans, game_plan_reads, trader_plans,
 * plan_templates), zod bodies, row serialisation and media sanitising. Pure helpers + SQL; no request handling.
 */

let ensured: Promise<void> | null = null;
export function ensureGamePlanTables(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS game_plans (
           id SERIAL PRIMARY KEY,
           date TEXT NOT NULL UNIQUE,
           author TEXT NOT NULL,
           updated_by TEXT,
           market_view TEXT NOT NULL DEFAULT '',
           bias TEXT NOT NULL DEFAULT 'neutral',
           risk_mode TEXT NOT NULL DEFAULT 'normal',
           key_levels JSONB NOT NULL DEFAULT '{}'::jsonb,
           in_play JSONB NOT NULL DEFAULT '[]'::jsonb,
           risk_notes TEXT NOT NULL DEFAULT '',
           macro JSONB NOT NULL DEFAULT '[]'::jsonb,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           deleted_at TIMESTAMPTZ
         );
         ALTER TABLE game_plans ADD COLUMN IF NOT EXISTS focus TEXT NOT NULL DEFAULT '';
         ALTER TABLE game_plans ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;
         ALTER TABLE game_plans ADD COLUMN IF NOT EXISTS tv_links JSONB NOT NULL DEFAULT '[]'::jsonb;
         ALTER TABLE game_plans ADD COLUMN IF NOT EXISTS max_loss_usd NUMERIC;
         ALTER TABLE game_plans ADD COLUMN IF NOT EXISTS max_trades INTEGER;
         CREATE TABLE IF NOT EXISTS game_plan_reads (
           plan_id INTEGER NOT NULL REFERENCES game_plans(id) ON DELETE CASCADE,
           trader TEXT NOT NULL,
           read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (plan_id, trader)
         );
         CREATE TABLE IF NOT EXISTS trader_plans (
           id SERIAL PRIMARY KEY,
           trader TEXT NOT NULL,
           date TEXT NOT NULL,
           doc JSONB NOT NULL DEFAULT '{}'::jsonb,
           status TEXT NOT NULL DEFAULT 'draft',
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           deleted_at TIMESTAMPTZ,
           UNIQUE (trader, date)
         );
         CREATE INDEX IF NOT EXISTS trader_plans_date_idx ON trader_plans (date);
         CREATE TABLE IF NOT EXISTS plan_templates (
           id SERIAL PRIMARY KEY,
           author TEXT NOT NULL,
           kind TEXT NOT NULL DEFAULT 'personal',
           name TEXT NOT NULL,
           doc JSONB NOT NULL DEFAULT '{}'::jsonb,
           shared BOOLEAN NOT NULL DEFAULT false,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           deleted_at TIMESTAMPTZ
         );`,
      )
      .then(() => undefined)
      .catch((err) => {
        ensured = null;
        throw err;
      });
  }
  return ensured;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
}

export function parsePlanId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── Validation ────────────────────────────────────────────────────────────────
const price = z.number().finite().nonnegative().lt(1e7);
const levelList = z.array(price).max(12);
const LevelSet = z.object({
  support: levelList.default([]),
  resistance: levelList.default([]),
  note: z.string().trim().max(500).default(""),
});
const MediaRef = z.object({
  id: z.number().int().positive(),
  caption: z.string().trim().max(300).default(""),
});
const TvLink = z
  .string()
  .trim()
  .max(600)
  .refine((s) => s === "" || parseTradingViewUrl(s) !== null, "https link to tradingview.com required")
  .transform((s) => (s === "" ? "" : parseTradingViewUrl(s)!.url));
const text = (max: number) => z.string().trim().max(max).default("");
const InPlayItem = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-^=/]+$/, "invalid ticker")
    .transform((s) => s.toUpperCase()),
  catalyst: text(500),
  bias: z.enum(["bull", "bear", "neutral"]).default("neutral"),
  grade: z.enum(["A+", "A", "B"]).nullable().default(null),
  levels: z.object({ support: levelList.default([]), resistance: levelList.default([]) }).default({ support: [], resistance: [] }),
  plan: text(3000),
  horizon: z.enum(["intraday", "overnight", "swing"]).default("intraday"),
  risk_note: text(1000),
  scenarioA: text(1500),
  scenarioB: text(1500),
  trigger: text(1000),
  invalidation: text(1000),
  tvLink: TvLink.default(""),
  media: z.array(MediaRef).max(PLAN_MEDIA_MAX_PER_TICKER).default([]),
});
const MacroItem = z.object({
  time: z
    .string()
    .trim()
    .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM")
    .default(""),
  title: z.string().trim().min(1).max(200),
  impact: z.enum(["high", "medium", "low"]).default("medium"),
});
export const PlanBody = z.object({
  marketView: text(6000),
  bias: z.enum(["bull", "bear", "neutral", "mixed"]).default("neutral"),
  riskMode: z.enum(["normal", "reduced", "aggressive"]).default("normal"),
  keyLevels: z
    .object({ SPY: LevelSet.optional(), QQQ: LevelSet.optional() })
    .default({}),
  inPlay: z.array(InPlayItem).max(30).default([]),
  riskNotes: text(6000),
  macro: z.array(MacroItem).max(30).default([]),
  focus: text(1000),
  maxLossUsd: z.number().finite().nonnegative().lt(1e7).nullable().default(null),
  maxTrades: z.number().int().min(0).max(500).nullable().default(null),
  media: z.array(MediaRef).max(PLAN_MEDIA_MAX_PER_PLAN).default([]),
  tvLinks: z
    .array(TvLink)
    .max(8)
    .default([])
    .transform((a) => [...new Set(a.filter(Boolean))]),
});
export type PlanDoc = z.infer<typeof PlanBody>;
export const TraderPlanBody = PlanBody.extend({
  status: z.enum(["draft", "ready"]).default("draft"),
  // Rule of the day (daily loop MistakeId, lib/daily/engine isMistakeId). Absent = never chosen (the web prefills the
  // focus), null = «no rule»; read back by lib/daily (own contract verdict).
  ownRule: z.string().trim().max(60).refine(isMistakeId, "unknown mistake").nullable().optional(),
  focusRules: z.array(z.enum(["a", "b", "c", "d", "e"])).max(5).optional().transform((a) => (a ? [...new Set(a)] : a)), // UMID-13: preset keys, text per reader
  ...PlanPicksFields, // playbook «Сегодня» picks + 1R (absent = keep the stored value; a picks-only row is not a written plan yet)
});

export const TemplateBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["desk", "personal"]).default("personal"),
  shared: z.boolean().default(false),
  doc: PlanBody,
});

// ── Serialisation ─────────────────────────────────────────────────────────────
export const PLAN_COLS = `p.id, p.date, p.author, p.updated_by AS "updatedBy", p.market_view AS "marketView", p.bias,
  p.risk_mode AS "riskMode", p.key_levels AS "keyLevels", p.in_play AS "inPlay", p.risk_notes AS "riskNotes",
  p.macro, p.focus, p.media, p.tv_links AS "tvLinks", p.max_loss_usd::float8 AS "maxLossUsd", p.max_trades AS "maxTrades",
  p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  (SELECT COUNT(*)::int FROM game_plan_reads r WHERE r.plan_id = p.id) AS "readCount"`;

/** Rows store in-play items with snake_case risk_note (schema contract); API exposes the same keys. */
export type PlanRow = Record<string, unknown> & { id: number; date: string };

export type TraderPlanRow = { id: number; trader: string; date: string; doc: Partial<PlanDoc>; status: string; created_at: Date; updated_at: Date };
export function serializeTraderPlan(r: TraderPlanRow) {
  return {
    id: r.id,
    trader: r.trader,
    date: r.date,
    status: r.status === "ready" ? "ready" : "draft",
    doc: r.doc ?? {},
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Drop media refs the caller may not attach (unknown, deleted, other context/owner). */
export async function sanitizeMedia(doc: PlanDoc, context: "desk" | "personal", owner: string | null): Promise<PlanDoc> {
  const allowed = await allowedMediaIds(collectPlanMediaIds(doc), context, owner);
  return filterPlanMedia(doc, allowed);
}
