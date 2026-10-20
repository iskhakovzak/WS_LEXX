/**
 * Finviz Elite — web data layer (finviz/CONTRACT.md). Every reader goes through `useFinvizStatus()` first: with the
 * feature off (no FINVIZ_AUTH on the server) nothing else is requested and the widgets show «Finviz не подключён» or
 * hide. Data is read from the server's DB cache (jobs refresh it), so the client never polls hard.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { KEYS, POLL, STALE } from "@/lib/api/keys";
import type { EarningsRow, FinvizStatus, ScreenerPreset, ScreenerResponse, TickerSnapshot } from "./model";

export const finvizKeys = {
  all: ["finviz"] as const,
  status: () => ["finviz", "status"] as const,
  screener: (preset: ScreenerPreset) => ["finviz", "screener", preset] as const,
  ticker: (symbol: string) => ["finviz", "ticker", symbol] as const,
  earnings: (from: string, to: string) => ["finviz", "earnings", from, to] as const,
};

export const finvizStatusQuery = () =>
  queryOptions({
    queryKey: finvizKeys.status(),
    queryFn: ({ signal }) => http.get<FinvizStatus>("/api/finviz/status", { signal }),
    staleTime: STALE.long,
    retry: false,
    meta: { i18n: false },
  });

/** `on`: the feature is connected; `off`: not connected (or the status is unreadable); `loading` while asking. */
export function useFinvizStatus(): { state: "loading" | "on" | "off"; status: FinvizStatus | null } {
  const q = useQuery(finvizStatusQuery());
  if (q.isLoading) return { state: "loading", status: null };
  const status = q.data ?? null;
  return { state: status?.enabled ? "on" : "off", status };
}

export const screenerQuery = (preset: ScreenerPreset, poll: boolean) =>
  queryOptions({
    queryKey: finvizKeys.screener(preset),
    queryFn: ({ signal }) => http.get<ScreenerResponse>("/api/finviz/screener", { query: { preset }, signal }),
    staleTime: STALE.short,
    // Before the open the server re-screens every 5 minutes; the card follows while it is on screen.
    refetchInterval: poll ? POLL.fiveMinutes : false,
    meta: { i18n: false },
  });

export const tickerSnapshotQuery = (symbol: string) =>
  queryOptions({
    queryKey: finvizKeys.ticker(symbol),
    queryFn: ({ signal }) => http.get<TickerSnapshot | null>(`/api/finviz/ticker/${encodeURIComponent(symbol)}`, { signal }),
    // null = not snapshotted yet: the server queues it and fills it within ~15 min, so ask again sooner.
    staleTime: (q) => (q.state.data === null ? STALE.long : STALE.day),
    retry: 1,
    meta: { i18n: false },
  });

/** One cached range answers every earnings badge of a day (plan tickers, screener rows, trade sheet). */
export const earningsRangeQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: finvizKeys.earnings(from, to),
    queryFn: ({ signal }) => http.get<EarningsRow[]>("/api/finviz/earnings", { query: { from, to }, signal }),
    staleTime: STALE.long,
    retry: 1,
    meta: { i18n: false },
  });

/** Staff: re-screen now (the server keeps a cooldown and answers 429 inside it). */
export function useFinvizRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<{ kind: string; status: string; nextAllowedAt: string }>("/api/finviz/refresh", { kind: "screener" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: finvizKeys.all }),
  });
}

type MyPlanRes = { date: string; plan: { status?: "draft" | "ready"; doc?: Record<string, unknown> | null } | null; prevDate?: string | null } | null;

/** Tickers of the viewer's personal plan for `date` (shares the plan editor's cache entry). */
export function usePlanTickerDoc(date: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.myPlan(date),
    queryFn: ({ signal }) => http.get<MyPlanRes>("/api/game-plan/my", { query: { date }, signal }),
    staleTime: STALE.short,
    enabled,
    retry: false,
    select: (r) => r?.plan?.doc ?? null,
  });
}
