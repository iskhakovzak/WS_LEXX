/**
 * Titles — PURE. Earned titles come from stored achievement tiers (lib/quests trader_achievements) and setup mastery
 * level 4 (setup_mastery); the trader picks one (activeTitle, PUT /api/gamification/title) and it is shown next to the
 * name in rankings. The web renders `titles.<key>`; «sniper:<setup>» renders as titles.sniper with {setup}.
 */

/** "<line>:<tier>" → title key. */
export const TITLE_BY_TIER: Readonly<Record<string, string>> = {
  "contract_streak:gold": "iron",
  "contract_streak:platinum": "unbreakable",
  "comeback:gold": "comeback",
  "reviews_total:gold": "analyst",
  "review_streak:gold": "self_critic",
  "focus_beaten:gold": "focus_master",
  "clean_month:gold": "risk_keeper",
  "plan_before_open:gold": "planner",
  "full_loop:gold": "full_loop",
  "own_replays:gold": "student",
  "beat_yourself:gold": "self_beater",
  "tier_up:gold": "senior",
};

export const MASTER_LEVEL = 4;

export type TitleAchievement = { line: string; tier: string; date: string };
export type TitleMastery = { setupId: number; code: string | null; level: number; levelOn: string };

/** «sniper:1.3» (the setup code, else its id). */
export const sniperKey = (m: Pick<TitleMastery, "setupId" | "code">) => `sniper:${m.code ?? m.setupId}`;

/** Every earned title with the NY day it was earned, oldest first. */
export function titlesOf(achievements: readonly TitleAchievement[], mastery: readonly TitleMastery[]): { key: string; earnedAt: string }[] {
  const out = new Map<string, string>();
  for (const a of achievements) {
    const key = TITLE_BY_TIER[`${a.line}:${a.tier}`];
    if (key && (!out.has(key) || a.date < out.get(key)!)) out.set(key, a.date);
  }
  for (const m of mastery) if (m.level >= MASTER_LEVEL) out.set(sniperKey(m), m.levelOn);
  return [...out].map(([key, earnedAt]) => ({ key, earnedAt })).sort((a, b) => a.earnedAt.localeCompare(b.earnedAt) || a.key.localeCompare(b.key));
}

/** The chosen title when it is still earned, else null. */
export function activeTitleOf(chosen: string | null | undefined, earned: readonly { key: string }[]): string | null {
  return chosen && earned.some((t) => t.key === chosen) ? chosen : null;
}
