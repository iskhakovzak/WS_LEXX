import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, BarChart3, Bug, Database, Flag, KeyRound, RefreshCw, ScrollText, Shield, ShieldAlert, SlidersHorizontal, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { EmptyState, Kbd, Page, PageHeader, SectionTabs, UpdatedAgo } from "@/components/ds";
import { cn } from "@/lib/utils";
import { isTypingTarget, useAdminOverview, useDeskPulse, useRiskDesk } from "@/components/admin/api";
import { KpiRow, OverviewPanel, type AdminTab } from "@/components/admin/OverviewPanel";
import { LoopYesterdayPanel } from "@/components/admin/LoopYesterdayPanel";
import { type RiskStatus, type TraderFilter } from "@/components/admin/TradersTable";
import { PeoplePanel, type PeopleFilter, type PeopleView } from "@/components/admin/PeoplePanel";
import { ModerationQueue } from "@/components/admin/ModerationQueue";
import { RolesPanel } from "@/components/admin/RolesPanel";
import { AuditLog } from "@/components/admin/AuditLog";
import { DataPanel } from "@/components/admin/DataPanel";
import { AppErrorsPanel } from "@/components/admin/AppErrorsPanel";
import { DeskSettingsPanel } from "@/components/admin/DeskSettingsPanel";
import { DeskGroupsPanel } from "@/components/settings/groups-panel";
import { UsagePanel } from "@/components/admin/UsagePanel";
import { ALL_NAV_ITEMS, routeTitle } from "@/components/shell/nav";
import { blockableSections } from "@/components/shell/nav-model";
import { usageI18n } from "@/i18n/ns/usage";
import { RewardsEditorPanel } from "@/components/gamification/reward-editor";
import { RewardsAdminBlock } from "@/components/gamification/rewards-admin-block";
import { deskSettingsI18n } from "@/i18n/ns/deskSettings";
import { appErrorsI18n } from "@/i18n/ns/appErrors";
import { adminI18n } from "@/i18n/ns/admin";
import { useDataQuality, useEodQueueCount, useEodStatus, useHealth, useReviewLoad, useTiers } from "@/components/admin/console-api";

const TABS: AdminTab[] = ["overview", "people", "moderation", "roles", "settings", "usage", "data", "audit", "errors"];
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

/** The trader menu (no staff-only or hidden pages): «никто не открыл» in Использование is measured against it. */
const TRADER_MENU = ALL_NAV_ITEMS.filter((i) => !i.staff && !i.hidden).map((i) => ({ href: i.href, also: i.also, get name() { return i.name; } }));

/** «Доступ по ступеням» rows: the trader's sections grouped as in the sidebar (labels are getters: current language). */
const ACCESS_GROUPS = blockableSections();

/** Usage view: a route pattern ("/playbook?mode=mine") → the section name the shell shows for it (null = unknown). */
function screenLabel(key: string): string | null {
  const i = key.indexOf("?");
  return routeTitle(i < 0 ? key : key.slice(0, i), i < 0 ? "" : key.slice(i));
}

function initialFilter(): TraderFilter {
  try { return (localStorage.getItem(FILTER_KEY) as TraderFilter) || "all"; } catch { return "all"; }
}

function initialView(): PeopleView {
  try { return localStorage.getItem(VIEW_KEY) === "activity" ? "activity" : "manage"; } catch { return "manage"; }
}

export default function AdminPage() {
  const { isCurator } = useAuth();
  const { t } = adminI18n.useT();
  if (!isCurator) {
    return (
      <Page>
        <EmptyState
          icon={ShieldAlert}
          title={t("page.deniedTitle")}
          description={t("page.deniedText")}
          className="py-24"
        />
      </Page>
    );
  }
  return <AdminConsole />;
}

