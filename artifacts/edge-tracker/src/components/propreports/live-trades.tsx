/**
 * Live trades on open screens: the API pulls new PropReports fills every few seconds in desk hours (server
 * lib/propreports/live). This poller asks GET /api/propreports/live for the trade-book stamp — one tiny request, every
 * `pollMs` (5 s while live fills run, a minute otherwise), only while the tab is visible — and when the stamp moves it
 * invalidates every trade-derived query (lib/query-keys), so the mounted ones (trades list, dashboard, today, risk…)
 * refetch once instead of each polling on its own.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { invalidateTradeDependents } from "@/lib/query-keys";
import { useAuth } from "@/contexts/auth-context";

export type LiveStamp = { version: string; active: boolean; pollMs: number };

/** Not under any trade-dependent prefix: invalidating trades never refetches the stamp itself. */
export const LIVE_STAMP_KEY = ["propreports-live-stamp"] as const;
const IDLE_POLL_MS = 60_000;

/** True when the book moved since the stamp this tab saw (the first stamp only sets the baseline). */
export function stampMoved(seen: string | null, next: string | null | undefined): boolean {
  return seen != null && next != null && next !== seen;
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
    if (stampMoved(seen.current, version)) void invalidateTradeDependents(qc);
    seen.current = version;
  }, [version, qc]);
  return null;
}
