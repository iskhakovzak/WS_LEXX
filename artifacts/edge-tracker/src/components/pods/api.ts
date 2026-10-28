/**
 * Trading pods (api routes/pods.ts, lib/pods/*): queryOptions + mutations. Keys start with "pods".
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type PodMember = { id: number; name: string };
export type Pod = { id: number; groupId: number; groupName: string; curatorId: number | null; name: string; members: PodMember[]; createdAt: string };
export type ManagedGroup = { id: number; name: string; curatorId: number | null; traders: PodMember[] };
export type PodsHome = { mine: Pod | null; managed: { groups: ManagedGroup[]; pods: Pod[] } | null; limits: { min: number; max: number } };

export type MemberRow = { trader: string; trades: number; wins: number; losses: number; net: number | null; winRate: number | null; avgR: number | null };
export type PodStats = {
  podId: number; from: string; to: string; members: MemberRow[]; active: number; netVisible: boolean;
  sum: { trades: number; wins: number; losses: number; winRate: number | null; net: number | null };
  median: { trades: number | null; winRate: number | null; avgR: number | null; net: number | null };
};
export type PodPost = { id: number; kind: "post" | "review"; week: string | null; body: string; author: string; updatedBy: string | null; createdAt: string; updatedAt: string };

export const podKeys = {
  home: () => ["pods", "home"] as const,
  stats: (id: number, from: string, to: string) => ["pods", "stats", id, from, to] as const,
  feed: (id: number) => ["pods", "feed", id] as const,
  review: (id: number, week: string) => ["pods", "review", id, week] as const,
};

export const podsHomeQuery = () => queryOptions({
  queryKey: podKeys.home(),
  queryFn: ({ signal }) => http.get<PodsHome>("/api/pods", { signal }),
  staleTime: STALE.long,
});
export const podStatsQuery = (id: number, from: string, to: string) => queryOptions({
  queryKey: podKeys.stats(id, from, to),
  queryFn: ({ signal }) => http.get<PodStats>(`/api/pods/${id}/stats`, { query: { from, to }, signal }),
  staleTime: STALE.short,
});
export const podFeedQuery = (id: number) => queryOptions({
  queryKey: podKeys.feed(id),
  queryFn: ({ signal }) => http.get<{ posts: PodPost[]; canPost: boolean }>(`/api/pods/${id}/feed`, { signal }),
  staleTime: STALE.short,
});
export const podReviewQuery = (id: number, week: string) => queryOptions({
  queryKey: podKeys.review(id, week),
  queryFn: ({ signal }) => http.get<{ week: string; review: PodPost | null; canEdit: boolean }>(`/api/pods/${id}/review`, { query: { week }, signal }),
  staleTime: STALE.short,
});

export function usePodMutations(podId: number | null) {
  const qc = useQueryClient();
  const home = () => void qc.invalidateQueries({ queryKey: ["pods"] });
  return {
    create: useMutation({ mutationFn: (b: { groupId: number; name: string; memberIds: number[] }) => http.post<Pod>("/api/pods", b), onSuccess: home }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: number; name?: string; memberIds?: number[]; archived?: true }) => http.patch(`/api/pods/${id}`, b), onSuccess: home }),
    post: useMutation({
      mutationFn: (body: string) => http.post<PodPost>(`/api/pods/${podId}/feed`, { body }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: podKeys.feed(podId ?? 0) }),
    }),
    removePost: useMutation({
      mutationFn: (postId: number) => http.del(`/api/pods/${podId}/feed/${postId}`),
      onSuccess: () => void qc.invalidateQueries({ queryKey: podKeys.feed(podId ?? 0) }),
    }),
    saveReview: useMutation({
      mutationFn: (b: { week: string; body: string }) => http.put<PodPost>(`/api/pods/${podId}/review`, b),
      onSuccess: (_r, b) => void qc.invalidateQueries({ queryKey: podKeys.review(podId ?? 0, b.week) }),
    }),
  };
}
