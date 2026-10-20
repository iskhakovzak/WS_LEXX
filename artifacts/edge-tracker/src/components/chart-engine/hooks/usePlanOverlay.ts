/**
 * The morning plan's levels and the setup label of a trade (or of the viewer's own ticker-day):
 * GET /api/chart/plan-overlay?trade=<id> | ?ticker=&date= (Волна 2 п. 2.12). An older server without the route, someone
 * else's trade (403) or no plan → null / no levels; the chart simply shows none.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import type { PlanOverlay } from "../lib/plan-levels";

export function usePlanOverlay(target: { tradeId: number } | { ticker: string; date: string } | null): PlanOverlay | null {
  const key = target ? ("tradeId" in target ? ["plan-overlay", "trade", target.tradeId] : ["plan-overlay", target.ticker.toUpperCase(), target.date]) : ["plan-overlay", "none"];
  const q = useQuery<PlanOverlay | null>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!target) return null;
      const query = "tradeId" in target ? { trade: target.tradeId } : { ticker: target.ticker.toUpperCase(), date: target.date };
      try {
        return await http.get<PlanOverlay>("/api/chart/plan-overlay", { query, signal });
      } catch {
        return null;
      }
    },
    enabled: !!target && (!("tradeId" in target) || target.tradeId > 0),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  return q.data ?? null;
}
