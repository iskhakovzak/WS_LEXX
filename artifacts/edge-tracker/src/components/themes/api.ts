/**
 * «Темы рынка» — data layer. GET /api/themes refreshes its quotes lazily on the server (30 s cache while the market is
 * open), so the page re-asks every 30 s in pre / rth / post while the tab is visible and not at all when closed.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { pollInterval, type ThemeRecord, type ThemesResponse } from "./model";

export const themeKeys = {
  all: ["themes"] as const,
  board: () => ["themes", "board"] as const,
  config: () => ["themes", "config"] as const,
};

export const themesQuery = () =>
  queryOptions({
    queryKey: themeKeys.board(),
    queryFn: ({ signal }) => http.get<ThemesResponse>("/api/themes", { signal }),
    staleTime: STALE.live,
    // refetchIntervalInBackground stays false: a hidden tab does not poll.
    refetchInterval: (q) => pollInterval(q.state.data?.session),
    // Closed market = no polling; coming back to the tab (e.g. after 04:00 NY) asks once.
    refetchOnWindowFocus: true,
    meta: { i18n: false },
  });

export function useThemes() {
  return useQuery(themesQuery());
}

/** Staff: every theme incl. archived. */
export function useThemeConfig(enabled: boolean) {
  return useQuery({
    queryKey: themeKeys.config(),
    queryFn: ({ signal }) => http.get<{ themes: ThemeRecord[] }>("/api/themes/config", { signal }),
    staleTime: STALE.short,
    enabled,
    meta: { i18n: false },
    select: (r) => r.themes,
  });
}

export type ThemeDraft = { name?: string; tickers?: string[]; sortOrder?: number; active?: boolean };

export function useSaveTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: number | null; draft: ThemeDraft }) =>
      id == null ? http.post<ThemeRecord>("/api/themes", draft) : http.put<ThemeRecord>(`/api/themes/${id}`, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: themeKeys.all }),
    // The settings sheet shows the error next to the form (no global toast on top of it).
    onError: () => undefined,
  });
}
