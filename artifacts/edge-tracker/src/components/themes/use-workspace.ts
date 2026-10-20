/**
 * State of the /themes workspace: the active tab («Общие темы» or a personal board — remembered in the profile), the
 * active board's rows / columns / sort (the shared view in users.settings, a board's own on the board), ← / → between
 * tabs, and the actions the sheets and menus call (hide, pin, new board from a theme, delete an own theme).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { themesI18n } from "@/i18n/ns/themes";
import { useBoardData, useSaveBoard, useSaveMine, useSaveView, useThemes } from "./api";
import {
  DEFAULT_VIEW, columnsOf, effectiveSort, nextSort, nextTab, setHidden, sharedRows, themesBoardRows, visibleColumns,
  type BoardColumn, type BoardMeta, type BoardTab, type BoardTheme, type ColSort, type ThemeMetric, type ThemeSession, type TickerRow,
} from "./model";

const typing = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable);
};

export function useWorkspace() {
  const q = useThemes();
  const data = q.data;
  const view = data?.view ?? DEFAULT_VIEW;
  const boards = useMemo(() => data?.boards ?? [], [data?.boards]);
  const session: ThemeSession = data?.session ?? "closed";
  const saveView = useSaveView();
  const saveBoard = useSaveBoard();
  const saveMine = useSaveMine();

  // The tab: the profile's last one until the user switches here.
  const [picked, setPicked] = useState<BoardTab | null>(null);
  const remembered = view.tab;
  const tab: BoardTab = picked ?? remembered;
  const board: BoardMeta | null = typeof tab === "number" ? (boards.find((b) => b.id === tab) ?? null) : null;
  const activeTab: BoardTab = board ? board.id : "shared";
  const setTab = useCallback((next: BoardTab) => {
    setPicked(next);
    if (next !== view.tab) saveView.mutate({ tab: next });
  }, [saveView, view.tab]);
  const tabs = useMemo<BoardTab[]>(() => ["shared", ...boards.map((b) => b.id)], [boards]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (document.querySelector("[role=dialog],[role=menu],[role=listbox]")) return;
      e.preventDefault();
      setTab(nextTab(tabs, activeTab, e.key === "ArrowLeft" ? -1 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, activeTab, setTab]);

  const boardQ = useBoardData(board?.id ?? null);
  const bd = board && boardQ.data && boardQ.data.board.id === board.id ? boardQ.data : null;

  // «Общие темы»
  const shared = useMemo(() => (data ? sharedRows(data) : []), [data]);
  const sharedCols = useMemo(() => visibleColumns(view), [view]);
  const sharedSort = effectiveSort<ThemeMetric>(view.sort, session, shared, sharedCols);
  const onSharedSort = useCallback((col: ThemeMetric) => saveView.mutate({ sort: nextSort(sharedSort, col) }), [saveView, sharedSort]);

  // A personal board
  const themeRows: BoardTheme[] = useMemo(() => (bd?.kind === "themes" ? themesBoardRows(bd) : []), [bd]);
  const tickerRows: TickerRow[] = useMemo(() => (bd?.kind === "tickers" ? bd.rows : []), [bd]);
  const boardCols = useMemo<BoardColumn[]>(() => {
    if (!board) return [];
    const all = columnsOf(board.kind);
    const cols = all.filter((c) => board.columns.includes(c));
    return cols.length ? cols : [...all];
  }, [board]);
  const boardRowsValued = board?.kind === "themes" ? themeRows : tickerRows;
  const boardSort = effectiveSort<BoardColumn>(board?.sort ?? null, session, boardRowsValued, boardCols.length ? boardCols : ["today"]);
  const onBoardSort = useCallback((col: BoardColumn) => {
    if (board) saveBoard.mutate({ id: board.id, draft: { sort: nextSort(boardSort, col) } });
  }, [board, boardSort, saveBoard]);

  const t = themesI18n.t;
  const actions = {
    hide: (th: BoardTheme) => {
      saveView.mutate({ hidden: setHidden(view, th.id, true).hidden });
      toast({ title: t("sheet.hidden"), description: th.name });
    },
    restore: (id: number) => saveView.mutate({ hidden: setHidden(view, id, false).hidden }),
    sharedColumns: (cols: ThemeMetric[]) => saveView.mutate({ columns: cols }),
    /** Phone picker: that column, best first. */
    pickShared: (col: ThemeMetric) => saveView.mutate({ sort: { col, dir: "desc" } }),
    pickBoard: (col: BoardColumn) => { if (board) saveBoard.mutate({ id: board.id, draft: { sort: { col, dir: "desc" } } }); },
    boardColumns: (cols: BoardColumn[]) => { if (board) saveBoard.mutate({ id: board.id, draft: { columns: cols } }); },
    pin: (b: BoardMeta, themeId: number, on: boolean) => {
      const pinned = on ? [...b.pinned.filter((x) => x !== themeId), themeId] : b.pinned.filter((x) => x !== themeId);
      saveBoard.mutate({ id: b.id, draft: { pinned } }, { onSuccess: () => toast({ title: on ? t("actions.pinned", { board: b.name }) : t("actions.unpinned", { board: b.name }) }) });
    },
    removeMine: async (th: BoardTheme) => {
      try {
        await saveMine.mutateAsync({ id: th.id, draft: { active: false } });
        toast({ title: t("sheet.removed"), description: th.name });
        return true;
      } catch {
        toast({ title: t("config.failed"), variant: "destructive" });
        return false;
      }
    },
    move: (dir: "left" | "right") => { if (board) saveBoard.mutate({ id: board.id, draft: { move: dir } }); },
    archiveBoard: () => {
      if (!board) return;
      saveBoard.mutate({ id: board.id, draft: { active: false } }, { onSuccess: () => toast({ title: t("boards.removed"), description: board.name }) });
      setTab("shared");
    },
  };

  return {
    q, data, view, boards, session, tab: activeTab, setTab, board, boardQ, bd,
    shared, sharedCols, sharedSort: sharedSort as ColSort<ThemeMetric>, onSharedSort,
    themeRows, tickerRows, boardCols, boardSort, onBoardSort, actions,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
