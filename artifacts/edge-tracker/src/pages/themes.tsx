/**
 * «Темы рынка» (/themes) — TradingView-style theme tracker on one screen: a compact heat-table, one row per theme,
 * columns Премаркет | От открытия | За день | После закрытия (each user picks the visible ones in «Вид»; saved in the
 * profile). A header click sorts (desc → asc → back to the default); the default column follows the session (pre →
 * Премаркет, rth → От открытия, post → После закрытия, closed → За день, hidden columns skipped) until the user picks
 * one (remembered). Phones: the theme plus two columns and a picker. A row (or a leaders / laggards chip) opens the
 * theme's sheet. Members add their own themes («+ Моя тема»: tickers or a Finviz screener), marked «моя», visible only
 * to them. Shared themes are desk settings: admin only («Настроить темы»).
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Plus, Settings2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Page, PageHeader, PanelSkeleton, Segmented, usePersistentState } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { themesI18n } from "@/i18n/ns/themes";
import { useSaveMine, useSaveView, useThemes } from "@/components/themes/api";
import { ThemeConfigSheet } from "@/components/themes/config-sheet";
import { HeatTable } from "@/components/themes/heat-table";
import { LeaderChips, ThemesMeta } from "@/components/themes/meta";
import { MyThemeSheet } from "@/components/themes/my-theme-sheet";
import { ThemeSheet } from "@/components/themes/theme-sheet";
import { ViewPopover } from "@/components/themes/view-popover";
import {
  DEFAULT_VIEW, MAX_PERSONAL, effectiveSort, hasValues, mergeBoard, nextSort, setHidden, visibleColumns, type BoardTheme, type ThemeMetric, type ThemeSort,
} from "@/components/themes/model";

export default function ThemesPage() {
  const { t } = themesI18n.useT();
  const { can, canEdit } = useAuth();
  const admin = can("settings.manage");
  const q = useThemes();
  const data = q.data;
  const view = data?.view ?? DEFAULT_VIEW;
  const rows = useMemo(() => (data ? mergeBoard(data) : []), [data]);
  const columns = useMemo(() => visibleColumns(view), [view]);
  // null = the user never picked a column: the default follows the session.
  const [stored, setStored] = usePersistentState<ThemeSort | null>("themes.sort", null);
  const sort = effectiveSort(stored, data?.session ?? "closed", rows, columns);
  const onSort = useCallback((col: ThemeMetric) => setStored(nextSort(sort, col)), [setStored, sort]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardTheme | null | undefined>(undefined);
  const [configOpen, setConfigOpen] = useState(false);
  const saveView = useSaveView();
  const saveMine = useSaveMine();
  const openTheme = rows.find((th) => th.key === openKey) ?? null;
  const personalCount = data?.personal.length ?? 0;

  const hide = (th: BoardTheme) => {
    saveView.mutate(setHidden(view, th.id, true));
    setOpenKey(null);
    toast({ title: t("sheet.hidden"), description: th.name });
  };
  const remove = async (th: BoardTheme) => {
    try {
      await saveMine.mutateAsync({ id: th.id, draft: { active: false } });
      setOpenKey(null);
      toast({ title: t("sheet.removed"), description: th.name });
    } catch {
      toast({ title: t("config.failed"), variant: "destructive" });
    }
  };

  const configure = admin ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
      <Settings2 aria-hidden="true" /> {t("config.open")}
    </Button>
  ) : null;

  const toolbar = (
    <>
      <Segmented
        size="sm"
        className="sm:hidden"
        ariaLabel={t("columnAria")}
        value={sort.col}
        onChange={(col) => setStored({ col, dir: "desc" })}
        options={columns.map((m) => ({ value: m, label: t(`colsShort.${m}`), title: hasValues(rows, m) ? t(`cols.${m}`) : t(`unavailable.${m}`) }))}
      />
      {canEdit && (
        <div className="ml-auto flex items-center gap-1">
          <ViewPopover view={view} themes={data?.themes ?? []} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={personalCount >= MAX_PERSONAL}
            title={personalCount >= MAX_PERSONAL ? t("my.addLimit", { max: MAX_PERSONAL }) : undefined}
            onClick={() => setEditing(null)}
          >
            <Plus aria-hidden="true" /> {t("my.add")}
          </Button>
        </div>
      )}
    </>
  );

  let body: ReactNode;
  if (q.isPending) {
    body = <PanelSkeleton height={540} title={false} />;
  } else if (!data) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} title={t("loadFailed")} />;
  } else if (data.themes.length === 0 && data.personal.length === 0) {
    body = <EmptyState icon={Shapes} title={t("noThemes.title")} description={t("noThemes.desc")} action={configure} />;
  } else if (!data.asOf) {
    body = <EmptyState icon={Shapes} title={t("noData.title")} description={t("noData.desc")} />;
  } else {
    body = <HeatTable rows={rows} columns={columns} sort={sort} onSort={onSort} onOpen={setOpenKey} toolbar={toolbar} />;
  }

  return (
    <Page>
      <PageHeader
        icon={Shapes}
        title={t("title")}
        description={t("description")}
        meta={data ? (
          <>
            <ThemesMeta data={data} refreshFailed={q.isRefetchError} />
            {data.asOf && <LeaderChips themes={rows} col={sort.col} onOpen={setOpenKey} className="hidden xl:inline-flex" />}
          </>
        ) : undefined}
        actions={data && data.themes.length > 0 ? configure : null}
      />
      {body}
      <ThemeSheet
        theme={openTheme}
        columns={columns}
        sort={sort}
        canEdit={canEdit}
        onOpenChange={(o) => { if (!o) setOpenKey(null); }}
        onHide={hide}
        onEdit={(th) => { setOpenKey(null); setEditing(th); }}
        onRemove={(th) => void remove(th)}
      />
      {canEdit && <MyThemeSheet editing={editing} finviz={data?.finviz ?? false} onClose={() => setEditing(undefined)} />}
      {admin && <ThemeConfigSheet open={configOpen} onOpenChange={setConfigOpen} />}
    </Page>
  );
}
