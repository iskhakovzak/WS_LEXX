/**
 * Gamification client (api-server routes/gamification.ts):
 *   GET  /api/gamification/me[?trader=]            → GamificationMe (lib/api/queries gamificationMeQuery — shared key)
 *   GET  /api/gamification/season                  → SeasonState (top + the viewer; aliases for traders)
 *   GET  /api/gamification/league                  → LeagueState (+ `members` of the curator's own team)
 *   GET  /api/gamification/titles → lib/api/queries gamificationTitlesQuery (the P&L leaderboard reads it too)
 *   PUT  /api/gamification/title {key}             → set / clear the own title
 *   GET  /api/gamification/rewards/items           → { items, pending, options } (admin catalog)
 *   POST /api/gamification/rewards/items | PUT …/items/:id (admin)
 *   POST /api/gamification/rewards/items/:id/request (trader)
 *   GET  /api/gamification/rewards/queue           → RewardGrant[] requested (staff, managed traders)
 *   POST /api/gamification/rewards/grants/:id/grant | /decline (staff)
 * 403 / 404 → null: the role has none of it, or the API build does not have it yet (the UI hides).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { apiErrorStatus } from "@/lib/api/errors";
import { KEYS, STALE } from "@/lib/api/keys";
import { gamificationMeQuery } from "@/lib/api/queries";
import type { LeagueState, RewardGrant, RewardItem, SeasonState } from "@/lib/gamification/types";

/** `members`: the viewer's own team (curators only). */
export type LeagueView = LeagueState;

export type RewardItemInput = Omit<RewardItem, "id">;
export type RewardOptions = {
  achievements: { id: string; tiers: string[] }[];
  levels: number;
  setups: { id: number; code: string | null; name: string }[];
};
export type RewardCatalog = { items: RewardItem[]; pending?: number; options?: RewardOptions };
/** A queue row carries the item title (staff without the admin catalog read it from there). */
export type QueueGrant = RewardGrant;

export const gamificationKeys = {
  all: ["gamification"] as const,
  me: KEYS.gamificationMe,
  season: () => ["gamification", "season"] as const,
  league: () => ["gamification", "league"] as const,
  items: () => ["gamification", "rewards", "items"] as const,
  queue: () => ["gamification", "rewards", "queue"] as const,
};

function orNull<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    const s = apiErrorStatus(e);
    if (s === 403 || s === 404) return null;
    throw e;
  });
}

export function useGamificationMe(enabled = true, trader?: string | null) {
  return useQuery({ ...gamificationMeQuery(trader), enabled });
}

export function useSeason(enabled = true) {
  return useQuery({
    queryKey: gamificationKeys.season(),
    queryFn: ({ signal }) => orNull(http.get<SeasonState>("/api/gamification/season", { signal })),
    enabled,
    retry: false,
    staleTime: STALE.default,
    meta: { i18n: false },
  });
}

export function useLeague(enabled = true) {
  return useQuery({
    queryKey: gamificationKeys.league(),
    queryFn: ({ signal }) => orNull(http.get<LeagueView>("/api/gamification/league", { signal })),
    enabled,
    retry: false,
    staleTime: STALE.default,
    meta: { i18n: false },
  });
}

export function useRewardCatalog(enabled = true) {
  return useQuery({
    queryKey: gamificationKeys.items(),
    queryFn: ({ signal }) => orNull(http.get<RewardCatalog | RewardItem[]>("/api/gamification/rewards/items", { signal })).then(asCatalog),
    enabled,
    retry: false,
    staleTime: STALE.short,
    meta: { i18n: false },
  });
}

function asCatalog(r: RewardCatalog | RewardItem[] | null): RewardCatalog | null {
  if (!r) return null;
  return Array.isArray(r) ? { items: r } : { ...r, items: r.items ?? [] };
}

export function useRewardQueue(enabled = true) {
  return useQuery({
    queryKey: gamificationKeys.queue(),
    queryFn: async ({ signal }) => {
      const r = await orNull(http.get<QueueGrant[] | { grants: QueueGrant[] }>("/api/gamification/rewards/queue", { signal }));
      if (!r) return null;
      return Array.isArray(r) ? r : r.grants ?? [];
    },
    enabled,
    retry: false,
    staleTime: STALE.default,
    meta: { i18n: false },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: gamificationKeys.all });
}

export function useSetTitle() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (key: string | null) => http.put<unknown>("/api/gamification/title", { key }),
    onSuccess: invalidate,
  });
}

export function useRequestReward() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (itemId: number) => http.post<unknown>(`/api/gamification/rewards/items/${itemId}/request`, {}),
    onSuccess: invalidate,
  });
}

export function useSaveRewardItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: number | null; body: RewardItemInput }) =>
      id == null ? http.post<RewardItem>("/api/gamification/rewards/items", body) : http.put<RewardItem>(`/api/gamification/rewards/items/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDecideReward() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "grant" | "decline" }) => http.post<unknown>(`/api/gamification/rewards/grants/${id}/${decision}`, {}),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["curator"] });
    },
  });
}
