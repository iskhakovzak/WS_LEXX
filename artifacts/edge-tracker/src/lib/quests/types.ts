/**
 * Quests and achievements (owner 2026-10-18: «добавить квесты и ачивки, очень развить эту систему»), on top of the
 * daily-loop rewards (lib/daily/rewards, badges, levels). Goal: keep new traders — reward FOLLOWING RULES, REVIEWING,
 * PLANNING and LEARNING; never P&L, trade count or time in the app (that would push overtrading).
 * Web mirror of api-server src/lib/quests/types.ts — keep both identical.
 */

export type TextItem = { key: string; params?: Record<string, string | number | null> };

// ─── Achievements: permanent, tiered lines (the existing badges become tiers of these lines) ───

export type AchievementCategory = "discipline" | "review" | "focus" | "risk" | "planning" | "learning" | "growth";
export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export interface AchievementTierState {
  tier: AchievementTier;
  target: number;
  earnedAt: string | null; // NY date
}

export interface Achievement {
  /** Stable line id, e.g. "contract_streak", "reviews_total", "focus_beaten", "clean_month", "own_replays", "beat_yourself", "plan_before_open", "tier_up". */
  id: string;
  category: AchievementCategory;
  title: TextItem;
  /** How to earn (shown on locked tiers). */
  hint: TextItem;
  /** Current progress toward the next unearned tier (same unit as tier targets). */
  current: number;
  tiers: AchievementTierState[];
  /** Highest earned tier, or null. */
  tier: AchievementTier | null;
  /** Hidden (secret) achievements show «???» until earned. */
  secret: boolean;
}

// ─── Quests: time-boxed tasks with progress and a reward ───

/** onboarding = first-steps chain for new traders (Стажёр); curator = assigned by a curator to one trader. */
export type QuestScope = "onboarding" | "daily" | "weekly" | "monthly" | "curator";
export type QuestStatus = "active" | "done" | "failed" | "expired";

export interface Quest {
  /** Instance id (stored). */
  id: number;
  scope: QuestScope;
  /** Catalog template key, e.g. "plan_before_open", "review_yesterday", "replay_own_day", "contract_days", "focus_absent_days", "read_game_plan", "link_telegram", "open_desk_day". */
  template: string;
  title: TextItem;
  description: TextItem;
  /** Progress counter and target (e.g. 3 of 5 days). */
  progress: number;
  target: number;
  status: QuestStatus;
  /** A curator quest the curator cancelled (status reads "expired" for older clients). */
  cancelled?: boolean;
  /** Bonus discipline points on completion (feed the level), and an optional achievement/badge line it advances. */
  rewardPoints: number;
  startsOn: string; // NY date
  endsOn: string | null; // NY date, inclusive; null = no deadline (onboarding)
  completedAt: string | null;
  /** Curator quests: who assigned it (stored name; display via personName) and an optional note. */
  assignedBy: string | null;
  note: string | null;
  /** The manual curator task: the NY day the trader pressed «Готово» (the curator still confirms; Волна 2 п. 2.13). */
  reportedOn?: string | null;
  /** Where to go to make progress (site path), e.g. "/game-plan?view=my". */
  href: string | null;
}

/** GET /api/quests/me and GET /api/quests/trader/:name (staff). */
export interface QuestsMe {
  today: string;
  quests: Quest[];
  achievements: Achievement[];
  /** Totals for the header: quests done this week, achievements earned, onboarding step x of n. */
  summary: { weekDone: number; weekTotal: number; achievementsEarned: number; achievementsTotal: number; onboarding: { done: number; total: number } | null };
}

/** POST /api/quests/assign (curator): a quest for one trader from a template, with own target / deadline / points. */
export interface AssignQuestBody {
  trader: string;
  template: string;
  target: number;
  endsOn: string;
  rewardPoints?: number;
  note?: string;
}
