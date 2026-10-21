/**
 * Data sources of /stats (Волна 2 п. 2.5): one person's book — a trader's own, and for staff (= traders + extras,
 * owner rule 2026-10-21) their own by default or any picked person — is read as raw trades (the page computes
 * everything); only staff on «Вся команда» read server aggregates — GET /api/stats/aggregate for the period and, after
 * it, the equally long previous period (lite) for the deltas. Raw trades of the desk window are fetched only on demand
 * (CSV / print), never on open.
 */
import { useCallback } from "react";
import type { Trade } from "@workspace/api-client-react";
import { http } from "@/lib/api/http";
import { resolveTraderScope, type TraderScope } from "@/components/people/staff-scope";
import { field, useStatsAggregate, type StatsAggregate } from "./aggregate";
import type { Metric, Range } from "./metrics";

/**
 * Who /stats shows. `picked` is the stored pick ("all" = none → the viewer's own book); `team` the per-visit
 * «Вся команда». The aggregate path is `team` only — staff on one person (themselves included) get the trader path.
 */
export function statsScope(o: { staff: boolean; me: string | null | undefined; picked: string; team: boolean }): TraderScope {
  return resolveTraderScope({ staff: o.staff, me: o.me, picked: o.picked === "all" ? null : o.picked, team: o.team });
}

/** Server aggregates of the period and of the previous one (staff view of the whole team). */
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

/**
 * Raw trades of a staff window, fetched only for CSV / print (GET /api/trades, the same server window). `facets` is
 * the «Фильтры» selection (lib/trade-facets facetQuery, x* params); the caller still filters the rows client-side.
 */
export async function fetchWindowTrades(q: { from: string | null; to: string | null; trader: string | null; facets?: string }): Promise<Trade[]> {
  const query: Record<string, string> = { lite: "1" };
  if (q.facets) new URLSearchParams(q.facets).forEach((v, k) => { query[k] = v; });
  if (q.from) query.from = q.from;
  if (q.to) query.to = q.to;
  if (q.trader) query.trader = q.trader;
  const rows = await http.get<Trade[]>("/api/trades", { query });
  return Array.isArray(rows) ? rows : [];
}
