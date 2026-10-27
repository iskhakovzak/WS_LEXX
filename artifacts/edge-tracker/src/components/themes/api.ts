/**
 * «Темы рынка» — data layer. GET /api/themes (the shared board + the viewer's view and boards) refreshes its quotes
 * lazily on the server (30 s cache while the market is open); the page re-asks every 30 s in pre / rth / post while the
 * tab is visible and every 5 min when closed (so the board wakes up for premarket / the open). The active personal board (GET /api/themes/boards/:id) polls the same way.
 * View, sort and board edits save optimistically. «Архив» (GET /api/themes/archive, read while «Вид» is open): archived
 * boards and themes, each with «Вернуть».
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http, isApiError } from "@/lib/api/http";
import { KEYS, STALE } from "@/lib/api/keys";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { themesI18n } from "@/i18n/ns/themes";
import { MAX_PERSONAL, pollInterval, type BoardColumn, type BoardData, type BoardMeta, type ColSort, type ThemeRecord, type ThemesResponse, type ThemesView } from "./model";

export const themeKeys = {
  all: ["themes"] as const,
  board: () => ["themes", "board"] as const,
  boardData: (id: number) => ["themes", "boardData", id] as const,
  config: () => ["themes", "config"] as const,
  archive: () => ["themes", "archive"] as const,
};

export const themesQuery = () =>
  queryOptions({
    queryKey: themeKeys.board(),
    queryFn: ({ signal }) => http.get<ThemesResponse>("/api/themes", { signal }),
    staleTime: STALE.live,
    // refetchIntervalInBackground stays false: a hidden tab does not poll.
    // A cold server answers `warming` (no numbers yet): ask again in 3 s until the first refresh has landed.
    refetchInterval: (q) => (q.state.data?.warming ? 3_000 : pollInterval(q.state.data?.session)),
    // Closed market = a slow 5 min poll (CLOSED_POLL_MS); coming back to the tab also asks once.
    refetchOnWindowFocus: true,
    meta: { i18n: false },
  });

export function useThemes() {
  return useQuery(themesQuery());
}

/** One personal board's rows (only while its tab is open). */
export function useBoardData(id: number | null) {
  return useQuery({
    queryKey: themeKeys.boardData(id ?? 0),
    queryFn: ({ signal }) => http.get<BoardData>(`/api/themes/boards/${id}`, { signal }),
    enabled: id != null,
    staleTime: STALE.live,
    refetchInterval: (q) => pollInterval(q.state.data?.session),
    refetchOnWindowFocus: true,
    meta: { i18n: false },
  });
}

/** Admin: every shared theme incl. archived. */
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

/** PUT /api/themes/view (any of columns / hidden / sort / tab) — applied at once, rolled back when refused. */
export function useSaveView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ThemesView>) => http.put<ThemesView>("/api/themes/view", patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: themeKeys.board() });
      const prev = qc.getQueryData<ThemesResponse>(themeKeys.board());
      if (prev) qc.setQueryData<ThemesResponse>(themeKeys.board(), { ...prev, view: { ...prev.view, ...patch } });
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(themeKeys.board(), ctx.prev);
      toast({ title: themesI18n.t("view.failed"), variant: "destructive" });
    },
    onSuccess: (view) => {
      qc.setQueryData<ThemesResponse>(themeKeys.board(), (d) => (d ? { ...d, view } : d));
    },
  });
}

export type MineDraft = {
  boardId?: number;
  name?: string;
  kind?: "tickers" | "screener";
  tickers?: string[];
  /** Finviz screener URL / f= query / filter list (only f and o are kept by the server). */
  screener?: string;
  order?: string | null;
  active?: boolean;
};

/** «Мои темы»: POST (id null) or PUT /api/themes/mine/:id; boards are refetched. Errors are shown by the form. */
export function useSaveMine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: number | null; draft: MineDraft }) =>
      id == null ? http.post<{ id: number }>("/api/themes/mine", draft) : http.put<{ id: number }>(`/api/themes/mine/${id}`, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: themeKeys.all }),
    onError: () => undefined,
  });
}

