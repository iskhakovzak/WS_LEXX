/**
 * Риск-деск: curator desk (traders ranked by risk: limit usage day / week / drawdown, net P&L, exposure,
 * overnight, concentration; trader card with the intraday curve, trades, breaches and limits),
 * overnight & swing book (15:45 ET) with gap scenarios, and the trader's own "Мой риск" view.
 */
import * as React from "react";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Moon, RefreshCw, ShieldAlert } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { DeskView } from "@/components/risk/desk-view";
import { MyRiskView } from "@/components/risk/my-risk-view";
import { OvernightView } from "@/components/risk/overnight-view";
import { riskKeys } from "@/components/risk/use-risk";
import { useAgo, useStoredState } from "@/components/risk/primitives";

type View = "desk" | "overnight" | "me";
const VIEWS: readonly View[] = ["desk", "overnight", "me"];

const TITLES: Record<View, { title: string; description: string }> = {
  desk: { title: "Риск-деск", description: "Кто ближе всего к стопу: лимиты дня, недели и просадки, P&L нетто, экспозиция и овернайт" },
  overnight: { title: "Овернайт и свинг", description: "Что уходит через закрытие: котировки, катализаторы, гэп-риск и концентрация" },
  me: { title: "Мой риск", description: "Сколько осталось до стопа сегодня и на неделе, мой день и нарушения" },
};

export default function RiskPage() {
  const { user, isCurator } = useAuth();
  const signedIn = !!user && user.role !== "guest";
  const me = signedIn ? user!.traderName : null;
  const [stored, setView] = useStoredState<View>("risk.view", "desk", VIEWS);
  // Traders have no desk view; they still get their own overnight book.
  const view: View = isCurator ? stored : stored === "overnight" ? "overnight" : "me";
  const search = useSearch();
  const focusTrader = React.useMemo(() => new URLSearchParams(search).get("trader"), [search]);
  const focusTab = React.useMemo(() => (new URLSearchParams(search).get("tab") === "limits" ? "limits" : "overview"), [search]);
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: riskKeys.all }) > 0;
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

  const meta = TITLES[view];

  return (
    <Page>
      <PageHeader
        title={meta.title}
        description={meta.description}
        icon={view === "overnight" ? Moon : ShieldAlert}
        actions={
          signedIn ? (
            <>
              {ago && <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">{ago}</span>}
              <Button variant="outline" size="icon" onClick={refresh} aria-label="Обновить данные риска" disabled={fetching}>
                <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              </Button>
              <Segmented
                ariaLabel="Режим риск-деска"
                value={view}
                onChange={setView}
                options={[
                  ...(isCurator ? [{ value: "desk", label: "Деск" }] : []),
                  { value: "overnight", label: "Овернайт и свинг" },
                  ...(me ? [{ value: "me", label: "Мой риск" }] : []),
                ]}
              />
            </>
          ) : undefined
        }
      />

      {!signedIn ? (
        <Panel>
          <EmptyState icon={ShieldAlert} title="Войдите, чтобы увидеть риск" description="Риск-деск доступен трейдерам и кураторам." />
        </Panel>
      ) : view === "desk" && isCurator ? (
        <DeskView onUpdatedAt={setUpdatedAt} focusTrader={focusTrader} focusTab={focusTab} onShowOvernight={() => setView("overnight")} />
      ) : view === "overnight" ? (
        <OvernightView trader={me} isCurator={isCurator} onUpdatedAt={setUpdatedAt} />
      ) : me ? (
        <MyRiskView trader={me} onUpdatedAt={setUpdatedAt} canEditLimits={isCurator} />
      ) : (
        <Panel>
          <EmptyState icon={ShieldAlert} title="У вашего аккаунта нет имени трейдера" description="Личный риск доступен только трейдерам; кураторам — деск и овернайт." />
        </Panel>
      )}
    </Page>
  );
}
