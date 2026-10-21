/**
 * «Темы рынка» (/themes) — an operator workspace on one screen: a one-line header (title, live status, «Вид»,
 * «+ Доска», overflow), the tabs («Общие темы» + up to 8 own boards, the last one remembered in the profile; ← / → switch),
 * then one dense heat-table (breadth strip on top; ↑ / ↓ move, Enter opens). Themes tabs: a row opens the theme sheet
 * (copy tickers, new board from it, pin to a board, hide / edit / delete). Tickers boards: a row opens its menu («В
 * вотчлист», «В план дня», «Скопировать»). Shared themes are desk settings: admin only («Настроить темы»).
 */
import { useState, type ReactNode } from "react";
import { Plus, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Page, PanelSkeleton } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { themesI18n } from "@/i18n/ns/themes";
import { BoardDialog, type BoardPrefill } from "@/components/themes/board-dialog";
import { BoardLoading, EmptyThemesBoard, ThemesTable, TickersTable } from "@/components/themes/board-views";
import { ThemeConfigSheet } from "@/components/themes/config-sheet";
import { ThemesMeta } from "@/components/themes/meta";
import { MyThemeSheet } from "@/components/themes/my-theme-sheet";
import { ThemeSheet } from "@/components/themes/theme-sheet";
import { ViewPopover } from "@/components/themes/view-popover";
import { BoardTabs, WorkspaceHeader } from "@/components/themes/workspace-header";
import { useWorkspace } from "@/components/themes/use-workspace";
import {
  METRICS, MAX_PERSONAL, columnsOf, isMetric, themeTickerList, type BoardColumn, type BoardMeta, type BoardTheme, type ColSort, type ThemeMetric,
} from "@/components/themes/model";

