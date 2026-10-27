/**
 * Риск-деск: curator desk (traders ranked by risk: limit usage day / week / drawdown, net P&L, exposure,
 * overnight, concentration; trader card with the intraday curve, trades, breaches and limits),
 * overnight & swing book (15:45 ET) with gap scenarios, and the trader's own "Мой риск" view.
 */
import * as React from "react";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Moon, RefreshCw, ShieldAlert } from "lucide-react";
import { EmptyLink, EmptyState, Page, PageHeader, Panel, SectionTabs } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { replaceSearchParams } from "@/hooks/use-search-param";
import { DeskView } from "@/components/risk/desk-view";
import { MyRiskView } from "@/components/risk/my-risk-view";
import { OvernightView } from "@/components/risk/overnight-view";
import { riskKeys } from "@/components/risk/use-risk";
import { useAgo, useStoredState } from "@/components/risk/primitives";
import { useHasRiskAccount } from "@/components/shell/use-shell-badges";
import { riskI18n } from "@/i18n/ns/risk";
import { commonI18n } from "@/i18n/ns/common";
import { HelpButton, PageHint } from "@/components/shared/page-hint";
import { RegimeDayView } from "@/components/shared/regime/regime-day";
import { GuardDeskPanel } from "@/components/leak-guard/guard-desk";
import { GuardImpactPanel } from "@/components/leak-guard/guard-impact";

type View = "desk" | "overnight" | "me";
const VIEWS: readonly View[] = ["desk", "overnight", "me"];
const SLOW_KEYS = new Set<string>([riskKeys.offerings()[1], riskKeys.earnings()[1]]);

export default function RiskPage() {
  const { t } = riskI18n.useT();
  const { user, isCurator } = useAuth();
  const signedIn = !!user && user.role !== "guest";
  // «Мой риск» only for someone with a trading account (staff without their own limits get the desk only).
  const account = useHasRiskAccount();
  const me = signedIn && account.has ? user!.traderName : null;
  const [storedView, setStoredView] = useStoredState<View>("risk.view", "desk", VIEWS);
  const search = useSearch();
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  // ?view= (shareable, survives a reload) over the remembered view.
  const urlView = params.get("view") as View | null;
  const stored: View = urlView && VIEWS.includes(urlView) ? urlView : storedView;
  const setView = React.useCallback((v: View) => { setStoredView(v); replaceSearchParams({ view: v }); }, [setStoredView]);
  const focusTrader = params.get("trader");
  const focusTab = params.get("tab") === "limits" ? "limits" : "overview";
  // ?tab=breaches&alert=<id> (the breach review notification) opens the person's own breach row.
  const focusAlert = params.get("tab") === "breaches" && /^\d+$/.test(params.get("alert") ?? "") ? Number(params.get("alert")) : null;
  // Traders have no desk view; they still get their own overnight book.
  const view: View = focusAlert != null && me ? "me"
    : isCurator ? (stored === "me" && !me ? "desk" : stored)
    : stored === "overnight" ? "overnight" : "me";
  const viewTabs: { value: View; label: string }[] = [
    ...(isCurator ? [{ value: "desk" as const, label: commonI18n.t("trading.desk") }] : []),
    { value: "overnight", label: t("page.title.overnight") },
    ...(me ? [{ value: "me" as const, label: t("page.title.me") }] : []),
  ];
  const qc = useQueryClient();
  // The slow catalyst lookups (offerings watch, earnings calendar) fill chips in the background; they must not keep
  // the refresh button spinning for seconds after the book itself is in.
  const fetching = useIsFetching({ queryKey: riskKeys.all, predicate: (q) => !SLOW_KEYS.has(String(q.queryKey[1])) }) > 0;
  const [updatedAt, setUpdatedAt] = React.useState<number>();
  const ago = useAgo(updatedAt);

  // Deep link /risk?trader=X opens the desk for curators.
  React.useEffect(() => {
    if (focusTrader && isCurator && stored !== "desk") setView("desk");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTrader]);

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: riskKeys.all });
  }, [qc]);


  return (
    <Page>
      <PageHeader
        title={t(`page.title.${view}`)}
        description={t(`page.desc.${view}`)}
        icon={view === "overnight" ? Moon : ShieldAlert}
        actions={
          signedIn ? (
            <>
              {ago && <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">{ago}</span>}
              <Button variant="outline" size="icon" onClick={refresh} aria-label={t("page.refreshAria")} disabled={fetching}>
                <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              </Button>
              <HelpButton id={view === "desk" ? "riskDesk" : "risk"} />
            </>
          ) : undefined
        }
      >
        {/* The views are the page's tabs: under the title, not squeezed into its row (design audit wave 2). */}
        {signedIn && viewTabs.length > 1 && <SectionTabs ariaLabel={t("page.viewAria")} value={view} onChange={setView} tabs={viewTabs} />}
      </PageHeader>
      {signedIn && <PageHint key={view === "desk" ? "riskDesk" : "risk"} id={view === "desk" ? "riskDesk" : "risk"} />}
      {/* Today's desk regime next to the limits it scales: name, playbook hint, multiplier, the suggested day limit. */}
      {signedIn && <RegimeDayView variant="strip" />}

      {!signedIn ? (
        <Panel>
          <EmptyState art="scales" icon={ShieldAlert} title={t("page.signInTitle")} description={t("page.signInDesc")} action={<EmptyLink href="/">{commonI18n.t("emptyActions.toDashboard")}</EmptyLink>} />
        </Panel>
      ) : view === "desk" && isCurator ? (
        <>
          {/* Live leak guard: who is on pause now (firm / hard), levels, saved / lost (components/leak-guard). */}
          <GuardDeskPanel canEdit={isCurator} />
          <DeskView onUpdatedAt={setUpdatedAt} focusTrader={focusTrader} focusTab={focusTab} onShowOvernight={() => setView("overnight")} />
        </>
      ) : view === "overnight" ? (
        <OvernightView trader={me} isCurator={isCurator} onUpdatedAt={setUpdatedAt} />
      ) : me ? (
        <>
          <MyRiskView trader={me} onUpdatedAt={setUpdatedAt} canEditLimits={isCurator} focusAlert={focusAlert} />
          <GuardImpactPanel trader={me} />
        </>
      ) : (
        <Panel>
          <EmptyState art="scales" icon={ShieldAlert} title={t("page.noTraderTitle")} description={t("page.noTraderDesc")} action={<EmptyLink href="/">{commonI18n.t("emptyActions.toDashboard")}</EmptyLink>} />
        </Panel>
      )}
    </Page>
  );
}
