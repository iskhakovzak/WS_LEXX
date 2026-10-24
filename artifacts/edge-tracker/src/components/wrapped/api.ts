/**
 * Data of «Итоги недели / месяца». No endpoint of its own: four existing read-only APIs, always for the signed-in
 * trader only (no trader picker — a story card carries the owner's result out of the desk):
 *
 *   GET /api/stats/aggregate?scope=trader&from&to   net, trading days, green / red days, the best trade (extremes)
 *   GET /api/behavior?trader&from&to                setup and hour aggregates (profile), the costliest habit (patterns)
 *   GET /api/weekly-review?trader&week              per week: days, violations / mistakes, clean streak, goals, focus
 *   GET /api/academy/path/report                    readiness for the next stage (criteria)
 *
 * The types below are the slices this feature reads (mirrors of routes/stats-aggregate.ts, routes/behavior.ts,
 * routes/weekly-review.ts, lib/promotionEngine.ts). Query keys are the owning pages' keys, so an opened page makes the
 * story instant and vice versa (errors are not swallowed into the shared cache). A failed source reads as null: the
 * story just drops that card.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { WrappedPeriod } from "./period";

// ── /stats/aggregate ─────────────────────────────────────────────────────────
export type AggBucket = number[];
export type AggTrade = {
  id: number; ticker: string | null; date: string | null; exitDate: string | null; result: string | null; side: string | null;
  setup: string | null; entry: number | null; exit: number | null; stop: number | null; rMultiple: number | null;
  pnl: number | null; fees: number | null; riskUsd: number | null; horizon: string | null;
};
export type StatsSlice = {
  money: boolean;
  fields: readonly string[];
  total: AggBucket;
  days: Array<{ key: string; b: AggBucket }>;
  extremes?: Partial<Record<"r" | "usd" | "net", { best: number[]; worst: number[] }>>;
  trades?: AggTrade[];
};

// ── /behavior ────────────────────────────────────────────────────────────────
export type BehaviorBucket = { label: string; n: number; net: number | null; avgNet: number | null; winRate: number | null };
export type BehaviorPatternSlice = {
  key: string; title: string; n: number; days: number; cost: number | null; rule?: string;
  insight?: { recommendation?: string; ruleText?: string } | null;
};
export type BehaviorSlice = {
  patterns?: BehaviorPatternSlice[];
  byHour?: BehaviorBucket[];
  profile?: {
    hours?: { best: BehaviorBucket | null };
    setups?: { best: BehaviorBucket | null; rows?: BehaviorBucket[] };
  };
};

// ── /weekly-review ───────────────────────────────────────────────────────────
type Linked = { tradeId: number | null; tradeDate: string | null; tradeNet: number | null; tradeR: number | null };
export type WeekGoal = { id: string; text: string; status: "open" | "done" | "partial" | "missed" };
export type WeeklySlice = {
  week: { key: string; start: string; end: string };
  days: Array<{ date: string; trades: number }>;
  violations: { items: Linked[] };
  mistakes: { items: Linked[] };
  discipline: { cleanDays: number; cleanStreak: number; tradingDays: number };
  review: { goals?: WeekGoal[]; selfReview?: { focus?: string } } | null;
};

// ── /academy/path/report ─────────────────────────────────────────────────────
export type ReadinessCriterion = { id: number; label: string; display: string; targetDisplay: string; status: "pass" | "fail" | "na"; progress: number };
export type ReadinessSlice = {
  stage: { key: string; name: string } | null;
  nextStage: { key: string; name: string } | null;
  passed: number; total: number; ready: boolean;
  criteria: ReadinessCriterion[];
};

export type WrappedSources = {
  stats: StatsSlice | null;
  behavior: BehaviorSlice | null;
  weeks: WeeklySlice[];
  readiness: ReadinessSlice | null;
  loading: boolean;
};

/** Everything the story needs for `period` of `trader` (the signed-in user). */
export function useWrappedSources(trader: string | null, period: WrappedPeriod | null): WrappedSources {
  const on = !!trader && !!period;
  const from = period?.from ?? "";
  const to = period?.to ?? "";
  // Same key shapes as stats/aggregate.ts useStatsAggregate, behavior/api.ts useBehavior, weekly-review/api.ts
  // useWeeklyReview and academy/path/api.ts useReport.
  const statsParams = { scope: "trader", trader: trader ?? "", from, to };
  const stats = useQuery({
    queryKey: ["stats-aggregate", statsParams],
    queryFn: ({ signal }) => http.get<StatsSlice>("/api/stats/aggregate", { query: statsParams, signal }),
    enabled: on,
    staleTime: STALE.short,
    retry: 1,
  });
  const behavior = useQuery({
    queryKey: ["behavior", "report", trader ?? "", from, to, ""],
    queryFn: ({ signal }) => http.get<BehaviorSlice>("/api/behavior", { query: { trader: trader ?? "", from, to }, signal }),
    enabled: on,
    staleTime: 60_000,
    retry: 1,
  });
  const weeks = useQueries({
    queries: (period?.weeks ?? []).map((week) => ({
      queryKey: ["weekly-review", "doc", trader ?? "", week],
      queryFn: () => http.get<WeeklySlice>(`/api/weekly-review?trader=${encodeURIComponent(trader ?? "")}&week=${encodeURIComponent(week)}`),
      enabled: on,
      staleTime: 30_000,
      retry: 1,
    })),
    combine: combineWeeks,
  });
  const readiness = useQuery({
    queryKey: ["academy-path", "report", "me"],
    queryFn: () => http.get<{ report: ReadinessSlice | null }>("/api/academy/path/report"),
    enabled: on,
    retry: 1,
  });
  return {
    stats: stats.isError ? null : stats.data ?? null,
    behavior: behavior.isError ? null : behavior.data ?? null,
    weeks: weeks.docs,
    readiness: readiness.isError ? null : readiness.data?.report ?? null,
    loading: on && (stats.isLoading || behavior.isLoading || readiness.isLoading || weeks.loading),
  };
}

// Module-level so react-query keeps the combined result stable between renders (the story redraws only on new data).
function combineWeeks(results: Array<{ data?: WeeklySlice; isError: boolean; isLoading: boolean }>) {
  return {
    docs: results.filter((w) => !w.isError).map((w) => w.data).filter((d): d is WeeklySlice => !!d && !!d.week),
    loading: results.some((w) => w.isLoading),
  };
}

/** Did the trader close any trade in the period? (the dashboard line asks before offering the story). */
export function usePeriodHasTrades(trader: string | null, period: WrappedPeriod | null): boolean {
  const params = { scope: "trader", trader: trader ?? "", from: period?.from ?? "", to: period?.to ?? "", lite: "1" };
  const q = useQuery({
    queryKey: ["stats-aggregate", params],
    queryFn: ({ signal }) => http.get<StatsSlice>("/api/stats/aggregate", { query: params, signal }),
    enabled: !!trader && !!period,
    staleTime: STALE.long,
    retry: false,
  });
  const fields = q.data?.fields ?? [];
  const i = fields.indexOf("closed");
  return i >= 0 && (q.data?.total[i] ?? 0) > 0;
}
