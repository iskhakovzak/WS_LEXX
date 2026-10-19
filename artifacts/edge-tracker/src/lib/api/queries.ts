/**
 * Query factories for endpoints that several features read. Each feature transforms the rows with `select`, so the
 * cache always holds the raw server answer (one request, one cache entry).
 */
import { queryOptions } from "@tanstack/react-query";
import { nyDate } from "@/lib/trading-date";
import type { DailyMe } from "@/lib/daily/types";
import type { PlaybookToday } from "@/lib/playbook-today/types";
import type { GamificationMe } from "@/lib/gamification/types";
import type { QuestsMe } from "@/lib/quests/types";
import { apiErrorStatus } from "./errors";
import { http } from "./http";
import { KEYS, STALE } from "./keys";

/** Row of GET /api/trades?result=open, as much as the readers need. */
export type OpenTradeRow = {
  id: number;
  ticker: string;
  result: string;
  date?: string | null;
  trader?: string | null;
  side?: string | null;
  horizon?: string | null;
  exitDate?: string | null;
  [key: string]: unknown;
};

export const openTradesQuery = () =>
  queryOptions({
    queryKey: KEYS.openTrades(),
    queryFn: ({ signal }) => http.get<OpenTradeRow[]>("/api/trades", { query: { result: "open" }, signal }),
    staleTime: STALE.short,
  });

export const tradeIdeasQuery = <T = unknown>() =>
  queryOptions({
    queryKey: KEYS.tradeIdeas(),
    queryFn: ({ signal }) => http.get<T[]>("/api/trade-ideas", { signal }),
    staleTime: STALE.default,
  });

/**
 * The viewer's own risk state for the NY trading day (GET /api/risk/me?date=). Each reader types the answer with its own
 * `RiskMe` shape (dashboard, risk page) or narrows it with `select` (shell badge).
 */
export const riskMeQuery = <T = unknown>(date: string = nyDate()) =>
  queryOptions({
    queryKey: KEYS.riskMe(date),
    queryFn: ({ signal }) => http.get<T>("/api/risk/me", { query: { date }, signal }),
    staleTime: STALE.default,
  });

/**
 * The viewer's daily loop (GET /api/daily/me): focus, last finished day's evening card, tier progress. Keyed by the NY
 * day; texts travel as keys (rendered by the web dictionaries), so a language switch needs no refetch. 403 → null
 * (a role without a personal loop).
 */
export const dailyMeQuery = (date: string = nyDate()) =>
  queryOptions({
    queryKey: KEYS.dailyMe(date),
    queryFn: ({ signal }) =>
      http.get<DailyMe>("/api/daily/me", { signal }).catch((e: unknown) => {
        if (apiErrorStatus(e) === 403) return null;
        throw e;
      }),
    staleTime: STALE.default,
    meta: { i18n: false },
  });

/** The viewer's personal plan for `date` (GET /api/game-plan/my?date=); each reader types `doc` with its own shape. */
export const myPlanQuery = <T = unknown>(date: string) =>
  queryOptions({
    queryKey: KEYS.myPlan(date),
    queryFn: ({ signal }) => http.get<T>("/api/game-plan/my", { query: { date }, signal }),
    staleTime: STALE.short,
  });

/**
 * Playbook «Сегодня» (GET /api/playbook/today): the day map, setups by window with the viewer's own edge, tier locks,
 * today's picks, 1R and the untagged count. Staff may pass a trader. 404 (an older API) → null, so readers hide.
 */
export const playbookTodayQuery = (trader?: string | null) =>
  queryOptions({
    queryKey: KEYS.playbookToday(trader),
    queryFn: ({ signal }) =>
      http.get<PlaybookToday>("/api/playbook/today", { query: trader ? { trader } : undefined, signal }).catch((e: unknown) => {
        if (apiErrorStatus(e) === 404) return null;
        throw e;
      }),
    staleTime: STALE.short,
  });

/** 403 (a role without it) and 404 (an older API) read as «nothing to show». */
function nullOn403or404<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    const s = apiErrorStatus(e);
    if (s === 403 || s === 404) return null;
    throw e;
  });
}

/**
 * Season, league, mastery, streak freeze, titles and rewards (GET /api/gamification/me; staff may pass a trader).
 * Read by the dashboard rewards chip, the «Квесты и достижения» tab and the «Сезон» tab — one cache entry.
 */
export const gamificationMeQuery = (trader?: string | null) =>
  queryOptions({
    queryKey: KEYS.gamificationMe(trader),
    queryFn: ({ signal }) => nullOn403or404(http.get<GamificationMe>("/api/gamification/me", { query: trader ? { trader } : undefined, signal })),
    staleTime: STALE.default,
    retry: false,
    meta: { i18n: false },
  });

/** The viewer's quests and achievements (same key and answer as components/quests useQuestsMe). */
export const questsMeQuery = () =>
  queryOptions({
    queryKey: KEYS.questsMe(),
    queryFn: ({ signal }) => nullOn403or404(http.get<QuestsMe>("/api/quests/me", { signal })),
    staleTime: STALE.default,
    retry: false,
    meta: { i18n: false },
  });

/** Active titles by stored name (GET /api/gamification/titles; people who hide their achievements are left out). */
export const gamificationTitlesQuery = () =>
  queryOptions({
    queryKey: ["gamification", "titles"] as const,
    queryFn: async ({ signal }) => (await nullOn403or404(http.get<{ titles: Record<string, string> }>("/api/gamification/titles", { signal })))?.titles ?? {},
    staleTime: STALE.long,
    retry: false,
    meta: { i18n: false },
  });
