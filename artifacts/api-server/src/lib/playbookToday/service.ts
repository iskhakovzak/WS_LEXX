/**
 * Playbook «Сегодня» — loads one trader's rows in parallel (setups, own edge per setup, today's plan, risk limit, stage,
 * untagged count) and hands them to the pure builder (./build.ts). Cached per trader + day for CACHE_MS; a picks save
 * refreshes the cached answer at once.
 *
 * Which day: today (New York) on a trading day, else the next open day (weekend / full-day market holiday) — the trader
 * prepares on Sunday for Monday, and the picks land in Monday's plan.
 */
import { pool } from "@workspace/db";
import { pickStage } from "../discussionAudience";
import { forgetQuests } from "../quests/cache";
import { setting } from "../settings/registry";
import { addDays, isWeekend, nyDate, nyMinutes } from "../tradingDate";
import { closedSql, closeDateSql, decidedSql, resultSql, signedRSql } from "../tradeMath";
import { spaceSql } from "../playbookAccess";
import { buildToday, type EdgeRow, type SetupRow } from "./build";
import { tagDays, untaggedOf, weekdaysBack } from "./untagged";
import type { PlaybookToday } from "./types";

const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; value: PlaybookToday }>();
/** Untagged own trades are counted over the last N trading days. */
export const UNTAGGED_DAYS = 5;

const none = <T>() => ({ rows: [] as T[] });

let closedCache: { today: string; days: Set<string> } | null = null;
async function closedDays(today: string): Promise<Set<string>> {
  if (closedCache?.today === today) return closedCache.days;
  const { rows } = await pool
    .query<{ d: string }>(
      `SELECT date::text AS d FROM holiday_calendar WHERE type = 'holiday' AND description ILIKE 'market closed%' AND date::text >= $1 AND date::text <= $2`,
      [today, addDays(today, 14)],
    )
    .catch(() => none<{ d: string }>());
  closedCache = { today, days: new Set(rows.map((r) => String(r.d).slice(0, 10))) };
  return closedCache.days;
}

/** The day the picks are for: today when the market opens today, else the next open day. */
export async function picksDay(now = new Date()): Promise<string> {
  const today = nyDate(now);
  const closed = await closedDays(today);
  let d = today;
  for (let i = 0; i < 15 && (isWeekend(d) || closed.has(d)); i++) d = addDays(d, 1);
  return d;
}

const SETUP_COLS = `p.id, p.name, p.folder, p.time_of_day AS "timeOfDay", p.entry_text AS "entryText", p.stop_text AS "stopText",
  p.targets_text AS "targetsText", p.invalidation_text AS "invalidationText", p.notes, p.checklist_items AS "checklistItems",
  p.checklist, p.min_tier AS "minTier", p.schema_key AS "schemaKey", ${spaceSql("p")} AS space`;

/** Office setups and the trader's own personal ones (live). */
async function loadSetups(trader: string): Promise<SetupRow[]> {
  const { rows } = await pool.query<SetupRow>(
    `SELECT ${SETUP_COLS} FROM playbook p
      WHERE p.deleted_at IS NULL AND (${spaceSql("p")} = 'office' OR (${spaceSql("p")} = 'personal' AND p.trader = $1))`,
    [trader],
  );
  return rows;
}

/** Own closed trades per live setup (the builder keeps the setups it lists). */
async function loadEdges(trader: string): Promise<EdgeRow[]> {
  const r = signedRSql("t");
  const { rows } = await pool.query<{ id: number; trades: number; wins: number; decided: number; rtrades: number; sumr: number; last_on: string | null; graded_a: number }>(
    `SELECT t.playbook_id AS id, COUNT(*)::int AS trades,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'win')::int AS wins,
            COUNT(*) FILTER (WHERE ${decidedSql("t")})::int AS decided,
            COUNT(${r})::int AS rtrades, COALESCE(SUM(${r}), 0)::float8 AS sumr,
            MAX(LEFT(${closeDateSql("t")}, 10)) AS last_on,
            COUNT(*) FILTER (WHERE t.confidence_grade IN ('A', 'A+'))::int AS graded_a
       FROM trades t JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closedSql("t")}
      GROUP BY 1`,
    [trader],
  );
  return rows.map((x) => ({
    setupId: Number(x.id), trades: Number(x.trades), wins: Number(x.wins), decided: Number(x.decided),
    rTrades: Number(x.rtrades), sumR: Number(x.sumr), lastOn: x.last_on, gradedA: Number(x.graded_a),
  }));
}

