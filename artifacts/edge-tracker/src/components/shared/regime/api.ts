/**
 * Desk market regime — requests (api routes/market-regime.ts) and the morning suggestion hook. Every key starts with
 * REGIME_DOMAIN, so one invalidation refreshes the tile, the plan / risk headers, the playbook filter and the edge.
 */
import { useMemo } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { nyDate } from "@/lib/trading-date";
import type { RegimeKey } from "@/lib/market-regime";
import { buildFrame } from "@/components/shared/market/engine";
import { useMarketData } from "@/components/shared/market/useMarketData";
import { nyMinutes, sessionInProgress } from "@/components/shared/market/session";
import { suggestRegime, suggestionIndex, type RegimeSuggestion } from "@/components/shared/market/regime-suggest";

export const REGIME_DOMAIN = "market-regime";

export type RegimeDay = {
  day: string;
  regime: RegimeKey;
  note: string | null;
  setBy: string;
  autoSuggested: boolean;
  suggestion: RegimeSuggestion | null;
  updatedAt: string;
};

export type RegimeToday = {
  date: string;
  day: RegimeDay | null;
  multiplier: number;
  multipliers: Record<RegimeKey, number>;
  /** Settings regime.applyLimits: the stops count against base × multiplier. */
  applyLimits: boolean;
  canSet: boolean;
  /** The viewer's own daily loss limit (null = no limits set). */
  limit: { base: number | null; suggested: number | null } | null;
  /** The season calendar of the day (api lib/sessionFlow/season); absent on older API builds. */
  season?: SeasonDay;
};

export type SeasonEvent = "quad_witching" | "sp_rebalance" | "msci_rebalance";
export type SeasonDay = {
  day: string; offSeason: boolean; prime: boolean; events: SeasonEvent[]; holidayEve: boolean; quiet: boolean; factor: number; trim: boolean;
};

export type Interval = { point: number; lo: number; hi: number };
export type EdgeStatus = "reliable" | "hypothesis" | "low";
export type RegimeEdgeRow = {
  regime: RegimeKey;
  trades: number;
  days: number;
  net: number;
  winRate: number | null;
  perDay: Interval;
  perTrade: Interval;
  expectancyR: number | null;
  rTrades: number;
  status: EdgeStatus;
};
export type RegimeEdge = {
  trader: string;
  rows: RegimeEdgeRow[];
  coverage: { known: number; total: number };
  leak: RegimeKey | null;
  strength: RegimeKey | null;
  today: RegimeKey | null;
};

export type ReflectionQuestion = "recognize" | "playbooks" | "risk";
export const REFLECTION_QUESTIONS: readonly ReflectionQuestion[] = ["recognize", "playbooks", "risk"];
export type ReflectionAnswers = Partial<Record<RegimeKey, Partial<Record<ReflectionQuestion, string>>>>;
export type Reflection = {
  trader: string;
  week: string;
  answers: ReflectionAnswers;
  prefilledFrom: string | null;
  updatedAt: string | null;
  canEdit: boolean;
};

export const regimeTodayQuery = (date: string = nyDate()) =>
  queryOptions({
    queryKey: [REGIME_DOMAIN, "today", date] as const,
    queryFn: ({ signal }) => http.get<RegimeToday>("/api/market-regime/today", { query: { date }, signal }),
    staleTime: STALE.short,
  });

export const regimeEdgeQuery = (trader: string | null) =>
  queryOptions({
    queryKey: [REGIME_DOMAIN, "edge", trader] as const,
    queryFn: ({ signal }) => http.get<RegimeEdge>("/api/market-regime/edge", { query: trader ? { trader } : {}, signal }),
    staleTime: STALE.long,
  });

export const reflectionQuery = (trader: string | null, week: string) =>
  queryOptions({
    queryKey: [REGIME_DOMAIN, "reflection", trader, week] as const,
    queryFn: ({ signal }) => http.get<Reflection>("/api/market-regime/reflection", { query: trader ? { trader, week } : { week }, signal }),
    staleTime: STALE.long,
  });

export function useRegimeToday(date?: string, enabled = true) {
  return useQuery({ ...regimeTodayQuery(date), enabled });
}

/** Set / change the regime of a day (regime.set). Refreshes every regime view and the risk numbers (limits may change). */
export function useSetRegime(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { regime: RegimeKey; note?: string | null; suggestion?: RegimeSuggestion | null }) =>
      http.put<RegimeDay>(`/api/market-regime/day/${date}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [REGIME_DOMAIN] });
      void qc.invalidateQueries({ queryKey: ["risk"] });
    },
  });
}

export function useSaveReflection(trader: string | null, week: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: ReflectionAnswers) => http.put<Omit<Reflection, "canEdit">>("/api/market-regime/reflection", { week, answers }),
    onSuccess: (r) => qc.setQueryData(reflectionQuery(trader, week).queryKey, (prev) => (prev ? { ...prev, ...r } : prev)),
  });
}

export function useSetPlaybookRegimes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (x: { id: number; regimes: RegimeKey[] }) => http.put<{ id: number; regimes: RegimeKey[] }>(`/api/market-regime/playbook/${x.id}/regimes`, { regimes: x.regimes }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["playbook"] }),
  });
}

/**
 * The engine's suggestion for the next / current session (pre-open state = the last final close). Loads the market
 * frame only when `enabled` (staff who may confirm, while the day has no regime or the picker is open).
 */
export function useRegimeSuggestion(enabled: boolean): { suggestion: RegimeSuggestion | null; isLoading: boolean } {
  const market = useMarketData({ enabled });
  const rows = useMemo(() => (enabled ? buildFrame(market.data) : []), [enabled, market.data]);
  const suggestion = useMemo(() => {
    if (!rows.length) return null;
    const live = sessionInProgress(rows[rows.length - 1].d, nyDate(), nyMinutes());
    const i = suggestionIndex(rows, live);
    return i >= 0 ? suggestRegime(rows, i) : null;
  }, [rows]);
  return { suggestion, isLoading: enabled && market.isLoading };
}
