/**
 * Achievements v2 — what the new lines read for one trader (read-only; every optional source degrades to «no data»):
 *
 *   trades          the trader's closed trades of the last LOOKBACK_DAYS (lib/whatIfLoader, the edge map's loader):
 *                   process lines (fees per trade, R, re-entry after a loss), leaks (bps per slice), setup mastery
 *                   (+ trades.playbook_id)
 *   violations      rule_violations (by trading day) + trading_errors; risk-desk stops (risk_alert_log breach)
 *   leak guard      leak_guard_events outcome «complied»
 *   discipline      the behaviour engine's daily discipline index (lib/disciplineDays — the one index of the ladder)
 *   edge map        edge_map LEAK rows: first / last flag per slice and the first flag's θ and τ
 *   kudos, top 3    achievement_kudos, recognition_events season_top
 *   path            the academy path readiness of the current stage (routes/academy-path readinessFor)
 *
 * The heavy part (trades → mastery / leaks, discipline days) is memoised per trader and last finished day for
 * HEAVY_MS: it changes only when new trades arrive; kudos and the path are read every evaluation.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import { querySimTrades } from "../whatIfLoader";
import { toEdgeTrade } from "../edgeMapStore";
import { violationDaySql } from "../violationWindow";
import { loadDisciplineDays } from "../disciplineDays";
import type { SimTrade } from "../whatIfTypes";
import type { EdgeTrade } from "../edgeMap";
import type { ProcTrade, ScoreDay } from "./process";
import { setupMastery, type MasteryTrade, type SetupMasteryState } from "./mastery";
import { leakStates, type LeakFlag, type LeakState } from "./leaks";
import type { PathInput } from "./dynamic";

/** Calendar days of trades loaded (≈ 500 trading days: the mastery window + a year of records). */
export const LOOKBACK_DAYS = 730;
const DISCIPLINE_DAYS = 400;
const HEAVY_MS = 30 * 60_000;
/** τ of the setup edge prior (bps of notional): setups differ more between traders than the edge map's slices. */
export const SETUP_TAU_BPS = 10;
export const SETUP_TAU_R = 0.25;
const MASTERY_WINDOW_DAYS = 250;

const none = <T>() => ({ rows: [] as T[] });
const q = <T>(sql: string, params: unknown[]) => pool.query<T & Record<string, unknown>>(sql, params).catch((err) => {
  const code = (err as { code?: string })?.code;
  if (code !== "42P01" && code !== "42703") logger.warn({ err: (err as Error)?.message }, "achievements: load failed");
  return none<T & Record<string, unknown>>();
});

export async function violationDays(trader: string): Promise<string[]> {
  const [v, e] = await Promise.all([
    q<{ d: string }>(`SELECT DISTINCT ${violationDaySql("")} AS d FROM rule_violations WHERE trader = $1 AND archived_at IS NULL`, [trader]),
    q<{ d: string }>(`SELECT DISTINCT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d FROM trading_errors WHERE trader = $1`, [trader]),
  ]);
  return [...new Set([...v.rows, ...e.rows].map((r) => String(r.d).slice(0, 10)))].sort();
}

export async function breachDays(trader: string): Promise<string[]> {
  const { rows } = await q<{ d: string }>(`SELECT DISTINCT date::text AS d FROM risk_alert_log WHERE trader = $1 AND level = 'breach'`, [trader]);
  return rows.map((r) => String(r.d).slice(0, 10)).sort();
}

async function guardComplied(trader: string): Promise<string[]> {
  const { rows } = await q<{ d: string }>(`SELECT day::text AS d FROM leak_guard_events WHERE trader = $1 AND outcome = 'complied' AND late = false`, [trader]);
  return rows.map((r) => String(r.d).slice(0, 10));
}

async function leakFlags(trader: string): Promise<LeakFlag[]> {
  const { rows } = await q<{ slice_key: string; first: string; last: string; theta: string; tau: string }>(
    `SELECT DISTINCT ON (slice_key) slice_key, as_of::text AS first,
            (MAX(as_of) OVER (PARTITION BY slice_key))::text AS last, theta_bps::text AS theta, prior_tau::text AS tau
       FROM edge_map WHERE trader = $1 AND verdict = 'LEAK' ORDER BY slice_key, as_of`,
    [trader],
  );
  return rows.map((r) => ({ sliceKey: String(r.slice_key), firstFlag: String(r.first), lastFlag: String(r.last), thetaBps: Number(r.theta), priorTau: Number(r.tau) }));
}

async function playbookOf(ids: readonly number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const { rows } = await q<{ id: number; pb: number }>(`SELECT id, playbook_id AS pb FROM trades WHERE id = ANY($1::int[]) AND playbook_id IS NOT NULL`, [ids]);
  return new Map(rows.map((r) => [Number(r.id), Number(r.pb)]));
}

export async function setupNames(ids: readonly number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { rows } = await q<{ id: number; name: string }>(`SELECT id, name FROM playbook WHERE id = ANY($1::int[])`, [ids]);
  return new Map(rows.map((r) => [Number(r.id), String(r.name ?? "")]));
}

