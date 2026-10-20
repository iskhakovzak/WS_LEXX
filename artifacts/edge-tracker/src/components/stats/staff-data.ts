/**
 * Data sources of /stats (Волна 2 п. 2.5): a trader reads his own raw trades (small, the page computes everything);
 * staff (whole desk / another trader) read server aggregates — GET /api/stats/aggregate for the period and, after it,
 * the equally long previous period (lite) for the deltas. Raw trades of a staff window are fetched only on demand
 * (CSV / print), never on open.
 */
import { useCallback } from "react";
import type { Trade } from "@workspace/api-client-react";
import { http } from "@/lib/api/http";
import { field, useStatsAggregate, type StatsAggregate } from "./aggregate";
import type { Metric, Range } from "./metrics";

/** Server aggregates of the period and of the previous one (staff view). */
export function useStaffAggregates(q: { cur: Range; prev: Range | null; trader: string | null; horizon: string | null; facets?: string }, enabled: boolean) {
  const base = { scope: q.trader ? ("trader" as const) : ("desk" as const), trader: q.trader, horizon: q.horizon, facets: q.facets };
  const cur = useStatsAggregate({ ...base, from: q.cur.from, to: q.cur.to }, enabled);
  const hasPrev = !!q.prev;
  const prev = useStatsAggregate({ ...base, from: q.prev?.from ?? null, to: q.prev?.to ?? null, lite: true }, enabled && hasPrev && cur.isSuccess && !cur.isPlaceholderData);
  const { refetch: refetchCur } = cur;
  const { refetch: refetchPrev } = prev;
  const refetch = useCallback(async () => {
    const r = await refetchCur();
    if (hasPrev) void refetchPrev();
    return r;
  }, [refetchCur, refetchPrev, hasPrev]);
  return {
    cur: cur.data as StatsAggregate | undefined,
    prev: hasPrev && prev.isSuccess && !prev.isPlaceholderData ? (prev.data as StatsAggregate) : null,
    isLoading: enabled && cur.isLoading,
    isError: enabled && cur.isError,
    isFetching: cur.isFetching || prev.isFetching,
    refetch,
    prevLoading: enabled && hasPrev && !(prev.isSuccess && !prev.isPlaceholderData) && !prev.isError,
  };
}

/** Which metric has more data (stats/metrics preferredMetric) from a bucket total. */
export function preferredMetricOfAggregate(a: StatsAggregate | undefined): Metric {
  if (!a) return "net";
  const usd = field(a.total, "pnlN"), r = field(a.total, "rN");
  return usd >= r && usd > 0 ? "net" : "r";
}

/** Raw trades of a staff window, fetched only for CSV / print (GET /api/trades, the same server window). */
export async function fetchWindowTrades(q: { from: string | null; to: string | null; trader: string | null }): Promise<Trade[]> {
  const query: Record<string, string> = { lite: "1" };
  if (q.from) query.from = q.from;
  if (q.to) query.to = q.to;
  if (q.trader) query.trader = q.trader;
  const rows = await http.get<Trade[]>("/api/trades", { query });
  return Array.isArray(rows) ? rows : [];
}
