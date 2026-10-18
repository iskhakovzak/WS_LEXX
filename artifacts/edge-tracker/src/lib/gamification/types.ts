/**
 * Gamification layer over discipline points / levels / quests / achievements (owner 2026-10-18: «чтобы интерес был
 * лучше и награды»). Rewards discipline, reviewing, planning and learning — NEVER P&L, trade count or time in the app.
 *   season      — monthly season points (reset each month; all-time level stays) + season ranking;
 *   league      — curator groups compete on average season points per active member;
 *   recognition — achievement / streak events shown in the desk feed and (opt-in) the Telegram group; a trader can
 *                 hide himself (users.settings.shareAchievements, default on);
 *   mastery     — per-setup rank from graded-A trades + «Найди вход» drills;
 *   freeze      — streak freeze: N per month (settings) keeps a contract streak over a missed day;
 *   titles      — earned titles shown next to names in rankings;
 *   rewards     — admin-defined REAL rewards (catalog) granted for achievements / levels / season ranks / mastery,
 *                 delivered by staff (eligible → requested → granted | declined). Not bought with points.
 * Badges are merged into achievements (one award system).
 * Web mirror of api-server src/lib/gamification/types.ts — keep identical.
 */
export type TextItem = { key: string; params?: Record<string, string | number | null> };

export interface SeasonState {
  key: string; // "2026-10"
  from: string;
  to: string;
  endsInDays: number;
  myPoints: number;
  myRank: number | null;
  of: number;
  /** label = name (staff / names shown) or alias key "t<n>" for traders; title = earned title key or null. */
  top: { label: string; me: boolean; points: number; title: string | null }[];
}

export interface LeagueState {
  season: string;
  teams: { curator: string; members: number; score: number; rank: number; mine: boolean }[];
  /** The viewer's own team (curator / admin with wards only): every active member, real names (staff see names). */
  members?: { trader: string; points: number; title: string | null }[];
}

export interface SetupMastery {
  setupId: number;
  code: string | null;
  name: string;
  level: number; // 0..4 (Новичок, Ученик, Практик, Эксперт, Мастер)
  progress: { current: number; next: number | null };
  sources: { gradeATrades: number; drills: number };
}

export interface StreakFreeze { available: number; perMonth: number; usedOn: string[] }

export interface RewardItem {
  id: number;
  title: string; // owner-written content (not translated)
  description: string | null;
  condition: { kind: "achievement" | "level" | "season_rank" | "mastery"; ref: string; tier?: string | null; rank?: number | null };
  active: boolean;
  stock: number | null;
}

export interface RewardGrant {
  id: number;
  itemId: number;
  trader: string;
  status: "eligible" | "requested" | "granted" | "declined";
  at: string;
  by: string | null;
  /** Staff note on grant / decline; the season key for a season_rank grant ('' otherwise). Absent on older servers. */
  note?: string | null;
  ref?: string;
  /** The item's title (owner text), so staff without the admin items list can read the queue. */
  title?: string | null;
}

export interface RecognitionEvent { id: number; trader: string; kind: string; text: TextItem; at: string }

/** GET /api/gamification/me (staff may pass ?trader=). */
export interface GamificationMe {
  season: SeasonState;
  league: LeagueState | null;
  mastery: SetupMastery[];
  freeze: StreakFreeze;
  titles: { key: string; earnedAt: string }[];
  activeTitle: string | null;
  /** catalog = active items + any item the trader's grants refer to (history survives a deactivated item);
   *  declined = staff declined these requests (absent on older servers). */
  rewards: { eligible: RewardGrant[]; requested: RewardGrant[]; granted: RewardGrant[]; declined?: RewardGrant[]; catalog: RewardItem[] };
}
