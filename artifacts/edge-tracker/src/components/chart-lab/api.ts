/**
 * Data of the lab's multi-trade views (api routes/chart-lab.ts): the picker's setups / tickers, the entry overlay and the
 * exit analysis. Bars come from the candle archive only — the server reports days it does not have, never fetches them.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";

export type LabPick = { kind: "setup" | "ticker"; name: string } | null;
export type OverlayUnit = "pct" | "r";

export type LabFacets = { trader: string; setups: { name: string; n: number }[]; tickers: { name: string; n: number }[] };

export type OverlayResponse = {
  trader: string; setup: string | null; ticker: string | null; total: number; withRisk: number;
  unit: OverlayUnit;
  minutes: number[];
  paths: { id: number; values: (number | null)[]; win: boolean | null }[];
  mean: (number | null)[]; p25: (number | null)[]; p75: (number | null)[]; p10: (number | null)[]; p90: (number | null)[];
  mfe: { p25: (number | null)[]; p50: (number | null)[]; p75: (number | null)[] };
  mae: { p25: (number | null)[]; p50: (number | null)[]; p75: (number | null)[] };
  n: number[];
  missing: number;
  /** Entries whose day is archived only in bars coarser than 5 minutes (left out; absent on older builds). */
  coarse?: number;
  trades: number;
};

export type ExitVariant = string;
export type VariantStat = {
  variant: ExitVariant; n: number; meanDelta: number | null; totalDelta: number | null; ci: { lo: number; hi: number } | null;
  meanR: number | null; winRate: number | null; q: number | null; verdict: "better" | "worse" | "same" | "few";
};
export type SetupExits = { setup: string; trades: number; missing: number; coarse?: number; variants: VariantStat[]; best: ExitVariant | null };
export type ExitsResponse = { trader: string; setup: string | null; ticker: string | null; total: number; withRisk: number; all: SetupExits; bySetup: SetupExits[] };

function params(trader: string, pick: LabPick, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams(extra);
  if (trader) sp.set("trader", trader);
  if (pick) sp.set(pick.kind, pick.name);
  return sp.toString();
}

export function useLabFacets(trader: string, enabled = true) {
  const url = `/api/chart-lab/facets?${params(trader, null)}`;
  return useQuery<LabFacets>({
    queryKey: ["chart-lab", "facets", url], enabled, staleTime: 5 * 60_000,
    queryFn: () => http.get<LabFacets>(url),
  });
}

export function useLabOverlay(trader: string, pick: LabPick, unit: OverlayUnit, enabled = true) {
  const url = `/api/chart-lab/overlay?${params(trader, pick, { unit })}`;
  return useQuery<OverlayResponse>({
    queryKey: ["chart-lab", "overlay", url], enabled: enabled && pick != null, staleTime: 5 * 60_000, placeholderData: keepPreviousData,
    queryFn: () => http.get<OverlayResponse>(url),
  });
}

/** `pick` null = every setup of the trader (grouped per setup by the server). */
export function useLabExits(trader: string, pick: LabPick, enabled = true) {
  const url = `/api/chart-lab/exits?${params(trader, pick)}`;
  return useQuery<ExitsResponse>({
    queryKey: ["chart-lab", "exits", url], enabled, staleTime: 5 * 60_000, placeholderData: keepPreviousData,
    queryFn: () => http.get<ExitsResponse>(url),
  });
}
