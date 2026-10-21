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

/** The 60-day trades-per-day norm barely moves within a day: fetched once, kept for half an hour, never polled. */
const NORM_STALE_MS = 30 * 60_000;

function useBehaviorNorm(trader: string | null, date: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["risk", "behavior-norm", trader ?? "", date ?? ""] as const,
    enabled: enabled && !!trader && !!date,
    queryFn: async (): Promise<number | null> => {
      const d = date as string;
      const hist = await http
        .get<BehaviorResp>(`/api/behavior?trader=${encodeURIComponent(trader ?? "")}&from=${addDays(d, -60)}&to=${d}`)
        .catch(() => null);
      return hist?.summary?.tradesPerDayNorm ?? null;
    },
    staleTime: NORM_STALE_MS,
    retry: 0,
  });
}

/**
 * Optional behaviour flags for one trading day from /api/behavior (raw fetch): revenge trades, tilt clusters,
 * size-up after loss, and trade count vs the trader's 60-day norm. Resolves to null when the API is unavailable.
 * Only the day itself polls (every minute); the 60-day norm is its own slow query (useBehaviorNorm).
 */
export function useBehaviorDay(trader: string | null, date: string | null, enabled = true) {
  const norm = useBehaviorNorm(trader, date, enabled).data ?? null;
  return useQuery({
    queryKey: ["risk", "behavior", trader ?? "", date ?? ""] as const,
    enabled: enabled && !!trader && !!date,
    queryFn: async (): Promise<BehaviorResp | null> =>
      http.get<BehaviorResp>(`/api/behavior?trader=${encodeURIComponent(trader ?? "")}&from=${date}&to=${date}`).catch(() => null),
    select: (day): BehaviorFlags | null => {
      if (!day) return null;
      const pat = (k: string) => day.patterns?.find((p) => p.key === k);
      const trades = day.summary?.trades ?? 0;
      return {
        date: date as string,
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
