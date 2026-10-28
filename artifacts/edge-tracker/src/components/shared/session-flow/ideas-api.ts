/**
 * Idea tiers and setup checklists of the plan (api routes/ideas.ts, lib/sessionFlow/ideaStore.ts). The score is the
 * server's (recomputed on every save); the client only flips the tap at once and refetches.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { optimistic, toastMutationError } from "@/hooks/optimistic";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import type { UsdBlock } from "@/components/shared/strategy/model";

export type Tier = 1 | 2 | 3;
export type AutoKind = "gap" | "rvol" | "catalyst" | "analyst";
export type IdeaItem = { id: string; text: string; weight: number; auto?: AutoKind | null; checked: boolean; prefilled: boolean };
export type Score = { score: number; max: number; threshold: number; passed: boolean };
export type Idea = {
  trader: string; day: string; ticker: string; side: "long" | "short" | null; tier: Tier | null; authored: boolean; setupId: number | null;
  score: number | null; maxScore: number | null; threshold: number | null; setupName: string | null;
  checklist: { items: IdeaItem[]; score: Score | null } | null;
  risk: { usd: number | null; reduced: boolean; factor?: number };
  limits: { limited: boolean; maxLossUsd: number | null; noReentry: boolean };
};
export type DayIdeas = {
  trader: string; day: string; ideas: Idea[]; setups: { id: number; name: string; tier: Tier | null }[]; suggest: Record<string, { authored: boolean }>;
};
export type IdeaBody = { date: string; ticker: string; side?: "long" | "short" | null; tier?: Tier | null; authored?: boolean; setupId?: number | null; checks?: Record<string, boolean> };

export type IdeaStats = {
  trader: string; from: string; to: string; marked: number;
  tiers: (UsdBlock & { tier: "1" | "2" | "3" | "none" })[];
  bands: (UsdBlock & { band: "pass" | "near" | "low" | "none" })[];
  authored: UsdBlock;
  missed: { day: string; ticker: string; tier: 1 | 2; movePct: number }[];
};

export const IDEAS_DOMAIN = "ideas";
const dayKey = (date: string, ticker: string) => [IDEAS_DOMAIN, "day", "me", date, ticker] as const;

/** One ticker's idea of a day (own plan) with the setups to pick from and the prefill suggestion. */
export function ideaDayQuery(date: string, ticker: string) {
  return queryOptions({
    queryKey: dayKey(date, ticker),
    queryFn: ({ signal }) => http.get<DayIdeas>("/api/ideas/day", { query: { date, tickers: ticker }, signal }),
    staleTime: STALE.short,
  });
}

export function ideaStatsQuery(trader: string | null, from: string | null, to: string | null) {
  return queryOptions({
    queryKey: [IDEAS_DOMAIN, "stats", trader || "me", from, to] as const,
    queryFn: ({ signal }) => http.get<IdeaStats>("/api/ideas/stats", { query: { trader: trader || undefined, from: from || undefined, to: to || undefined }, signal }),
    staleTime: STALE.long,
  });
}

function patchIdea(old: DayIdeas, b: IdeaBody): DayIdeas {
  const cur = old.ideas.find((i) => i.ticker === b.ticker);
  const base: Idea = cur ?? {
    trader: old.trader, day: b.date, ticker: b.ticker, side: null, tier: null, authored: old.suggest[b.ticker]?.authored ?? false, setupId: null,
    score: null, maxScore: null, threshold: null, setupName: null, checklist: null, risk: { usd: null, reduced: false }, limits: { limited: false, maxLossUsd: null, noReentry: false },
  };
  const next: Idea = {
    ...base,
    ...(b.side !== undefined ? { side: b.side } : {}), ...(b.tier !== undefined ? { tier: b.tier } : {}),
    ...(b.authored !== undefined ? { authored: b.authored } : {}), ...(b.setupId !== undefined ? { setupId: b.setupId } : {}),
    checklist: base.checklist && b.checks ? { ...base.checklist, items: base.checklist.items.map((i) => (b.checks![i.id] !== undefined ? { ...i, checked: b.checks![i.id]!, prefilled: false } : i)) } : base.checklist,
  };
  return { ...old, ideas: cur ? old.ideas.map((i) => (i.ticker === b.ticker ? next : i)) : [...old.ideas, next] };
}

/** Saves one tap of the idea (tier / authored / setup / a checklist tick). Optimistic, then the server's score. */
export function useSaveIdea(date: string, ticker: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: IdeaBody) => http.put<unknown>("/api/ideas/mark", b),
    ...optimistic<IdeaBody, DayIdeas>(qc, {
      queryKey: dayKey(date, ticker),
      update: patchIdea,
      invalidate: [[IDEAS_DOMAIN, "stats"]],
      onError: (err) => toastMutationError(err, sessionFlowI18n.t("idea.saveFailed")),
    }),
  });
}
