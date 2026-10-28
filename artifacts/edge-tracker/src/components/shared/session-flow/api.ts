/**
 * Requests of the session-flow features (api routes/session-flow.ts). Every key starts with the trades domain: the
 * numbers are derived from PropReports trades, so a sync that writes trades refreshes them too.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { FlowStats } from "./model";

export const sessionFlowKeys = {
  stats: (trader: string | null, from: string | null, to: string | null) => ["trades", "session-flow", trader || "me", from, to] as const,
};

/** `trader` null = the viewer's own book; from / to = the analytics window (null = the api's default 90 days). */
export function flowStatsQuery(trader: string | null, from: string | null, to: string | null) {
  return queryOptions({
    queryKey: sessionFlowKeys.stats(trader, from, to),
    queryFn: ({ signal }) => http.get<FlowStats>("/api/session-flow/stats", { query: { trader: trader || undefined, from: from || undefined, to: to || undefined }, signal }),
    staleTime: STALE.long,
  });
}
