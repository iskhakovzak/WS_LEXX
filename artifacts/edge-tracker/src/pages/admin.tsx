import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Database, Flag, KeyRound, RefreshCw, ScrollText, Shield, ShieldAlert, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { EmptyState, Kbd, Page, PageHeader, SectionTabs, UpdatedAgo } from "@/components/ds";
import { cn } from "@/lib/utils";
import { isTypingTarget, useAdminOverview, useDeskPulse, useRiskDesk } from "@/components/admin/api";
import { KpiRow, OverviewPanel, type AdminTab } from "@/components/admin/OverviewPanel";
import { type RiskStatus, type TraderFilter } from "@/components/admin/TradersTable";
import { PeoplePanel, type PeopleView } from "@/components/admin/PeoplePanel";
import { ModerationQueue } from "@/components/admin/ModerationQueue";
import { RolesPanel } from "@/components/admin/RolesPanel";
import { AuditLog } from "@/components/admin/AuditLog";
import { DataPanel } from "@/components/admin/DataPanel";
import { useDataQuality, useEodQueueCount, useEodStatus, useHealth, useTiers } from "@/components/admin/console-api";

const TABS: AdminTab[] = ["overview", "people", "moderation", "roles", "data", "audit"];
// Old tab ids (links/bookmarks) map onto the new ones.
const LEGACY: Record<string, AdminTab> = { users: "people", traders: "people", reports: "moderation", tools: "data", permissions: "roles" };
const TAB_KEY = "admin.tab";
const FILTER_KEY = "admin.traders.filter";
const VIEW_KEY = "admin.people.view";

function initialTab(): AdminTab {
  try {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p) {
      const t = (LEGACY[p] ?? p) as AdminTab;
      if (TABS.includes(t)) return t;
    }
    const raw = localStorage.getItem(TAB_KEY);
    const s = raw ? ((LEGACY[raw] ?? raw) as AdminTab) : null;
    if (s && TABS.includes(s)) return s;
  } catch { /* ignore */ }
  return "overview";
}

function initialFilter(): TraderFilter {
  try { return (localStorage.getItem(FILTER_KEY) as TraderFilter) || "all"; } catch { return "all"; }
}

function initialView(): PeopleView {
  try { return localStorage.getItem(VIEW_KEY) === "activity" ? "activity" : "manage"; } catch { return "manage"; }
}

export default function AdminPage() {
  const { isCurator } = useAuth();
  if (!isCurator) {
    return (
      <Page>
        <EmptyState
          icon={ShieldAlert}
          title="Доступ запрещён"
          description="Пульт деска доступен только кураторам и администраторам."
          className="py-24"
        />
      </Page>
    );
  }
  return <AdminConsole />;
}

