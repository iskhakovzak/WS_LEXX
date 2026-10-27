/**
 * What every rewards / quests evaluation of a trader feeds into gamification (called by lib/quests/service
 * evaluateTrader; never throws): the season scores (this month, the month of the last finished day and — in the first
 * days of a month — the month before) and recognition for the fresh achievement tiers and long contract streaks.
 * Recognition covers only the last RECENT_DAYS days, so the first run after the rollout stores history quietly.
 */
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import type { LedgerDay } from "../daily/discipline";
import { recordRecognition } from "./recognition";
import { previousSeason, seasonKeyOf, seasonScore, type SeasonQuest } from "./season";
import { writeSeasonScore } from "./seasonStore";

export const RECENT_DAYS = 7;
/** Days into a month during which the month before is still re-scored (late snapshots, the nightly job). */
const CARRY_DAYS = 10;

export type EvaluationFacts = {
  today: string;
  asOf: string;
  ledger: readonly LedgerDay[];
  quests: readonly SeasonQuest[];
  /** Traded days (all time). */
  tradedDays: readonly string[];
  /** Achievement tiers stored by this evaluation. */
  awarded: readonly { line: string; tier: string; date: string; target: number; detail?: Record<string, unknown> | null }[];
};

/** Seasons to (re)score now. */
export function seasonsToScore(today: string, asOf: string): string[] {
  const cur = seasonKeyOf(today);
  const keys = new Set([cur, seasonKeyOf(asOf)]);
  if (Number(today.slice(8, 10)) <= CARRY_DAYS) keys.add(previousSeason(cur));
  return [...keys].sort();
}

/** Kept days in the recent window whose streak is a multiple of the milestone step (tier targets excluded: those are achievements). */
export function streakMilestones(ledger: readonly LedgerDay[], asOf: string, step: number, tierTargets: readonly number[]): { days: number; date: string }[] {
  if (step <= 0) return [];
  const from = addDays(asOf, -RECENT_DAYS);
  const tiers = new Set(tierTargets);
  return ledger
    .filter((d) => d.outcome === "kept" && d.date >= from && d.date <= asOf && d.streak >= step && d.streak % step === 0 && !tiers.has(d.streak))
    .map((d) => ({ days: d.streak, date: d.date }));
}

export async function afterEvaluation(trader: string, f: EvaluationFacts): Promise<void> {
  if (!setting("gamification.enabled")) return;
  try {
    for (const key of seasonsToScore(f.today, f.asOf)) {
      await writeSeasonScore(key, trader, seasonScore(key, { ledger: f.ledger, quests: f.quests, tradedDays: f.tradedDays }));
    }
    const from = addDays(f.asOf, -RECENT_DAYS);
    for (const a of f.awarded) {
      if (a.date < from) continue;
      const d = a.detail ?? {};
      const subject = { ...(d.name != null ? { name: String(d.name) } : {}), ...(d.slice != null ? { slice: String(d.slice) } : {}), ...(d.metric != null ? { metric: String(d.metric), stage: String(d.stage ?? "") } : {}) };
      await recordRecognition({ trader, kind: "achievement", ref: `${a.line}:${a.tier}`, params: { line: a.line, tier: a.tier, target: a.target, ...subject }, day: a.date });
    }
    const tierTargets = [1, 2, 3, 4].map((i) => Number(setting(`achievements.contractStreak${i}` as "achievements.contractStreak1")));
    for (const m of streakMilestones(f.ledger, f.asOf, setting("gamification.streakMilestoneStep"), tierTargets)) {
      await recordRecognition({ trader, kind: "streak", ref: `${m.days}:${m.date}`, params: { days: m.days }, day: m.date });
    }
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, trader }, "gamification: after evaluation failed");
  }
}
