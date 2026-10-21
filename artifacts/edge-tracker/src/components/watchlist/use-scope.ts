/**
 * «Свой / Деска» (Волна 1, item 1.18): which of the two watchlists the page shows. The choice follows the user across
 * devices (GET / PUT /api/watchlist/view → users.settings.watchlistView, like the /themes view). The desk list is read by
 * everyone and kept by seniors and staff (`canEditDesk`); a personal list only by its owner.
 */
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { KEYS, STALE } from "@/lib/api/keys";

export type WatchScope = "mine" | "desk";
type ViewRes = { scope: WatchScope; canEditDesk: boolean };

const viewKey = ["watchlist-view"] as const;

/** Query key of one list: the personal list keeps the shared ["watchlist"] key other screens read and invalidate. */
export function watchlistKey(scope: WatchScope) {
  return scope === "mine" ? KEYS.watchlist() : ([...KEYS.watchlist(), "desk"] as const);
}

export function useWatchlistScope() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: viewKey,
    queryFn: ({ signal }) => http.get<ViewRes>("/api/watchlist/view", { signal }),
    staleTime: STALE.long,
    retry: 0,
    meta: { i18n: false },
  });
  const [local, setLocal] = useState<WatchScope | null>(null);
  const scope: WatchScope = local ?? q.data?.scope ?? "mine";
  const setScope = useCallback((next: WatchScope) => {
    setLocal(next);
    qc.setQueryData<ViewRes>(viewKey, (prev) => (prev ? { ...prev, scope: next } : prev));
    void http.put<ViewRes>("/api/watchlist/view", { scope: next }).catch(() => undefined); // remembered best effort
  }, [qc]);
  return { scope, setScope, canEditDesk: q.data?.canEditDesk ?? false, ready: !q.isLoading };
}