function AdminConsole() {
  const { user, isAdmin, can } = useAuth();
  const { t } = adminI18n.useT();
  // «Ошибки» (internal error tracker) is admin-only (capability admin.errors).
  const showErrors = isAdmin && can("admin.errors");
  // «Настройки деска» (thresholds, Telegram times, privacy) is admin-only too (capability settings.manage).
  const showSettings = isAdmin && can("settings.manage");
  // «Использование» (internal usage tracking for the pilot) is admin-only too (capability usage.read).
  const showUsage = isAdmin && can("usage.read");
  // OLGA-02: a curator sees only what they can use. «Роли» = the admin's matrix editor, «Аудит» needs admin.audit,
  // «Данные» (export, backups, jobs, quality) needs the export or the audit right — both admin-only by default.
  const showRoles = can("permissions.manage");
  const showAudit = can("admin.audit");
  const showData = can("admin.backups.read") || can("admin.audit");
  const { t: tSettings } = deskSettingsI18n.useT();
  const { t: tUsage } = usageI18n.useT();
  const hidden = useMemo(() => {
    const h = new Set<AdminTab>();
    if (!showErrors) h.add("errors");
    if (!showSettings) h.add("settings");
    if (!showUsage) h.add("usage");
    if (!showRoles) h.add("roles");
    if (!showAudit) h.add("audit");
    if (!showData) h.add("data");
    return h;
  }, [showErrors, showSettings, showUsage, showRoles, showAudit, showData]);
  const tabs = useMemo(() => TABS.filter((x) => !hidden.has(x)), [hidden]);
  const actor = user?.traderName ?? "";
  const qc = useQueryClient();
  const [tabState, setTabState] = useState<AdminTab>(initialTab);
  const tab: AdminTab = hidden.has(tabState) ? "overview" : tabState;
  const [traderFilter, setTraderFilterState] = useState<TraderFilter>(initialFilter);
  const [peopleView, setPeopleViewState] = useState<PeopleView>(initialView);
  // One-shot filter for «Люди → Управление» (the Обзор «Без куратора» link); cleared on the next tab switch.
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter | undefined>(undefined);

  const pulse = useDeskPulse(actor);
  const overview = useAdminOverview(actor);
  const risk = useRiskDesk();
  const health = useHealth();
  const eod = useEodStatus();
  const queue = useEodQueueCount();
  const tiers = useTiers();
  const quality = useDataQuality();
  const reviewLoad = useReviewLoad(can("journal.review"));

  const tierNames = useMemo(
    () => Object.fromEntries((tiers.data ?? []).map((t) => [t.key, t.name])) as Record<string, string>,
    [tiers.data],
  );

  const setTab = useCallback((t: AdminTab) => {
    setTabState(t);
    setPeopleFilter(undefined);
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

  const goNoCurator = useCallback(() => {
    setPeopleView("manage");
    setTab("people");
    setPeopleFilter("nocurator");
  }, [setTab, setPeopleView]);

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
      if (Number.isInteger(n) && n >= 1 && n <= tabs.length) { e.preventDefault(); setTab(tabs[n - 1]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab, tabs]);

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
        title={t("page.title")}
        description={t("page.description")}
        actions={
          <>
            <UpdatedAgo at={pulse.dataUpdatedAt} className="hidden sm:inline-flex" />
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label={t("page.refresh")} onClick={refreshAll} disabled={fetching}>
              <RefreshCw className={cn(fetching && "animate-spin motion-reduce:animate-none")} />
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-1">
        <SectionTabs<AdminTab>
          ariaLabel={t("page.sectionsAria")}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: t("page.tabs.overview"), icon: Activity },
            { value: "people", label: t("page.tabs.people"), icon: Users, count: unmatchedCount || undefined },
            { value: "moderation", label: t("page.tabs.moderation"), icon: Flag, count: openReports || undefined },
            ...(showRoles ? [{ value: "roles" as const, label: t("page.tabs.roles"), icon: KeyRound }] : []),
            ...(showSettings ? [{ value: "settings" as const, label: tSettings("tab"), icon: SlidersHorizontal }] : []),
            ...(showUsage ? [{ value: "usage" as const, label: tUsage("tab"), icon: BarChart3 }] : []),
            ...(showData ? [{ value: "data" as const, label: t("page.tabs.data"), icon: Database }] : []),
            ...(showAudit ? [{ value: "audit" as const, label: t("page.tabs.audit"), icon: ScrollText }] : []),
            ...(showErrors ? [{ value: "errors" as const, label: appErrorsI18n.t("tab"), icon: Bug }] : []),
          ]}
        />
        <p className="hidden items-center gap-1 self-end text-2xs text-muted-foreground md:inline-flex">
          <Kbd>1</Kbd>–<Kbd>{tabs.length}</Kbd> {t("page.shortcutHint")}
        </p>
      </div>

      <div role="tabpanel" aria-label={t("page.panelAria")}>
        {/* OWNER-22: the KPI strip belongs to «Обзор» only (it repeated above every tab). Волна 2 п. 2.4: «Петля вчера»
            is the focal point on top (pilot verdict for admins); the KPI strip and the overview are secondary below. */}
        {tab === "overview" && (
          <div className="flex flex-col gap-[var(--grid-gap)]">
            <LoopYesterdayPanel showPilot={showUsage} onOpenUsage={showUsage ? () => setTab("usage") : undefined} onOpenPeople={() => setTab("people")} />
            <KpiRow pulse={pulse.data} risk={risk.data} eod={eod.data} queue={queue.data} loading={pulse.isLoading} onGo={go} />
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
              canAudit={showAudit}
              reviewLoad={can("journal.review") ? (reviewLoad.isLoading ? undefined : reviewLoad.data ?? null) : null}
              onGoNoCurator={goNoCurator}
              rewards={<RewardsAdminBlock enabled={showSettings} onOpenCatalog={() => setTab("settings")} />}
            />
          </div>
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
            initialFilter={peopleFilter}
          />
        )}
        {tab === "moderation" && <ModerationQueue actor={actor} openCount={openReports} />}
        {tab === "roles" && <RolesPanel accessGroups={ACCESS_GROUPS} />}
        {tab === "settings" && (
          <div className="flex flex-col gap-[var(--grid-gap)]">
            {/* The rewards catalog sits with the other desk settings (gamification numbers live in the registry form below). */}
            <RewardsEditorPanel enabled={showSettings} />
            <DeskGroupsPanel enabled={showSettings} />
            <DeskSettingsPanel canManage={showSettings} />
          </div>
        )}
        {tab === "usage" && <UsagePanel enabled={showUsage} screenLabel={screenLabel} menu={TRADER_MENU} onOpenSettings={showSettings ? () => setTab("settings") : undefined} />}
        {tab === "data" && <DataPanel actor={actor} isAdmin={isAdmin} />}
        {tab === "audit" && <AuditLog actor={actor} tierNames={tierNames} />}
        {tab === "errors" && <AppErrorsPanel />}
      </div>
    </Page>
  );
}
