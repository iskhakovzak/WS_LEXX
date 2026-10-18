/**
 * The per-trader cache of lib/quests/service.ts evaluations, in a module without dependencies so that routes which change
 * what quests read (personal plan saved, own replay finished, Telegram linked, own PIN set, «Деск на тикере» opened)
 * can drop it — the next read recomputes and the quest completes at once instead of after CACHE_MS.
 *
 * Each forget moves the trader's generation forward: an evaluation that was already running when the data changed (a
 * curator assigned a quest, a review landed) neither fills the cache with its older answer nor is handed to later
 * readers. forgetAllQuests (a desk settings save: targets, points, switches) does that for every trader at once.
 */
export const evaluationCache = new Map<string, { at: number; today: string; gen: number; value: unknown }>();

let seq = 0;
let allAt = 0;
const generations = new Map<string, number>();

/** The trader's current generation (grows on every forget of the trader or of everyone). */
export function generationOf(trader: string): number {
  return Math.max(generations.get(trader) ?? 0, allAt);
}

export function forgetQuests(trader: string | null | undefined): void {
  if (!trader) return;
  evaluationCache.delete(trader);
  generations.set(trader, ++seq);
}

/** Drops every trader's cached evaluation (and any run in flight). */
export function forgetAllQuests(): void {
  evaluationCache.clear();
  allAt = ++seq;
}
