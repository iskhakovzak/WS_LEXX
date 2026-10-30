/**
 * Live risk signals — requests (api routes/risk-signals.ts). Every key starts with RS_DOMAIN: one invalidation refreshes
 * the dashboard strip and the risk desk panel.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { POLL, STALE } from "@/lib/api/keys";
import { RISK_SIGNALS_DOMAIN, riskSignalKeys } from "@/lib/query-keys";
import { LIVE_POLL_MS, livePollInterval, type AlertsDay, type RiskAlert, type SavedPeriod, type SavedSummary } from "./model";

export const RS_DOMAIN = RISK_SIGNALS_DOMAIN;

/** The trader's own alerts of today: every 5 s while the page is visible in desk hours, no polling outside them. */
export const myAlertsQuery = (trader: string | null) =>
  queryOptions({
    queryKey: riskSignalKeys.me(trader),
    queryFn: ({ signal }) => http.get<AlertsDay>("/api/risk-signals/me", { query: trader ? { trader } : {}, signal }),
    staleTime: LIVE_POLL_MS - 500,
    refetchInterval: () => livePollInterval(),
  });

export const deskAlertsQuery = () =>
  queryOptions({
    queryKey: riskSignalKeys.desk,
    queryFn: ({ signal }) => http.get<AlertsDay>("/api/risk-signals/desk", { signal }),
    staleTime: STALE.live,
    refetchInterval: () => (livePollInterval() ? POLL.live : false),
  });

export const savedQuery = (period: SavedPeriod) =>
  queryOptions({
    queryKey: [RS_DOMAIN, "saved", period] as const,
    queryFn: ({ signal }) => http.get<SavedSummary>("/api/risk-signals/saved", { query: { period }, signal }),
    staleTime: STALE.short,
  });

export function useMyAlerts(trader: string | null, enabled: boolean) {
  return useQuery({ ...myAlertsQuery(trader), enabled });
}

export function useSeenAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<RiskAlert>(`/api/risk-signals/${id}/seen`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [RS_DOMAIN] }),
  });
}
