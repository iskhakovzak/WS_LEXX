/**
 * Setup mastery — per trader per playbook setup, level 0..4 (names live in the web dictionary; the API sends numbers).
 *
 *   points = trades on the setup graded A / A+ at the evening review (trades.confidence_grade — grades ARE stored, so
 *            R ≥ 0 is not used) + passed «Найди вход» drills / gamification.masteryDrillsPerPoint
 *   level  = thresholds gamification.mastery1..4 (3 / 10 / 25 / 50)
 * Drill counts come from the trainer (lib/trainer/drillStore drillMasteryCounts: passed = first attempts scoring ≥
 * trainer.drillPassScore); a missing table (migration 0211 not applied) counts 0.
 *
 * Setups: the office playbook and the trader's own personal setups (live). masteryOf also stores the levels
 * (setup_mastery) and records a recognition event on a level-up (not on the first computation for a trader — history
 * is stored quietly).
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { nyDate } from "../tradingDate";
import { closedSql } from "../tradeMath";
import { spaceSql } from "../playbookAccess";
import { codeFromName } from "../playbookToday/build";
import { drillMasteryCounts } from "../trainer/drillStore";
import type { SetupMastery } from "./types";

export type DrillCounts = Map<number, { passed: number; attempts: number }>;
type DrillSource = (trader: string) => Promise<DrillCounts>;

let drillSource: DrillSource = drillMasteryCounts;

/** Replaces the drill counts source (tests). */
export function setDrillSource(fn: DrillSource | null): void {
  drillSource = fn ?? drillMasteryCounts;
}

async function drillCounts(trader: string): Promise<DrillCounts> {
  return drillSource(trader).catch((err) => {
    if ((err as { code?: string })?.code !== "42P01") logger.warn({ err: (err as Error)?.message, trader }, "mastery: drill counts failed");
    return new Map();
  });
}

// ─── pure ───────────────────────────────────────────────────────────────────

export function masteryThresholds(): number[] {
  return [setting("gamification.mastery1"), setting("gamification.mastery2"), setting("gamification.mastery3"), setting("gamification.mastery4")]
    .map((v) => Math.max(1, Math.round(v)))
    .sort((a, b) => a - b);
}

export function masteryPoints(gradeA: number, drillsPassed: number, perPoint: number): number {
  return Math.max(0, gradeA) + Math.floor(Math.max(0, drillsPassed) / Math.max(1, perPoint));
}

export function masteryLevel(points: number, thresholds: readonly number[]): { level: number; next: number | null } {
  let level = 0;
  for (let i = 0; i < thresholds.length; i++) if (points >= thresholds[i]!) level = i + 1;
  return { level, next: thresholds[level] ?? null };
}

const codeOrder = (c: string | null) => (c ? c.split(".").reduce((a, x, i) => a + Number(x) / 100 ** i, 0) : 1e9);

export type SetupRef = { id: number; name: string };

export function buildMastery(setups: readonly SetupRef[], gradeA: ReadonlyMap<number, number>, drills: DrillCounts): SetupMastery[] {
  const th = masteryThresholds();
  const per = setting("gamification.masteryDrillsPerPoint");
  return setups
    .map((s) => {
      const a = gradeA.get(s.id) ?? 0;
      const d = drills.get(s.id)?.passed ?? 0;
      const points = masteryPoints(a, d, per);
      const { level, next } = masteryLevel(points, th);
      return { setupId: s.id, code: codeFromName(s.name), name: s.name, level, progress: { current: points, next }, sources: { gradeATrades: a, drills: d } };
    })
    .sort((x, y) => codeOrder(x.code) - codeOrder(y.code) || x.name.localeCompare(y.name));
}

/** Level-ups against the stored levels; none when nothing was stored for the trader yet (quiet first run). */
export function levelUps(now: readonly Pick<SetupMastery, "setupId" | "level">[], stored: ReadonlyMap<number, number>): { setupId: number; from: number; to: number }[] {
  if (stored.size === 0) return [];
  return now.filter((m) => m.level > (stored.get(m.setupId) ?? 0)).map((m) => ({ setupId: m.setupId, from: stored.get(m.setupId) ?? 0, to: m.level }));
}