function AdminConsole() {
  const { user, isAdmin } = useAuth();
  const actor = user?.traderName ?? "";
  const qc = useQueryClient();
  const [tab, setTabState] = useState<AdminTab>(initialTab);
  const [traderFilter, setTraderFilterState] = useState<TraderFilter>(initialFilter);
  const [peopleView, setPeopleViewState] = useState<PeopleView>(initialView);

  const pulse = useDeskPulse(actor);
  const overview = useAdminOverview(actor);
  const risk = useRiskDesk();
  const health = useHealth();
  const eod = useEodStatus();
  const queue = useEodQueueCount();
  const tiers = useTiers();
  const quality = useDataQuality();

  const tierNames = useMemo(
    () => Object.fromEntries((tiers.data ?? []).map((t) => [t.key, t.name])) as Record<string, string>,
    [tiers.data],
  );

  const setTab = useCallback((t: AdminTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
      const url = new URL(window.location.href);
      if (t === "overview") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* ignore */ }
  }, []);

  const setTraderFilter = useCallback((f: TraderFilter) => {
    setTraderFilterState(f);
    try { localStorage.setItem(FILTER_KEY, f); } catch { /* ignore */ }
  }, []);

  const setPeopleView = useCallback((v: PeopleView) => {
    setPeopleViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }, []);

  // A filter (from KPI/attention items) means "show me these traders' activity" → people tab, activity view.
  const go = useCallback((t: AdminTab, filter?: TraderFilter) => {
    if (filter) {
      setTraderFilter(filter);
      setPeopleView("activity");
    }
    setTab(t);
  }, [setTab, setTraderFilter, setPeopleView]);

  const refreshAll = useCallback(() => {
    for (const k of ["admin-desk-pulse", "admin-overview", "admin-risk-desk-lite", "admin-reports", "admin-audit", "admin-backups", "admin-console", "propreports"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  }, [qc]);

  // 1–6 switch sections (ignored while typing or when a dialog/menu is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector("[role=dialog],[role=menu],[role=alertdialog]")) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  const openReports = pulse.data?.summary.openReports ?? overview.data?.openReports;
  const fetching = pulse.isFetching || overview.isFetching || health.isFetching;
  const riskStatus = useMemo(
    () => (risk.data ? new Map<string, RiskStatus>(risk.data.traders.map((t) => [t.trader, t.status])) : undefined),
    [risk.data],
  );
  const unmatchedCount = health.data ? health.data.sync.unmatched.length + health.data.sync.accounts.unmapped.length : 0;

  return (
    <Page>
      <PageHeader
        icon={Shield}
        title="Пульт деска"
        description="Что требует внимания, люди и права, данные PropReports и журнал изменений"
        actions={
          <>
            <UpdatedAgo at={pulse.dataUpdatedAt} className="hidden sm:inline-flex" />
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Обновить данные" onClick={refreshAll} disabled={fetching}>
              <RefreshCw className={cn(fetching && "animate-spin motion-reduce:animate-none")} />
            </Button>
          </>
        }
      />

      <KpiRow pulse={pulse.data} risk={risk.data} eod={eod.data} queue={queue.data} loading={pulse.isLoading} onGo={go} />

      <div className="flex flex-col gap-1">
        <SectionTabs<AdminTab>
          ariaLabel="Разделы пульта"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "Обзор", icon: Activity },
            { value: "people", label: "Люди", icon: Users, count: unmatchedCount || undefined },
            { value: "moderation", label: "Модерация", icon: Flag, count: openReports || undefined },
            { value: "roles", label: "Роли и права", icon: KeyRound },
            { value: "data", label: "Данные", icon: Database },
            { value: "audit", label: "Аудит", icon: ScrollText },
          ]}
        />
        <p className="hidden items-center gap-1 self-end text-2xs text-muted-foreground md:inline-flex">
          <Kbd>1</Kbd>–<Kbd>6</Kbd> разделы
        </p>
      </div>

      <div role="tabpanel" aria-label="Содержимое раздела">
        {tab === "overview" && (
          <OverviewPanel
            pulse={pulse.data}
            overview={overview.data}
            risk={risk.data}
            health={health.data}
            eod={eod.data}
            queue={queue.data}
            quality={quality.data?.checks ?? (quality.data === null ? null : undefined)}
            pulseError={pulse.isError ? pulse.error : null}
            healthError={health.isError ? health.error : null}
            overviewError={overview.isError ? overview.error : null}
            onRetry={refreshAll}
            onGo={go}
            tierNames={tierNames}
          />
        )}
        {tab === "people" && (
          <PeoplePanel
            actor={actor}
            pulse={pulse.data}
            pulseLoading={pulse.isLoading}
            pulseError={pulse.isError ? pulse.error : null}
            onPulseRetry={() => pulse.refetch()}
            riskStatus={riskStatus}
            view={peopleView}
            onViewChange={setPeopleView}
            activityFilter={traderFilter}
            onActivityFilterChange={setTraderFilter}
          />
        )}
        {tab === "moderation" && <ModerationQueue actor={actor} openCount={openReports} />}
        {tab === "roles" && <RolesPanel />}
        {tab === "data" && <DataPanel actor={actor} isAdmin={isAdmin} />}
        {tab === "audit" && <AuditLog actor={actor} tierNames={tierNames} />}
      </div>
    </Page>
  );
}
