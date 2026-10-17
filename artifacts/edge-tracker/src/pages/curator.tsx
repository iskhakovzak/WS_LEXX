/**
 * Кабинет куратора: «Сегодня» (кто торгует, кто у стопа, кто не сдал план / день, очередь разборов, просроченные
 * договорённости), «Мои трейдеры» (карточки + профиль ?trader=&tab=) и «Риск-процессы» (сводка дня, шаблоны лимитов
 * по тирам, разборы нарушений). Staff only. Data: /api/curator/*, /api/risk/{summary,templates,breaches}.
 */
import * as React from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ClipboardList, Lock, RefreshCw, ServerOff, ShieldAlert, Sun, Users } from "lucide-react";
import { EmptyState, Page, PageHeader, Pill, QueryState, SectionTabs, Segmented, StatGridSkeleton, UpdatedAgo, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { NotAvailableError, curatorKeys, useCuratorToday, useCuratorTraders, type Scope } from "@/components/curator/api";
import { PHASE_HINT, PHASE_LABEL } from "@/components/curator/curator-math";
import { TodayView } from "@/components/curator/today-view";
import { TradersView } from "@/components/curator/traders-view";
import { TraderProfile, PROFILE_TABS, type ProfileTab } from "@/components/curator/trader-profile";
import { RiskProcessesView } from "@/components/curator/risk-processes-view";

type View = "today" | "traders" | "risk";
const VIEWS: readonly View[] = ["today", "traders", "risk"];

export default function CuratorPage() {
  const { isCurator } = useAuth();
  if (!isCurator) {
    return (
      <Page>
        <PageHeader title="Кабинет куратора" icon={ClipboardList} />
        <EmptyState icon={Lock} title="Раздел для кураторов" description="Кабинет куратора доступен кураторам и администраторам деска." />
      </Page>
    );
  }
  return <CuratorCabinet />;
}

function CuratorCabinet() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const trader = params.get("trader");
  const tabParam = params.get("tab") as ProfileTab | null;
  const profileTab: ProfileTab = tabParam && PROFILE_TABS.includes(tabParam) ? tabParam : "overview";
  const viewParam = params.get("view") as View | null;
  const [storedView, setStoredView] = usePersistentState<View>("curator.view", "today");
  const view: View = trader ? "traders" : viewParam && VIEWS.includes(viewParam) ? viewParam : VIEWS.includes(storedView) ? storedView : "today";
  const [scope, setScope] = usePersistentState<Scope | "auto">("curator.scope", "auto");

  const today = useCuratorToday(scope);
  const traders = useCuratorTraders(scope);
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: curatorKeys.all }) > 0;

  const setView = (v: View) => {
    setStoredView(v);
    navigate(v === "today" ? "/curator" : `/curator?view=${v}`);
  };
  const openTrader = (name: string, tab?: string) => {
    const q = new URLSearchParams({ trader: name });
    if (tab && tab !== "overview") q.set("tab", tab);
    navigate(`/curator?${q.toString()}`);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };
  const setProfileTab = (t: ProfileTab) => trader && openTrader(trader, t);

  const notAvailable = today.error instanceof NotAvailableError;
  const d = today.data;
  const wards = d?.wards ?? 0;
  const effectiveScope: Scope = d?.scope ?? "desk";

  return (
    <Page>
      <PageHeader
        title="Кабинет куратора"
        icon={ClipboardList}
        description="Кто торгует, кто у стопа, что ждёт разбора и какой следующий шаг по каждому трейдеру"
        meta={d ? (
          <>
            <span title={PHASE_HINT[d.phase]}><Pill tone={d.phase === "session" ? "up" : d.phase === "weekend" ? "neutral" : "accent"} dot>{PHASE_LABEL[d.phase]}</Pill></span>
            <span className="tabular-nums">торговый день {d.date} (NY)</span>
            <UpdatedAgo at={today.dataUpdatedAt} />
          </>
        ) : undefined}
        actions={
          <>
            {wards > 0 && (
              <Segmented
                size="sm"
                ariaLabel="Чьи трейдеры"
                value={scope === "auto" ? effectiveScope : scope}
                onChange={(v) => setScope(v)}
                options={[{ value: "mine", label: `Мои · ${wards}` }, { value: "desk", label: "Весь деск" }]}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void qc.invalidateQueries({ queryKey: curatorKeys.all })}
              aria-label="Обновить"
              disabled={fetching}
            >
              <RefreshCw className={cn("h-4 w-4", fetching && "motion-safe:animate-spin")} /> Обновить
            </Button>
          </>
        }
      >
        <SectionTabs
          ariaLabel="Разделы кабинета"
          value={view}
          onChange={(v) => setView(v)}
          tabs={[
            { value: "today", label: "Сегодня", icon: Sun, count: d ? d.counts.queue + d.counts.halted || undefined : undefined },
            { value: "traders", label: "Мои трейдеры", icon: Users, count: d?.counts.traders },
            { value: "risk", label: "Риск-процессы", icon: ShieldAlert, count: d ? d.counts.noLimits + d.counts.halted || undefined : undefined },
          ]}
        />
      </PageHeader>

      {notAvailable ? (
        <EmptyState
          icon={ServerOff}
          title="Кабинет ещё не подключён на сервере"
          description="Маршруты /api/curator появятся после регистрации роутера и перезапуска API. Риск-деск, дневник и недельные разборы работают как обычно."
        />
      ) : view === "today" ? (
        <QueryState query={today} skeleton={<StatGridSkeleton count={6} />} errorTitle="Сводка дня не загрузилась">
          {(data) => <TodayView data={data} scope={scope} onOpenTrader={openTrader} />}
        </QueryState>
      ) : view === "traders" ? (
        trader ? (
          <TraderProfile trader={trader} tab={profileTab} onTab={setProfileTab} onBack={() => navigate("/curator?view=traders")} />
        ) : (
          <QueryState query={traders} skeleton={<StatGridSkeleton count={6} />} errorTitle="Список трейдеров не загрузился">
            {(data) => <TradersView traders={data.traders} onOpenTrader={openTrader} />}
          </QueryState>
        )
      ) : (
        <RiskProcessesView onOpenTrader={openTrader} />
      )}
    </Page>
  );
}
