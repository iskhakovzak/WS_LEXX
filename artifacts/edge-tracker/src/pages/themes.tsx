/**
 * «Темы рынка» (/themes) — TradingView-style theme tracker: equal-weight baskets of US tickers, two tables sorted best
 * → worst — «От открытия» (price vs today's open) and «За день» (price vs the previous close). Desktop: side by side;
 * phone: one table with a two-option switch (remembered). Re-asks every 30 s while the market is in pre / rth / post and
 * the tab is visible. Staff edit the themes in a side sheet («Настроить темы»).
 */
import { useState, type ReactNode } from "react";
import { Settings2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Page, PageHeader, PanelSkeleton, Segmented, usePersistentState } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { useThemes } from "@/components/themes/api";
import { ThemeConfigSheet } from "@/components/themes/config-sheet";
import { ThemesMeta } from "@/components/themes/meta";
import { ThemePanel } from "@/components/themes/theme-board";
import { METRICS, isMetric, type ThemeMetric } from "@/components/themes/model";

export default function ThemesPage() {
  const { t } = themesI18n.useT();
  const { can } = useAuth();
  const staff = can("gameplan.publish") || can("dailyfeed.manage");
  const q = useThemes();
  const [stored, setView] = usePersistentState<ThemeMetric>("themes.view", "fromOpen");
  const view: ThemeMetric = isMetric(stored) ? stored : "fromOpen";
  const [configOpen, setConfigOpen] = useState(false);
  const data = q.data;

  const configure = staff ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
      <Settings2 aria-hidden="true" /> {t("config.open")}
    </Button>
  ) : null;

  let body: ReactNode;
  if (q.isPending) {
    body = (
      <div className="grid gap-[var(--grid-gap)] xl:grid-cols-2">
        <PanelSkeleton height={520} />
        <PanelSkeleton height={520} className="hidden xl:flex" />
      </div>
    );
  } else if (!data) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} title={t("loadFailed")} />;
  } else if (data.themes.length === 0) {
    body = <EmptyState icon={Shapes} title={t("noThemes.title")} description={t("noThemes.desc")} action={configure} />;
  } else if (!data.asOf) {
    body = <EmptyState icon={Shapes} title={t("noData.title")} description={t("noData.desc")} />;
  } else {
    // Before the open nobody has a «from open» value: show «За день» alone (full width) instead of an empty table.
    const shown = data.themes.some((th) => th.fromOpen != null) ? METRICS : (["today"] as const);
    const two = shown.length > 1;
    body = (
      <>
        {two ? (
          <Segmented
            className="self-start xl:hidden"
            ariaLabel={t("viewAria")}
            value={view}
            onChange={setView}
            options={METRICS.map((m) => ({ value: m, label: t(`panels.${m}`) }))}
          />
        ) : (
          <p className="text-xs text-muted-foreground">{t("noOpenYet")}</p>
        )}
        <div className={cn("grid items-start gap-[var(--grid-gap)]", two && "xl:grid-cols-2")}>
          {shown.map((m) => (
            <ThemePanel key={m} metric={m} themes={data.themes} session={data.session} className={cn(two && m !== view && "hidden xl:block")} />
          ))}
        </div>
      </>
    );
  }

  return (
    <Page>
      <PageHeader
        icon={Shapes}
        title={t("title")}
        description={t("description")}
        meta={data ? <ThemesMeta data={data} refreshFailed={q.isRefetchError} /> : undefined}
        actions={data && data.themes.length > 0 ? configure : null}
      />
      {body}
      {staff && <ThemeConfigSheet open={configOpen} onOpenChange={setConfigOpen} />}
    </Page>
  );
}