/** Role, academy stage (own → enrollment → scaling tier: routes/academy-path loadStageInfo order) and the risk limit. */
async function loadPerson(trader: string): Promise<{ staff: boolean; tier: string | null; maxRisk: number | null }> {
  const [user, own, enr, lim] = await Promise.all([
    pool.query<{ role: string }>(`SELECT role FROM users WHERE name = $1 LIMIT 1`, [trader]).catch(() => none<{ role: string }>()),
    pool.query<{ stage: string }>(`SELECT stage FROM academy_trader_stage WHERE user_name = $1`, [trader]).catch(() => none<{ stage: string }>()),
    pool.query<{ stage: string }>(
      `SELECT stage FROM academy_enrollments WHERE user_name = $1 AND archived_at IS NULL AND COALESCE(status, 'active') IN ('active', 'paused')
        ORDER BY joined_on DESC NULLS LAST, id DESC LIMIT 1`,
      [trader],
    ).catch(() => none<{ stage: string }>()),
    pool.query<{ tier: string | null; max_risk: number | null }>(
      `SELECT tier, max_risk_per_trade::float8 AS max_risk FROM trader_risk_limits WHERE trader = $1`,
      [trader],
    ).catch(() => none<{ tier: string | null; max_risk: number | null }>()),
  ]);
  const role = user.rows[0]?.role ?? null;
  const maxRisk = lim.rows[0]?.max_risk;
  return {
    staff: role === "curator" || role === "admin",
    tier: pickStage(own.rows[0]?.stage, enr.rows[0]?.stage, lim.rows[0]?.tier),
    maxRisk: maxRisk != null && Number(maxRisk) > 0 ? Number(maxRisk) : null,
  };
}

async function loadPlanDoc(trader: string, date: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query<{ doc: Record<string, unknown> | null }>(
    `SELECT doc FROM trader_plans WHERE trader = $1 AND date = $2 AND deleted_at IS NULL LIMIT 1`,
    [trader, date],
  ).catch(() => none<{ doc: Record<string, unknown> | null }>());
  return rows[0]?.doc ?? null;
}

/** PlaybookToday for `trader` (cached for CACHE_MS unless `fresh`). */
export async function playbookToday(trader: string, o: { fresh?: boolean; now?: Date } = {}): Promise<PlaybookToday> {
  const now = o.now ?? new Date();
  const date = await picksDay(now);
  const key = `${trader}|${date}`;
  const hit = cache.get(key);
  if (!o.fresh && hit && Date.now() - hit.at < CACHE_MS) return { ...hit.value, nyMinutes: nyMinutes(now) };
  const today = nyDate(now);
  const [setups, edges, person, doc, days] = await Promise.all([
    loadSetups(trader),
    loadEdges(trader),
    loadPerson(trader),
    loadPlanDoc(trader, date),
    tagDays(trader, weekdaysBack(today, UNTAGGED_DAYS), today),
  ]);
  const planRisk = Number(doc?.riskPerTradeUsd);
  const value = buildToday({
    date, nyMinutes: nyMinutes(now), setups, edges,
    viewer: { staff: person.staff, tier: person.tier },
    gateCount: setting("quests.setupUnlockGradeA"),
    planSetups: doc?.setups,
    oneR: Number.isFinite(planRisk) && planRisk > 0 ? { usd: planRisk, source: "plan" } : person.maxRisk != null ? { usd: person.maxRisk, source: "limits" } : null,
    untagged: untaggedOf(days),
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return value;
}

/** After a picks save: the cached answer carries the new picks (no reload). */
export function rememberPicks(trader: string, date: string, picks: number[]): void {
  const hit = cache.get(`${trader}|${date}`);
  if (hit) hit.value = { ...hit.value, picks };
}

/** Drop the trader's cached answers (a link / tier change elsewhere). */
export function forgetToday(trader: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${trader}|`)) cache.delete(k);
}

/** A trade got (un)tagged with a setup: its trader's «Сегодня» counter and the tag_yesterday quest re-read at once. */
export async function tradeTagged(tradeId: number): Promise<void> {
  const { rows } = await pool.query<{ trader: string | null }>(`SELECT trader FROM trades WHERE id = $1`, [tradeId]).catch(() => none<{ trader: string | null }>());
  const trader = rows[0]?.trader;
  if (!trader) return;
  forgetToday(trader);
  forgetQuests(trader);
}
