/**
 * Discipline rewards — the daily loop's view of lib/quests: the trader's streak / points / level (lib/daily/discipline.ts,
 * plus the done quests' bonus points) and the badge list. The 8 discipline badges are tiers of the achievement lines now
 * (lib/quests/achievements.ts BADGE_TIER; migration 0207 copied trader_badges into trader_achievements with the original
 * days); awarding, notifications («achievement_earned») and quests live in lib/quests/service.ts — one evaluation for
 * GET /api/daily/me, /api/quests/me, the evening card and the curator profile.
 *
 * Badges are MERGED into achievements (owner 2026-10-18: one award system): the API answers send `badges: []`
 * (DailyMe.badges, the curator focus panel, EveningCard.rewards.badges) — the same tiers travel as achievements; the
 * stored data (trader_badges, BADGE_TIER) stays for compatibility.
 *
 * When it runs: on read with the per-trader cache of lib/quests/service (CACHE_MS; a new day, a review or an assignment
 * recompute at once) and nightly (rewards.nightly, lib/daily/rewardsJob.ts; quests.nightly, lib/quests/job.ts).
 */
import { logger } from "../logger";
import { BADGE_TIER, TIERS } from "../quests/achievements";
import { evaluationFor, forgetQuests } from "../quests/service";
import { achievementsOf, questsDoneOn } from "../quests/store";
import { contractLedger, lastFinishedDay } from "./discipline";
import { behaviorTradesOf } from "./load";
import type { BadgeId, BadgeState, DisciplineSummary, EveningCard } from "./types";

export type Rewards = { discipline: DisciplineSummary; badges: BadgeState[] };

/** Drop the cached answer (a new snapshot, a review) so the next read recomputes. */
export function forgetRewards(trader: string): void {
  forgetQuests(trader);
}

/** Recomputes everything for one trader now (quests synced, achievements awarded) and refreshes the cache. */
export async function evaluateRewards(trader: string, now = new Date()): Promise<Rewards> {
  forgetQuests(trader);
  const e = await evaluationFor(trader, now);
  return { discipline: e.discipline, badges: [] };
}

/** Cached rewards. Null when the evaluation failed. */
export async function rewardsFor(trader: string, now = new Date()): Promise<Rewards | null> {
  try {
    const e = await evaluationFor(trader, now);
    return { discipline: e.discipline, badges: [] };
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, trader }, "rewards: evaluation failed");
    return null;
  }
}

/** Achievement tiers earned on `date` (stored), and the legacy badge ids among them. */
async function earnedOn(trader: string, date: string): Promise<{ achievements: { line: string; tier: string; target: number }[]; badges: { id: BadgeId; target: number }[] }> {
  const day = (await achievementsOf(trader)).filter((a) => a.date === date);
  const badges: { id: BadgeId; target: number }[] = [];
  for (const [id, [line, idx]] of Object.entries(BADGE_TIER) as [BadgeId, readonly [string, number]][]) {
    const a = day.find((x) => x.line === line && x.tier === TIERS[idx]);
    if (a) badges.push({ id, target: a.target });
  }
  const order = (t: string) => TIERS.indexOf(t as (typeof TIERS)[number]);
  return { achievements: day.sort((a, b) => order(b.tier) - order(a.tier)).map((a) => ({ line: a.line, tier: a.tier, target: a.target })), badges };
}

/** Badges earned on `date` (stored; for older evening cards). */
export async function badgesOn(trader: string, date: string): Promise<{ id: BadgeId; target: number }[]> {
  return (await earnedOn(trader, date)).badges;
}

/**
 * The evening card's rewards line: the kept-contract streak after `date` (`streak` = from the scaled verdict, when the
 * day had a contract), the achievement tiers earned that day (and their legacy badge ids) and the quests done that day.
 * The last finished day evaluates first (cached), so today's awards are in.
 */
export async function cardRewards(trader: string, date: string, streak: number | null, now = new Date()): Promise<EveningCard["rewards"]> {
  let s = streak;
  if (date === lastFinishedDay(now)) {
    const r = await rewardsFor(trader, now);
    if (!r) return null;
    s ??= r.discipline.streak;
  }
  s ??= (await contractLedger(trader, { to: date, now, loadTrades: behaviorTradesOf(trader) })).at(-1)?.streak ?? 0;
  const [earned, questsDone] = await Promise.all([earnedOn(trader, date), questsDoneOn(trader, date)]);
  return { streak: s, badges: [], achievements: earned.achievements, questsDone };
}
