/**
 * Requests of the session-flow features (api routes/session-flow.ts). Every key starts with the trades domain: the
 * numbers are derived from PropReports trades, so a sync that writes trades refreshes them too.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { optimistic, toastMutationError } from "@/hooks/optimistic";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import type { FlowStats } from "./model";
import type { Timing } from "./timing";

/** Saves a setup's allowed timings (PATCH /api/playbook/:id { timings }). Optimistic: the chip flips at once. */
export function useSaveTimings(setupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (timings: Timing[]) => http.patch<{ timings: Timing[] | null }>(`/api/playbook/${setupId}`, { timings }),
    ...optimistic<Timing[], unknown>(qc, {
      queryKey: ["playbook"],
      update: (old, timings) => (Array.isArray(old) ? old.map((e) => (e && typeof e === "object" && (e as { id?: number }).id === setupId ? { ...e, timings } : e)) : old),
      invalidate: [["playbook-children"]],
      onError: (err) => toastMutationError(err, sessionFlowI18n.t("matrix.saveFailed")),
    }),
  });
}

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