export async function kudosDays(trader: string): Promise<string[]> {
  const { rows } = await q<{ d: string }>(`SELECT day AS d FROM achievement_kudos WHERE trader = $1`, [trader]);
  return rows.map((r) => String(r.d));
}

async function seasonTopDays(trader: string): Promise<string[]> {
  const { rows } = await q<{ d: string }>(`SELECT day::text AS d FROM recognition_events WHERE trader = $1 AND kind = 'season_top'`, [trader]);
  return rows.map((r) => String(r.d).slice(0, 10));
}

/** The current stage's path criteria (null without a stage / when the path is unavailable). */
async function pathOf(trader: string, today: string): Promise<PathInput | null> {
  try {
    const { readinessFor } = await import("../../routes/academy-path");
    const r = await readinessFor(trader, today, "ru");
    if (!r.stage) return null;
    return { stage: r.stage.key, next: r.nextStage?.key ?? null, steps: r.criteria.map((c) => ({ metric: String(c.metric), ok: c.status === "pass" })) };
  } catch (err) {
    logger.debug({ err: (err as Error)?.message, trader }, "achievements: path unavailable");
    return null;
  }
}

const minutesOf = (t: SimTrade) => (t.entryMin != null && t.holdSec != null && (!t.closeDay || t.closeDay === t.day) ? t.entryMin + t.holdSec / 60 : null);

export function procTradeOf(t: SimTrade): ProcTrade {
  return {
    day: t.day, entryMin: t.entryMin, exitMin: minutesOf(t), net: t.gross == null ? null : t.gross - t.fees, fees: t.fees, r: t.r,
    intraday: t.horizon === "intraday",
  };
}

export type HeavyInputs = {
  trades: ProcTrade[];
  disciplineDays: ScoreDay[];
  mastery: SetupMasteryState[];
  setupNames: Map<number, string>;
  leaks: LeakState[];
};

const heavyMemo = new Map<string, { at: number; value: Promise<HeavyInputs> }>();

async function loadHeavy(trader: string, asOf: string): Promise<HeavyInputs> {
  const from = addDays(asOf, -LOOKBACK_DAYS);
  const [sim, disc, flags] = await Promise.all([
    querySimTrades(trader, from, asOf).catch((err) => { logger.warn({ err: (err as Error)?.message, trader }, "achievements: trades failed"); return [] as SimTrade[]; }),
    loadDisciplineDays(trader, addDays(asOf, -DISCIPLINE_DAYS), asOf).catch(() => null),
    leakFlags(trader),
  ]);
  const closed = sim.filter((t) => t.gross != null);
  const pb = await playbookOf(closed.map((t) => t.id));
  const masteryTrades: MasteryTrade[] = closed.map((t) => ({
    day: t.day, net: (t.gross as number) - t.fees, r: t.r,
    notional: t.qty != null && t.entry != null && t.qty > 0 && t.entry > 0 ? t.qty * t.entry : null, setupId: pb.get(t.id) ?? null,
  }));
  const rules = {
    trades: [setting("achievements.masteryTrades1"), setting("achievements.masteryTrades2"), setting("achievements.masteryTrades3")].sort((a, b) => a - b) as [number, number, number],
    tagShare: setting("achievements.masteryTagShare"), windowDays: MASTERY_WINDOW_DAYS, tauBps: SETUP_TAU_BPS, tauR: SETUP_TAU_R,
  };
  const mastery = setupMastery(masteryTrades, asOf, rules);
  const edgeTrades = closed.map((t) => toEdgeTrade({ ...t, trader })).filter((t): t is EdgeTrade => t != null);
  const leaks = leakStates(flags, edgeTrades, { minTrades: setting("achievements.leakMinTrades"), minDays: 10 }, trader);
  return {
    trades: closed.map(procTradeOf),
    disciplineDays: (disc ?? []).map((d) => ({ date: d.date, score: d.score })),
    mastery,
    setupNames: await setupNames(mastery.map((m) => m.setupId)),
    leaks,
  };
}

export function heavyInputs(trader: string, asOf: string): Promise<HeavyInputs> {
  const k = `${trader}|${asOf}`;
  const hit = heavyMemo.get(k);
  if (hit && Date.now() - hit.at < HEAVY_MS) return hit.value;
  const value = loadHeavy(trader, asOf);
  value.catch(() => { if (heavyMemo.get(k)?.value === value) heavyMemo.delete(k); });
  if (heavyMemo.size > 500) heavyMemo.clear();
  heavyMemo.set(k, { at: Date.now(), value });
  return value;
}

export type V2Inputs = HeavyInputs & {
  violationDays: string[];
  breachDays: string[];
  guardComplied: string[];
  kudos: string[];
  seasonTop: string[];
  path: PathInput | null;
};

export async function loadV2Inputs(trader: string, asOf: string, today: string): Promise<V2Inputs> {
  const [heavy, viol, breach, guard, kudos, top, path] = await Promise.all([
    heavyInputs(trader, asOf), violationDays(trader), breachDays(trader), guardComplied(trader), kudosDays(trader), seasonTopDays(trader), pathOf(trader, today),
  ]);
  return { ...heavy, violationDays: viol, breachDays: breach, guardComplied: guard, kudos, seasonTop: top, path };
}
