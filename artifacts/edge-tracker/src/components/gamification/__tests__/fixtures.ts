// Gamification fixtures (lib/gamification/types.ts): a trader in the middle of the October season.
import type { GamificationMe, RewardItem, SeasonState } from "@/lib/gamification/types";
import type { LeagueView } from "../api";

export const season = (over: Partial<SeasonState> = {}): SeasonState => ({
  key: "2026-10",
  from: "2026-10-01",
  to: "2026-10-31",
  endsInDays: 12,
  myPoints: 84,
  myRank: 7,
  of: 31,
  top: [
    { label: "t3", me: false, points: 160, title: "iron" },
    { label: "t11", me: false, points: 141, title: null },
    { label: "t5", me: false, points: 120, title: "sniper:1.3" },
  ],
  ...over,
});

export const league = (over: Partial<LeagueView> = {}): LeagueView => ({
  season: "2026-10",
  teams: [
    { curator: "Ольга Н.", members: 5, score: 61.4, rank: 2, mine: true },
    { curator: "Артур К.", members: 4, score: 72.25, rank: 1, mine: false },
  ],
  ...over,
});

export const items: RewardItem[] = [
  { id: 1, title: "Обед с руководителем", description: "Раз в месяц", condition: { kind: "achievement", ref: "contract_streak", tier: "gold", rank: null }, active: true, stock: 3 },
  { id: 2, title: "Мерч деска", description: null, condition: { kind: "season_rank", ref: "season", tier: null, rank: 3 }, active: true, stock: null },
  { id: 3, title: "Курс по риску", description: null, condition: { kind: "level", ref: "3", tier: null, rank: null }, active: true, stock: 0 },
  { id: 4, title: "Старый приз", description: null, condition: { kind: "mastery", ref: "1.3", tier: "4", rank: null }, active: false, stock: null },
  { id: 5, title: "Книга", description: null, condition: { kind: "mastery", ref: "", tier: "2", rank: null }, active: true, stock: null },
];

export const gami = (over: Partial<GamificationMe> = {}): GamificationMe => ({
  season: season(),
  league: league(),
  mastery: [
    { setupId: 13, code: "1.3", name: "ORB", level: 2, progress: { current: 3, next: 5 }, sources: { gradeATrades: 6, drills: 4 } },
    { setupId: 21, code: "2.1", name: "VWAP Hold", level: 4, progress: { current: 12, next: null }, sources: { gradeATrades: 20, drills: 9 } },
    { setupId: 15, code: "1.5", name: "Первый откат", level: 0, progress: { current: 0, next: 2 }, sources: { gradeATrades: 0, drills: 0 } },
  ],
  freeze: { available: 1, perMonth: 2, usedOn: ["2026-10-14"] },
  titles: [{ key: "iron", earnedAt: "2026-10-09" }, { key: "sniper:2.1", earnedAt: "2026-10-12" }],
  activeTitle: "iron",
  rewards: {
    eligible: [{ id: 10, itemId: 1, trader: "Кирилл Б.", status: "eligible", at: "2026-10-15", by: null }],
    requested: [{ id: 11, itemId: 5, trader: "Кирилл Б.", status: "requested", at: "2026-10-16", by: null }],
    granted: [{ id: 9, itemId: 4, trader: "Кирилл Б.", status: "granted", at: "2026-09-30", by: "Ольга Н." }],
    catalog: items,
  },
  ...over,
});