// ─── DB ─────────────────────────────────────────────────────────────────────

async function loadSetups(trader: string): Promise<SetupRef[]> {
  const { rows } = await pool
    .query<SetupRef>(
      `SELECT p.id, p.name FROM playbook p
        WHERE p.deleted_at IS NULL AND (${spaceSql("p")} = 'office' OR (${spaceSql("p")} = 'personal' AND p.trader = $1))`,
      [trader],
    )
    .catch(() => ({ rows: [] as SetupRef[] }));
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name ?? "") }));
}

async function gradeACounts(trader: string): Promise<Map<number, number>> {
  const { rows } = await pool
    .query<{ id: number; n: number }>(
      `SELECT t.playbook_id AS id, COUNT(*)::int AS n FROM trades t
        WHERE t.deleted_at IS NULL AND t.trader = $1 AND t.playbook_id IS NOT NULL AND t.confidence_grade IN ('A', 'A+') AND ${closedSql("t")}
        GROUP BY 1`,
      [trader],
    )
    .catch(() => ({ rows: [] as { id: number; n: number }[] }));
  return new Map(rows.map((r) => [Number(r.id), Number(r.n)]));
}

/** Every setup's mastery for the trader (no side effects). */
export async function computeMastery(trader: string): Promise<SetupMastery[]> {
  const [setups, gradeA, drills] = await Promise.all([loadSetups(trader), gradeACounts(trader), drillCounts(trader)]);
  return buildMastery(setups, gradeA, drills);
}

/** setupId → level 0..4 (TrainerHome.findEntry.setups[].masteryLevel). */
export async function masteryLevels(trader: string): Promise<Map<number, number>> {
  return new Map((await computeMastery(trader)).map((m) => [m.setupId, m.level]));
}

export type StoredMastery = { setupId: number; level: number; levelOn: string };

export async function storedMastery(traders: readonly string[]): Promise<Map<string, StoredMastery[]>> {
  const out = new Map<string, StoredMastery[]>();
  if (!traders.length) return out;
  const { rows } = await pool
    .query<{ trader: string; setup_id: number; level: number; level_on: string }>(
      `SELECT trader, setup_id, level, level_on FROM setup_mastery WHERE trader = ANY($1::text[])`,
      [traders],
    )
    .catch(() => ({ rows: [] as { trader: string; setup_id: number; level: number; level_on: string }[] }));
  for (const r of rows) {
    const list = out.get(r.trader) ?? out.set(r.trader, []).get(r.trader)!;
    list.push({ setupId: Number(r.setup_id), level: Number(r.level), levelOn: String(r.level_on) });
  }
  return out;
}

/**
 * Computes, stores the changed levels and returns the mastery with the level-ups since the last store (the caller
 * records recognition for them).
 */
export async function syncMastery(trader: string, now = new Date()): Promise<{ mastery: SetupMastery[]; ups: { setupId: number; from: number; to: number }[] }> {
  const mastery = await computeMastery(trader);
  const stored = new Map(((await storedMastery([trader])).get(trader) ?? []).map((s) => [s.setupId, s.level]));
  const ups = levelUps(mastery, stored);
  const today = nyDate(now);
  for (const m of mastery) {
    if (stored.get(m.setupId) === m.level) continue;
    await pool
      .query(
        `INSERT INTO setup_mastery (trader, setup_id, level, level_on) VALUES ($1, $2, $3, $4)
         ON CONFLICT (trader, setup_id) DO UPDATE SET level = EXCLUDED.level, level_on = EXCLUDED.level_on, updated_at = now()
          WHERE setup_mastery.level <> EXCLUDED.level`,
        [trader, m.setupId, m.level, today],
      )
      .catch((err) => logger.warn({ err: (err as Error)?.message, trader }, "mastery: store failed"));
  }
  return { mastery, ups };
}
