/**
 * Live leak guard — requests (api routes/leak-guard.ts). Every key starts with LG_DOMAIN: one invalidation refreshes
 * the banner, «Мой риск» and the desk panel.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { POLL, STALE } from "@/lib/api/keys";
import type { GuardActive, GuardDesk, GuardEvent, GuardImpact, LevelChoice } from "./model";

export const LG_DOMAIN = "leak-guard";

/** The guard sees a new trigger at the next PropReports sync (minutes); the banner polls fast so it shows at once. */
export const activeGuardQuery = () =>
  queryOptions({
    queryKey: [LG_DOMAIN, "active"] as const,
    queryFn: ({ signal }) => http.get<GuardActive>("/api/leak-guard/me/active", { signal }),
    staleTime: STALE.live,
    refetchInterval: POLL.live,
  });

export const guardImpactQuery = (trader: string | null, days = 60) =>
  queryOptions({
    queryKey: [LG_DOMAIN, "impact", trader, days] as const,
    queryFn: ({ signal }) => http.get<GuardImpact>("/api/leak-guard/impact", { query: trader ? { trader, days } : { days }, signal }),
    staleTime: STALE.short,
  });

export const guardDeskQuery = (days = 30) =>
  queryOptions({
    queryKey: [LG_DOMAIN, "desk", days] as const,
    queryFn: ({ signal }) => http.get<GuardDesk>("/api/leak-guard/desk", { query: { days }, signal }),
    staleTime: STALE.live,
    refetchInterval: POLL.minute,
  });

export function useActiveGuard(enabled: boolean) {
  return useQuery({ ...activeGuardQuery(), enabled });
}

export function useAckGuard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<GuardEvent>(`/api/leak-guard/events/${id}/ack`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [LG_DOMAIN] }),
  });
}

export function useReleaseGuard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<GuardEvent>(`/api/leak-guard/events/${id}/release`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [LG_DOMAIN] }),
  });
}

export function useSetGuardLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (x: { trader: string; level: LevelChoice | null }) =>
      http.put<{ trader: string; override: LevelChoice | null }>(`/api/leak-guard/levels/${encodeURIComponent(x.trader)}`, { level: x.level }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [LG_DOMAIN] }),
  });
}