export type BoardDraft = {
  name?: string;
  kind?: "themes" | "tickers";
  columns?: BoardColumn[];
  sort?: ColSort<BoardColumn> | null;
  pinned?: number[];
  tickers?: string[];
  screener?: string;
  order?: string | null;
  top?: 25 | 50;
  move?: "left" | "right";
  active?: boolean;
};

/** POST /api/themes/boards (id null) or PUT …/:id. Columns / sort / pins show at once (optimistic on the tab list). */
export function useSaveBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: number | null; draft: BoardDraft }) =>
      id == null ? http.post<BoardMeta>("/api/themes/boards", draft) : http.put<BoardMeta>(`/api/themes/boards/${id}`, draft),
    onMutate: async ({ id, draft }) => {
      if (id == null) return { prev: undefined };
      const prev = qc.getQueryData<ThemesResponse>(themeKeys.board());
      const local: Partial<BoardMeta> = {};
      if (draft.columns) local.columns = draft.columns;
      if (draft.sort !== undefined) local.sort = draft.sort;
      if (draft.pinned) local.pinned = draft.pinned;
      if (draft.name) local.name = draft.name;
      if (prev && Object.keys(local).length) {
        qc.setQueryData<ThemesResponse>(themeKeys.board(), { ...prev, boards: prev.boards.map((b) => (b.id === id ? { ...b, ...local } : b)) });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(themeKeys.board(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: themeKeys.all }),
  });
}

/** The owner's archive: boards (with how many themes come back with each) and themes archived on an active board. */
export type ThemesArchive = {
  boards: { id: number; name: string; kind: "themes" | "tickers"; themes: number }[];
  themes: { id: number; name: string; kind: "tickers" | "screener"; boardId: number; boardName: string }[];
};

export function useThemesArchive(enabled: boolean) {
  return useQuery({
    queryKey: themeKeys.archive(),
    queryFn: ({ signal }) => http.get<ThemesArchive>("/api/themes/archive", { signal }),
    staleTime: STALE.short,
    enabled,
    meta: { i18n: false },
  });
}

const restoreFailed = (err: unknown) =>
  toast({ title: themesI18n.t("view.restoreFailed"), description: humanizeApiError(err), variant: "destructive" });

/** POST /api/themes/boards/:id/restore — the board comes back with its themes (as far as the limit of 10 allows). */
export function useRestoreBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<BoardMeta & { restoredThemes: number; skippedThemes: number }>(`/api/themes/boards/${id}/restore`),
    onSuccess: (b) => {
      toast({
        title: themesI18n.t("view.boardRestored"),
        description: b.skippedThemes > 0 ? themesI18n.t("view.boardRestoredSkipped", { n: b.skippedThemes, max: MAX_PERSONAL }) : b.name,
      });
    },
    onError: restoreFailed,
    onSettled: () => qc.invalidateQueries({ queryKey: themeKeys.all }),
  });
}

/** POST /api/themes/mine/:id/restore — an archived theme back onto its (active) board. */
export function useRestoreMine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<{ id: number; name: string }>(`/api/themes/mine/${id}/restore`),
    onSuccess: (th) => toast({ title: themesI18n.t("view.themeRestored"), description: th.name }),
    onError: restoreFailed,
    onSettled: () => qc.invalidateQueries({ queryKey: themeKeys.all }),
  });
}

/** «В вотчлист»: the trader's own watchlist (POST /api/watchlist scope mine); a ticker already there is not an error. */
export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ticker: string): Promise<"added" | "exists"> => {
      try {
        await http.post("/api/watchlist", { ticker, catalyst: themesI18n.t("actions.watchCatalyst"), status: "watching", scope: "mine" });
        return "added";
      } catch (err) {
        if (isApiError(err) && err.status === 409) return "exists";
        throw err;
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.watchlist() }),
  });
}
