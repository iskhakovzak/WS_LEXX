/**
 * GET /api/trainer/home → TrainerHome: the daily challenge state, «Мои дни» (replayable losses + the unfinished
 * replay), «Найди вход» setups (servable drills + mastery level + drill streak) and 30-day stats — one grouped stats
 * query + the daily state (pick memoised per date) + the drill list, cached per user for HOME_TTL_MS (dropped by
 * every trainer action: a game ended, a daily game started, a drill answered).
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { addDays, nyDate } from "../tradingDate";
import { horizonSql, netPnlSql } from "../tradeMath";
import { masteryLevels } from "../gamification/mastery";
import { lastPlayableDay, type Viewer } from "../sim/service";
import { HOME_TTL_MS, homeCache } from "./cache";
import { dailyState } from "./daily";
import { drillDays, drillsPerSetup } from "./drillStore";
import { ensureDrillsThrottled } from "./drillService";
import { splitSetupName } from "./drills";
import type { TrainerHome } from "./types";

type StatsRow = {
  games30: number; avg_r: string | null; beat_real: number; drills30: number; acc: string | null; candidates: number;
  own_active: { gameId: number; ticker: string } | null;
};

async function stats(viewer: Viewer, lastDay: string): Promise<StatsRow> {
  const { rows } = await pool.query<StatsRow>(
    `SELECT
       (SELECT count(*)::int FROM sim_games WHERE user_id = $1 AND status = 'finished' AND finished_at >= now() - interval '30 days') AS games30,
       (SELECT avg(r_total) FROM sim_games WHERE user_id = $1 AND status = 'finished' AND NOT (params ? 'own')
           AND finished_at >= now() - interval '30 days') AS avg_r,
       (SELECT count(*)::int FROM sim_games WHERE user_id = $1 AND status = 'finished' AND params ? 'own'
           AND result #>> '{own,verdict}' = 'better') AS beat_real,
       (SELECT count(*)::int FROM trainer_drill_attempts WHERE user_id = $1 AND created_at >= now() - interval '30 days') AS drills30,
       (SELECT avg(score) FROM trainer_drill_attempts WHERE user_id = $1 AND created_at >= now() - interval '30 days') AS acc,
       (SELECT count(*)::int FROM trades t
         WHERE t.deleted_at IS NULL AND t.trader = $2 AND ${netPnlSql("t")} < 0 AND ${horizonSql("t")} = 'intraday'
           AND t.ticker ~ '^[A-Z]{1,5}$' AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND left(t.date, 10) <= $3
           AND EXISTS (SELECT 1 FROM candle_archive a WHERE a.symbol = t.ticker AND a.day = left(t.date, 10)::date AND a.tf IN ('1m', '5m'))
           AND EXISTS (SELECT 1 FROM trade_executions e WHERE e.trade_id = t.id AND e.executed_at IS NOT NULL)) AS candidates,
       (SELECT json_build_object('gameId', id, 'ticker', ticker) FROM sim_games
         WHERE user_id = $1 AND status = 'active' AND params ? 'own' ORDER BY id DESC LIMIT 1) AS own_active`,
    [viewer.id, viewer.name, lastDay],
  );
  return rows[0];
}

/** Days in a row (ending today or yesterday) with at least one answered drill. */
export function dayStreak(days: readonly string[], today: string): number {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

async function levels(trader: string): Promise<Map<number, number>> {
  try {
    return await masteryLevels(trader);
  } catch (err) {
    logger.warn({ err }, "trainer: mastery levels unavailable");
    return new Map();
  }
}

export async function trainerHome(viewer: Viewer, now = new Date()): Promise<TrainerHome> {
  const hit = homeCache.get(viewer.id);
  if (hit && Date.now() - hit.at < HOME_TTL_MS) return hit.value as TrainerHome;
  const today = nyDate(now);
  void ensureDrillsThrottled(); // first visit of the day builds new drills in the background
  const [daily, s, setups, mastery, days] = await Promise.all([
    dailyState(viewer, now),
    stats(viewer, lastPlayableDay(now)),
    drillsPerSetup(viewer.name),
    levels(viewer.name),
    drillDays(viewer.id, addDays(today, -400)),
  ]);
  const num = (v: string | null) => (v == null ? null : Math.round(Number(v) * 100) / 100);
  const value: TrainerHome = {
    daily,
    myDays: { candidates: Number(s.candidates) || 0, active: s.own_active ? { gameId: Number(s.own_active.gameId), ticker: String(s.own_active.ticker) } : null },
    findEntry: {
      setups: setups.map((x) => {
        const { code, name } = splitSetupName(x.name);
        return { setupId: x.setupId, code, name, drills: x.drills, masteryLevel: mastery.get(x.setupId) ?? 0 };
      }),
      streak: dayStreak(days, today),
    },
    stats: {
      attempts30d: (Number(s.games30) || 0) + (Number(s.drills30) || 0),
      avgR30d: num(s.avg_r),
      beatReal: Number(s.beat_real) || 0,
      findEntryAccuracy: s.acc == null ? null : Math.round(Number(s.acc)),
    },
  };
  if (homeCache.size > 500) homeCache.clear();
  homeCache.set(viewer.id, { at: Date.now(), value });
  return value;
}
