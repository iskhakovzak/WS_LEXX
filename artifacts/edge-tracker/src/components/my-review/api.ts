/**
 * «Мой разбор» (Волна 2 п. 2.9) — GET /api/my-review?days= (api routes/my-review.ts, lib/myReview.ts): the viewer's own
 * trades of the last N days → where I earn, where I lose, one rule for tomorrow. Mirror of the server's MyReview.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type ReviewDimension = "setup" | "ticker" | "hour";

export type ReviewBucket = { key: string; trades: number; net: number; r: number | null; winRate: number | null };

export type ReviewPattern = { mistake: string; costNet: number; count: number; days: number };

export type MyReview = {
  trader: string;
  days: number;
  from: string;
  to: string;
  totals: { trades: number; net: number; r: number | null; winRate: number | null };
  earn: Record<ReviewDimension, ReviewBucket[]>;
  lose: { patterns: ReviewPattern[] } & Record<ReviewDimension, ReviewBucket[]>;
  rule: { mistake: string; costNet: number; count: number; days: number; window: { from: string; to: string }; source: "plan" | "period" } | null;
  generatedAt: string;
};

export const myReviewKeys = { all: ["my-review"] as const, days: (days: number) => ["my-review", days] as const };

export function useMyReview(days: number) {
  return useQuery<MyReview>({
    queryKey: myReviewKeys.days(days),
    queryFn: ({ signal }) => http.get<MyReview>("/api/my-review", { query: { days: String(days) }, signal }),
    staleTime: STALE.short,
    placeholderData: keepPreviousData,
  });
}
