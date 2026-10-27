/**
 * Edge map (roadmap R4) — GET /api/edge/map?trader= (api routes/coach.ts, lib/edgeMapStore.ts): the latest verdicts of
 * one trader, ≤ 3 per side, θ in $ per active day with its 80% interval. «Мой разбор» gets the same rows inside
 * /api/my-review (`edge`); the curator profile and the analytics «Эдж» tab read this endpoint.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type EdgeVerdict = {
  sliceKey: string;
  family: string;
  verdict: "LEAK" | "STRENGTH";
  n: number;
  days: number;
  perDay: number;
  perDayLo: number;
  perDayHi: number;
  thetaBps: number;
  persistBlocks: number;
};

export type EdgeMapView = { trader: string; asOf: string | null; earn: EdgeVerdict[]; lose: EdgeVerdict[] };

export const edgeMapKeys = { trader: (trader: string | null) => ["edge-map", trader ?? "me"] as const };

/** `trader` null / "" = the viewer's own map. */
export function useEdgeMap(trader: string | null, enabled = true) {
  return useQuery({
    queryKey: edgeMapKeys.trader(trader || null),
    queryFn: ({ signal }) => http.get<EdgeMapView>("/api/edge/map", { query: trader ? { trader } : {}, signal }),
    staleTime: STALE.long,
    enabled,
  });
}
