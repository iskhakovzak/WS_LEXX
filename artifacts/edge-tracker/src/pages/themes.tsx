/**
 * «Темы рынка» (/themes) — TradingView-style theme tracker on one screen: a compact heat-table, one row per theme,
 * columns Премаркет | От открытия | За день | После закрытия. A header click sorts (desc → asc → back to the default);
 * the default column follows the session (pre → Премаркет, rth → От открытия, post → После закрытия, closed → За день)
 * until the user picks one (remembered). Phones: the theme plus two columns, a segmented picker chooses the active one.
 * A row (or a leaders / laggards chip) opens the theme's members sheet. Re-asks every 30 s while the market is in
 * pre / rth / post and the tab is visible. Staff edit the themes in a side sheet («Настроить темы»).
 */
import { useCallback, useState, type ReactNode } from "react";
import { Settings2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Page, PageHeader, PanelSkeleton, Segmented, usePersistentState } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { themesI18n } from "@/i18n/ns/themes";
import { useThemes } from "@/components/themes/api";
import { ThemeConfigSheet } from "@/components/themes/config-sheet";
import { HeatTable } from "@/components/themes/heat-table";
import { LeaderChips, ThemesMeta } from "@/components/themes/meta";
import { ThemeSheet } from "@/components/themes/theme-sheet";
import { METRICS, effectiveSort, hasValues, nextSort, type ThemeMetric, type ThemeSort } from "@/components/themes/model";

export default function ThemesPage() {
  const { t } = themesI18n.useT();
  const { can } = useAuth();
  const staff = can("gameplan.publish") || can("dailyfeed.manage");
  const q = useThemes();
  const data = q.data;
  const themes = data?.themes ?? [];
  // null = the user never picked a column: the default follows the session.
  const [stored, setStored] = usePersistentState<ThemeSort | null>("themes.sort", null);
  const sort = effectiveSort(stored, data?.session ?? "closed", themes);
  const onSort = useCallback((col: ThemeMetric) => setStored(nextSort(sort, col)), [setStored, sort]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const openTheme = themes.find((th) => th.id === openId) ?? null;

  const configure = staff ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
      <Settings2 aria-hidden="true" /> {t("config.open")}
    </Button>
  ) : null;

  let body: ReactNode;
  if (q.isPending) {
    body = <PanelSkeleton height={540} title={false} />;
  } else if (!data) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} title={t("loadFailed")} />;
  } else if (themes.length === 0) {
    body = <EmptyState icon={Shapes} title={t("noThemes.title")} description={t("noThemes.desc")} action={configure} />;
  } else if (!data.asOf) {
    body = <EmptyState icon={Shapes} title={t("noData.title")} description={t("noData.desc")} />;
  } else {
    body = (
      <>
        <Segmented
          size="sm"
          className="self-start sm:hidden"
          ariaLabel={t("columnAria")}
          value={sort.col}
          onChange={(col) => setStored({ col, dir: "desc" })}
          options={METRICS.map((m) => ({ value: m, label: t(`colsShort.${m}`), title: hasValues(themes, m) ? t(`cols.${m}`) : t(`unavailable.${m}`) }))}
        />
        <HeatTable themes={themes} sort={sort} onSort={onSort} onOpen={setOpenId} />
      </>
    );
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
            {data.asOf && <LeaderChips themes={themes} col={sort.col} onOpen={setOpenId} className="hidden xl:inline-flex" />}
          </>
        ) : undefined}
        actions={themes.length > 0 ? configure : null}
      />
      {body}
      <ThemeSheet theme={openTheme} sort={sort} onOpenChange={(o) => { if (!o) setOpenId(null); }} />
      {staff && <ThemeConfigSheet open={configOpen} onOpenChange={setConfigOpen} />}
    </Page>
  );
}
