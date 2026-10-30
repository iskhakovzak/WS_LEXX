/**
 * Live trades on open screens: the API pulls new PropReports fills every few seconds in desk hours (server
 * lib/propreports/live). This poller asks GET /api/propreports/live for the trade-book stamp — one tiny request, every
 * `pollMs` (5 s while live fills run, a minute otherwise), only while the tab is visible — and when the stamp moves it
 * invalidates every trade-derived query (lib/query-keys), so the mounted ones (trades list, dashboard, today, risk…)
 * refetch once instead of each polling on its own.
 *
 * Risk signals: the API scans the changed traders right after the cycle that moved the stamp (server
 * lib/riskSignals/live.ts), so the alert strip / desk panel are asked again ALERTS_AFTER_STAMP_MS later — on top of
 * their own 5 s poll — and a new alert shows within seconds of the fill.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { invalidateTradeDependents, riskSignalKeys } from "@/lib/query-keys";
import { useAuth } from "@/contexts/auth-context";

export type LiveStamp = { version: string; active: boolean; pollMs: number };

/** Not under any trade-dependent prefix: invalidating trades never refetches the stamp itself. */
export const LIVE_STAMP_KEY = ["propreports-live-stamp"] as const;
const IDLE_POLL_MS = 60_000;

/** True when the book moved since the stamp this tab saw (the first stamp only sets the baseline). */
export function stampMoved(seen: string | null, next: string | null | undefined): boolean {
  return seen != null && next != null && next !== seen;
}

/** The server's risk scan of the changed traders starts when the cycle that moved the stamp ends (~0.1–1 s). */
export const ALERTS_AFTER_STAMP_MS = 1_500;

/** The book moved: refetch trade screens now, the live alerts once the server's scan has run. Returns a cancel. */
export function refreshOnStamp(qc: QueryClient): () => void {
  void invalidateTradeDependents(qc);
  const t = setTimeout(() => {
    void qc.invalidateQueries({ queryKey: riskSignalKeys.meAll });
    void qc.invalidateQueries({ queryKey: riskSignalKeys.desk });
  }, ALERTS_AFTER_STAMP_MS);
  return () => clearTimeout(t);
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}

export function LiveTradesSync(): null {
  const { user } = useAuth();
  const visible = useDocumentVisible();
  const qc = useQueryClient();
  const signedIn = !!user && user.role !== "guest";
  const q = useQuery({
    queryKey: LIVE_STAMP_KEY,
    queryFn: () => http.get<LiveStamp>("/api/propreports/live"),
    enabled: signedIn,
    refetchInterval: (query) => (visible ? Math.max(2_000, query.state.data?.pollMs ?? IDLE_POLL_MS) : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });
  const seen = useRef<string | null>(null);
  const version = q.data?.version ?? null;
  useEffect(() => {
    if (version == null) return;
    const moved = stampMoved(seen.current, version);
    seen.current = version;
    // A newer stamp replaces the pending alerts refresh (its own one follows); unmount cancels it.
    return moved ? refreshOnStamp(qc) : undefined;
  }, [version, qc]);
  return null;
}