export default function ThemesPage() {
  const { t } = themesI18n.useT();
  const { can, canEdit } = useAuth();
  const admin = can("settings.manage");
  const w = useWorkspace();
  const { data, board, bd } = w;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editingTheme, setEditingTheme] = useState<BoardTheme | null | undefined>(undefined);
  const [editingBoard, setEditingBoard] = useState<BoardMeta | null | undefined>(undefined);
  const [prefill, setPrefill] = useState<BoardPrefill | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const themeRows = board ? w.themeRows : w.shared;
  const openTheme = themeRows.find((th) => th.key === openKey) ?? null;
  const themesBoards = w.boards.filter((b) => b.kind === "themes");
  // The theme sheet shows the moves of the tab it was opened from (a board's columns, the 4 moves only).
  const sheetCols: ThemeMetric[] = board ? (w.boardCols.filter(isMetric) as ThemeMetric[]) : w.sharedCols;
  const sheetSort: ColSort<ThemeMetric> = board ? (isMetric(w.boardSort.col) ? (w.boardSort as ColSort<ThemeMetric>) : { col: "today", dir: "desc" }) : w.sharedSort;
  const personalCount = (bd?.kind === "themes" ? bd.personal.length : 0);

  const newBoardFrom = (th: BoardTheme) => {
    setOpenKey(null);
    setPrefill({ name: th.name, tickers: themeTickerList(th).slice(0, 50) });
    setEditingBoard(null);
  };
  const closeBoardDialog = (saved: BoardMeta | null) => {
    setEditingBoard(undefined);
    setPrefill(null);
    if (saved) w.setTab(saved.id);
  };

  const viewControl = !data ? null : board ? (
    <ViewPopover<BoardColumn> all={columnsOf(board.kind)} visible={w.boardCols} onColumns={w.actions.boardColumns} />
  ) : (
    <ViewPopover<ThemeMetric> all={METRICS} visible={w.sharedCols} onColumns={w.actions.sharedColumns}
      hidden={canEdit ? data.themes.filter((th) => data.view.hidden.includes(th.id)).map((th) => ({ id: th.id, name: th.name })) : undefined}
      onRestore={w.actions.restore} />
  );

  let body: ReactNode;
  if (w.q.isPending) body = <PanelSkeleton height={540} title={false} />;
  else if (!data) body = <ErrorState error={w.q.error} onRetry={() => void w.q.refetch()} title={t("loadFailed")} />;
  else if (!board) {
    body = !data.themes.length
      ? <EmptyState icon={Shapes} title={t("noThemes.title")} description={t("noThemes.desc")} />
      : !data.asOf
        ? <EmptyState icon={Shapes} title={t("noData.title")} description={t("noData.desc")} />
        : <ThemesTable rows={w.shared} columns={w.sharedCols} sort={w.sharedSort} onSort={w.onSharedSort} onPick={(col) => w.actions.pickShared(col)} onOpen={setOpenKey} />;
  } else if (!bd) {
    body = w.boardQ.isError ? <ErrorState error={w.boardQ.error} onRetry={() => void w.boardQ.refetch()} title={t("boards.loadFailed")} /> : <BoardLoading />;
  } else if (bd.kind === "themes") {
    const add = (
      <Button type="button" variant="ghost" size="sm" className="h-7" disabled={personalCount >= MAX_PERSONAL}
        title={personalCount >= MAX_PERSONAL ? t("my.addLimit", { max: MAX_PERSONAL }) : undefined} onClick={() => setEditingTheme(null)}>
        <Plus aria-hidden="true" /> {t("my.add")}
      </Button>
    );
    body = <ThemesTable rows={w.themeRows} columns={w.boardCols} sort={w.boardSort} onSort={w.onBoardSort} onPick={(col) => w.actions.pickBoard(col)}
      onOpen={setOpenKey} extra={add} empty={<EmptyThemesBoard onAdd={() => setEditingTheme(null)} />} />;
  } else {
    const notes = [
      bd.needsFinviz ? t("sheet.needsFinviz") : null,
      !bd.needsFinviz && board.source?.kind === "screener" && !bd.rows.length && !bd.missing.length ? t("sheet.resolving") : null,
      bd.missing.length ? t("missing", { list: bd.missing.join(", ") }) : null,
    ].filter(Boolean);
    body = <TickersTable rows={w.tickerRows} columns={w.boardCols} sort={w.boardSort} onSort={w.onBoardSort} onPick={(col) => w.actions.pickBoard(col)} source={board.name}
      footer={notes.length ? <p className="mt-1.5 text-xs text-muted-foreground">{notes.join(" · ")}</p> : undefined} />;
  }

  return (
    <Page className="gap-2 sm:gap-3">
      <WorkspaceHeader
        status={data ? <ThemesMeta data={data} refreshFailed={w.q.isRefetchError} /> : null}
        view={viewControl}
        canEdit={canEdit}
        admin={admin}
        boards={w.boards}
        board={board}
        onNewBoard={() => { setPrefill(null); setEditingBoard(null); }}
        onEditBoard={() => board && setEditingBoard(board)}
        onMove={w.actions.move}
        onDelete={w.actions.archiveBoard}
        onConfig={() => setConfigOpen(true)}
      />
      <BoardTabs boards={w.boards} tab={w.tab} onChange={w.setTab} />
      {body}
      <ThemeSheet
        theme={openTheme}
        columns={sheetCols.length ? sheetCols : [...METRICS]}
        sort={sheetSort}
        canEdit={canEdit}
        themesBoards={themesBoards}
        actions={{
          onHide: board ? undefined : (th) => { w.actions.hide(th); setOpenKey(null); },
          onEdit: (th) => { setOpenKey(null); setEditingTheme(th); },
          onRemove: (th) => void w.actions.removeMine(th).then((ok) => ok && setOpenKey(null)),
          onNewBoard: newBoardFrom,
          onPin: w.actions.pin,
        }}
        onOpenChange={(o) => { if (!o) setOpenKey(null); }}
      />
      {canEdit && <MyThemeSheet editing={editingTheme} boardId={board?.kind === "themes" ? board.id : null} finviz={data?.finviz ?? false} onClose={() => setEditingTheme(undefined)} />}
      {canEdit && <BoardDialog editing={editingBoard} prefill={prefill} themes={data?.themes ?? []} finviz={data?.finviz ?? false} onClose={closeBoardDialog} />}
      {admin && <ThemeConfigSheet open={configOpen} onOpenChange={setConfigOpen} />}
    </Page>
  );
}
