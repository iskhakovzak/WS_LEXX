/**
 * Optional behaviour flags of one trading day for the risk desk (moved out of use-risk.ts; re-exported from there).
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { addDays } from "@/lib/trading-date";

const REFRESH_MS = 60_000;

export type BehaviorFlags = {
  date: string;
  trades: number;
  /** Typical trades per day (median + k·MAD over 60 days), null when unknown. */
  norm: number | null;
  revenge: number;
  revengeCost: number | null;
  tilt: number;
  martingale: number;
  overtrading: boolean;
};

type BehaviorResp = {
  summary?: { trades?: number; tradesPerDayNorm?: number | null };
  patterns?: { key: string; n: number; net: number | null }[];
};

/**
 * Optional behaviour flags for one trading day from /api/behavior (raw fetch): revenge trades, tilt clusters,
 * size-up after loss, and trade count vs the trader's 60-day norm. Resolves to null when the API is unavailable.
 */
export function useBehaviorDay(trader: string | null, date: string | null, enabled = true) {
  return useQuery({
    queryKey: ["risk", "behavior", trader ?? "", date ?? ""] as const,
    enabled: enabled && !!trader && !!date,
    queryFn: async (): Promise<BehaviorFlags | null> => {
      const t = encodeURIComponent(trader ?? "");
      const d = date as string;
      const [day, hist] = await Promise.all([
        http.get<BehaviorResp>(`/api/behavior?trader=${t}&from=${d}&to=${d}`).catch(() => null),
        http.get<BehaviorResp>(`/api/behavior?trader=${t}&from=${addDays(d, -60)}&to=${d}`).catch(() => null),
      ]);
      if (!day) return null;
      const pat = (k: string) => day.patterns?.find((p) => p.key === k);
      const trades = day.summary?.trades ?? 0;
      const norm = hist?.summary?.tradesPerDayNorm ?? null;
      return {
        date: d,
        trades,
        norm,
        revenge: pat("revenge")?.n ?? 0,
        revengeCost: pat("revenge")?.net ?? null,
        tilt: pat("tilt")?.n ?? 0,
        martingale: pat("martingale")?.n ?? 0,
        overtrading: norm != null && trades > norm,
      };
    },
    staleTime: STALE.short,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
}
