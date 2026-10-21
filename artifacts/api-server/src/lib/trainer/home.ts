/**
 * GET /api/trainer/home → TrainerHome: the daily challenge state, «Мои дни» (replayable losses + the unfinished
 * replay), «Найди вход» setups (servable drills + mastery level + drill streak) and 30-day stats — one grouped stats
 * query + the daily state (pick memoised per date) + the drill list, cached per user for HOME_TTL_MS (dropped by
 * every trainer action: a game ended, a daily game started, a drill answered).
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { addDays, nyDate } from "../tradingDate";
import { computeMastery } from "../gamification/mastery";
import type { SetupMastery } from "../gamification/types";
import { setting } from "../settings/registry";
import type { Viewer } from "../sim/service";
import { ownCandidateCount } from "../sim/ownService";
import { HOME_TTL_MS, homeCache } from "./cache";
import { dailyState } from "./daily";
import { drillDays, drillsPerSetup } from "./drillStore";
import { ensureDrillsThrottled } from "./drillService";
import { splitSetupName } from "./drills";
import type { TrainerHome } from "./types";

type StatsRow = {
  games30: number; avg_r: string | null; beat_real: number; drills30: number; acc: string | null;
  own_active: { gameId: number; ticker: string } | null;
};

async function stats(viewer: Viewer): Promise<StatsRow> {
  const { rows } = await pool.query<StatsRow>(
    `SELECT
       (SELECT count(*)::int FROM sim_games WHERE user_id = $1 AND status = 'finished' AND finished_at >= now() - interval '30 days') AS games30,
       (SELECT avg(r_total) FROM sim_games WHERE user_id = $1 AND status = 'finished' AND NOT (params ? 'own')
           AND finished_at >= now() - interval '30 days') AS avg_r,
       (SELECT count(*)::int FROM sim_games WHERE user_id = $1 AND status = 'finished' AND params ? 'own'
           AND result #>> '{own,verdict}' = 'better') AS beat_real,
       (SELECT count(*)::int FROM trainer_drill_attempts WHERE user_id = $1 AND created_at >= now() - interval '30 days') AS drills30,
       (SELECT avg(score) FROM trainer_drill_attempts WHERE user_id = $1 AND created_at >= now() - interval '30 days') AS acc,
       (SELECT json_build_object('gameId', id, 'ticker', ticker) FROM sim_games
         WHERE user_id = $1 AND status = 'active' AND params ? 'own' ORDER BY id DESC LIMIT 1) AS own_active`,
    [viewer.id],
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

/** setupId → mastery (level, points, next threshold, passed drills); empty when unavailable. */
async function levels(trader: string): Promise<Map<number, SetupMastery>> {
  try {
    return new Map((await computeMastery(trader)).map((m) => [m.setupId, m]));
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
  const [daily, s, candidates, setups, mastery, days] = await Promise.all([
    dailyState(viewer, now),
    stats(viewer),
    ownCandidateCount(viewer), // the eligible list «Мои дни» offers (lib/trainer/eligibility), not a raw SQL count
    drillsPerSetup(viewer.name),
    levels(viewer.name),
    drillDays(viewer.id, addDays(today, -400)),
  ]);
  const num = (v: string | null) => (v == null ? null : Math.round(Number(v) * 100) / 100);
  const value: TrainerHome = {
    daily,
    myDays: { candidates, active: s.own_active ? { gameId: Number(s.own_active.gameId), ticker: String(s.own_active.ticker) } : null },
    findEntry: {
      setups: setups.map((x) => {
        const { code, name } = splitSetupName(x.name);
        const m = mastery.get(x.setupId);
        return {
          setupId: x.setupId, code, name, drills: x.drills, masteryLevel: m?.level ?? 0,
          masteryPoints: m?.progress.current ?? 0, masteryNext: m ? m.progress.next : null, drillsPassed: m?.sources.drills ?? 0,
        };
      }),
      streak: dayStreak(days, today),
      drillsPerPoint: Math.max(1, Math.round(setting("gamification.masteryDrillsPerPoint"))),
      passScore: setting("trainer.drillPassScore"),
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
