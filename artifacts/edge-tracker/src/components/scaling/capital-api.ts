/**
 * «Распределение риска» API (api-server routes/capital.ts, lib/capital). Keys live under ["scaling", …] so every scaling
 * mutation (approve / reject in the queue) refreshes the plan too, and the plan's mutations refresh the queue.
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { nyDate } from "@/lib/trading-date";

export type Direction = "raise" | "keep" | "cut";
export type Interval = { theta: number; lo: number; hi: number; n: number };
export type Interval80 = { mean: number; lo: number; hi: number };

export type CapitalRow = {
  trader: string;
  tierKey: string | null;
  direction: Direction;
  stepPct: number;
  current: { dailyLossLimit: number | null; buyingPower: number | null };
  proposed: { dailyLossLimit: number | null; buyingPower: number | null };
  band: { floor: number | null; cap: number | null };
  composite: number | null;
  expected: { perDay: number; sdPerDay: number } | null;
  pendingId: number | null;
  edge: { trades: number; days: number; r: Interval | null; usdPerDay: Interval | null; proven: boolean; negative: boolean };
  regime: { regime: string; days: number; usdPerDay: Interval | null } | null;
  discipline: number | null;
  /** Plain-words reasons in the reader's language, the decision first. */
  why: string[];
};

export type CapitalDesk = {
  traders: number;
  riskBefore: number;
  riskAfter: number;
  bpBefore: number;
  bpAfter: number;
  raised: { count: number; usd: number };
  cut: { count: number; usd: number };
  from: { trader: string; delta: number }[];
  to: { trader: string; delta: number }[];
  expectedPerDay: Interval80;
  expectedPerWeek: Interval80;
  deskCapApplied: boolean;
};

export type CapitalChange = { id: number; trader: string; action: string; actor: string; createdAt: string; before: { dailyLossLimit: number | null; buyingPower: number | null } | null; after: { dailyLossLimit: number | null; buyingPower: number | null } | null; reverted: boolean };

export type CapitalPlan = {
  asOf: string;
  regime: { key: string; source: "today" | "week" } | null;
  desk: CapitalDesk;
  settings: { maxDeskGrowthPct: number; autoApply: boolean; includeJuniors: boolean; minTrades: number };
  rows: CapitalRow[];
  history: CapitalChange[];
};

/** scaling_proposals.limits of a capital proposal (kind 'limits'). */
export type CapitalPayload = {
  direction: "raise" | "cut";
  stepPct: number;
  before: { dailyLossLimit: number | null; buyingPower: number | null };
  after: { dailyLossLimit: number | null; buyingPower: number | null };
};

export const capitalKeys = { plan: () => ["scaling", "capital", "plan"] as const };

export function useCapitalPlan(enabled = true) {
  return useQuery({
    queryKey: capitalKeys.plan(),
    queryFn: () => http.get<CapitalPlan>(`/api/capital/plan?date=${nyDate()}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["scaling"] });
    void qc.invalidateQueries({ queryKey: ["risk"] }); // limits changed ⇒ the risk desk refetches too
  };
}

export type RecomputeResult = { week: string; created: number; updated: number; unchanged: number; withdrawn: number; decidedThisWeek: number; applied: number; skipped: number };

export function useRecomputeCapital() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: () => http.post<RecomputeResult>("/api/capital/recompute", { date: nyDate() }), onSuccess: inv });
}

export function useApproveAllCapital() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (ids?: number[]) => http.post<{ approved: number[]; skipped: { id: number; code: string }[] }>("/api/capital/approve-all", ids?.length ? { ids } : {}),
    onSuccess: inv,
  });
}

export function useRevertCapital() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (historyId: number) => http.post<{ trader: string; historyId: number }>(`/api/capital/history/${historyId}/revert`, {}), onSuccess: inv });
}
