import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { useGetTopPatterns } from "@workspace/api-client-react";
import { usePeriodTrades, useTradesBookFacets } from "@/hooks/use-trades-window";
import { field, useStatsAggregate } from "@/components/stats/aggregate";
import { type Dimension as StatsDimension } from "@/components/stats/breakdown-panel";
import { AggOverview } from "@/components/stats/agg-overview";
import { comparePersonNames, personName } from "@/i18n";
import { BarChart3, Brain, Dices, FlaskConical, Grid3x3, LayoutDashboard, Layers, LineChart, RefreshCw, SearchX, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Page, PageHeader, Panel, Segmented, EmptyState, StatGrid } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AnalyticsPro from "@/components/analytics/analytics-pro";
import { BrokerStatsCard } from "@/components/propreports/BrokerStatsCard";
import { FilterBar, type FilterOptions } from "@/components/analytics-page/FilterBar";
import { OverviewTab } from "@/components/analytics-page/OverviewTab";
import { EdgeTab } from "@/components/analytics-page/EdgeTab";
import { EdgeMatrixTab } from "@/components/analytics-page/EdgeMatrixTab";
import { WhatIfTab } from "@/components/analytics-page/WhatIfTab";
import { MonteCarloTab } from "@/components/analytics-page/MonteCarloTab";
import { DeskTab } from "@/components/analytics-page/DeskTab";
import { PsychologyTab } from "@/components/analytics-page/PsychologyTab";
import {
  type AnalyticsFilters, type DimensionKey, type Unit,
  DEFAULT_FILTERS, DIMENSIONS, applyAnalyticsFilters, applyNonPeriodFilters, activeFilterCount, horizonLabel,
  realizedR, pnlValue, accountOf, sourceOf, periodRange, withHotkeys,
} from "@/components/analytics-page/metrics";
import { commonI18n } from "@/i18n/ns/common";
import { analyticsI18n } from "@/i18n/ns/analytics";

type TabKey = "overview" | "edge" | "matrix" | "whatif" | "montecarlo" | "desk" | "psychology" | "pro";
/** Tabs that compute from every trade: staff load the raw trades only when one of them is open (Волна 2 п. 2.5). */
const RAW_TABS: readonly TabKey[] = ["edge", "whatif", "montecarlo", "psychology", "pro"];

// Hotkeys follow the VISIBLE order (1…N): a trader without the staff-only tab gets 1–7, not 1–8 with a gap (MAKSIM-32).
const TAB_DEFS: { value: TabKey; icon: typeof LayoutDashboard; curatorOnly?: boolean }[] = [
  { value: "overview", icon: LayoutDashboard },
  { value: "edge", icon: Layers },
  { value: "matrix", icon: Grid3x3 },
  { value: "whatif", icon: FlaskConical },
  { value: "montecarlo", icon: Dices },
  { value: "desk", icon: Users, curatorOnly: true },
  { value: "psychology", icon: Brain },
  { value: "pro", icon: LineChart },
];

/** Tabs a viewer sees, each with its hotkey «1»…«9» by position. */
function visibleTabDefs(isCurator: boolean) {
  return withHotkeys(TAB_DEFS.filter((d) => !d.curatorOnly || isCurator));
}

const STORAGE_KEY = "analytics.page.v2";

/**
 * Old tab ids: «Издержки» (costs) was merged into the compact «Что если» tab — the fee what-ifs and the per-group
 * cost table live on /what-if. A saved or linked `costs` opens `whatif`.
 */
function asTab(v: unknown): TabKey | null {
  if (v === "costs") return "whatif";
  return TAB_DEFS.some((x) => x.value === v) ? (v as TabKey) : null;
}

type Saved = { tab: TabKey; filters: AnalyticsFilters; unit: Unit; dimension: DimensionKey };

function loadSaved(): Saved {
  const fallback: Saved = { tab: "overview", filters: DEFAULT_FILTERS, unit: "r", dimension: "horizon" };
  // A link with ?tab=<key> wins over the remembered tab.
  const fromUrl = asTab(new URLSearchParams(window.location.search).get("tab"));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fromUrl ? { ...fallback, tab: fromUrl } : fallback;
    const s = JSON.parse(raw) as Partial<Saved>;
    const filters = { ...DEFAULT_FILTERS, ...(s.filters ?? {}) };
    // «Всё время» is never restored (DEV-01): every visit starts on the cheap default window.
    if (filters.period === "all") filters.period = DEFAULT_FILTERS.period;
    return {
      tab: fromUrl ?? asTab(s.tab) ?? fallback.tab,
      filters,
      unit: s.unit === "usd" ? "usd" : "r",
      dimension: DIMENSIONS.some((d) => d.key === s.dimension) ? (s.dimension as DimensionKey) : fallback.dimension,
    };
  } catch {
    return fromUrl ? { ...fallback, tab: fromUrl } : fallback;
  }
}

export default function Analytics() {
  const { t } = analyticsI18n.useT();
  const { user } = useAuth();
  const { data: topPatterns } = useGetTopPatterns();
  const reduceMotion = useReducedMotion();

  const [saved] = useState(loadSaved);
  const [tab, setTab] = useState<TabKey>(saved.tab);
  const [filters, setFilters] = useState<AnalyticsFilters>(saved.filters);

  // Server-side window (DEV-01): the period first, the equally long previous one after it (comparison only), one
  // trader when picked. "Всё время" (on demand) still loads the whole scoped book.
  // Staff (Волна 2 п. 2.5): «Обзор», «Матрица», «Деск» run on server sums — the raw trades of the desk load only
  // when a per-trade tab is open; a trader keeps the own raw trades.
  const staffView = user?.role === "curator" || user?.role === "admin";
  const needRaw = !staffView || RAW_TABS.includes(tab);
  const periodWin = useMemo(() => periodRange(filters.period), [filters.period]);
  const rawQ = usePeriodTrades({
    from: periodWin?.from ?? null,
    prevFrom: periodWin?.prevFrom ?? null,
    prevTo: periodWin?.prevTo ?? null,
    trader: filters.trader || null,
  }, needRaw);
  const aggBase = {
    scope: "desk" as const, trader: filters.trader || null, side: filters.side || null, horizon: filters.horizon || null,
    ticker: filters.ticker || null, setup: filters.setup || null, account: filters.account || null, source: filters.source || null,
  };
  const aggQ = useStatsAggregate({ ...aggBase, from: periodWin?.from ?? null, to: periodWin?.to ?? null }, staffView);
  const aggPrevQ = useStatsAggregate(
    { ...aggBase, from: periodWin?.prevFrom ?? null, to: periodWin?.prevTo ?? null, lite: true },
    staffView && !!periodWin && tab === "overview" && aggQ.isSuccess,
  );
  const agg = staffView ? aggQ.data : undefined;
  const trades = useMemo(() => rawQ.data ?? [], [rawQ.data]);
  const isLoading = (needRaw && rawQ.isLoading) || (staffView && aggQ.isLoading);
  const isError = (needRaw && rawQ.isError) || (staffView && aggQ.isError);
  const refetch = useCallback(() => (staffView ? aggQ.refetch() : rawQ.refetch()), [staffView, aggQ, rawQ]);
  const prevLoading = rawQ.prevLoading;
  const facets = useTradesBookFacets();
  // The book itself is empty (not just the chosen window) — only then show the "no trades yet" state.
  const bookEmpty = facets.data ? facets.data.total === 0 : !staffView && trades.length === 0 && filters.period === "all" && !filters.trader;
  const [statsDim, setStatsDim] = useState<StatsDimension>("trader");
  const [unitPref, setUnitPref] = useState<Unit>(saved.unit);
  const [dimension, setDimension] = useState<DimensionKey>(saved.dimension);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, filters, unit: unitPref, dimension }));
    } catch { /* storage unavailable */ }
  }, [tab, filters, unitPref, dimension]);
  // Mirror the tab into the URL (?tab=…, replaceState) so a copied link opens the same tab.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (tab === "overview") sp.delete("tab"); else sp.set("tab", tab);
    const q = sp.toString();
    const next = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  }, [tab]);

  const isCurator = user?.role === "curator" || user?.role === "admin";
  // The source switch is staff-only; drop a source filter a trader may have saved earlier (it would be invisible).
  useEffect(() => {
    if (user && !isCurator && (filters.source || filters.trader)) setFilters((f) => ({ ...f, source: "", trader: "" }));
  }, [user, isCurator, filters.source, filters.trader]);
  useEffect(() => {
    if (user && !isCurator && dimension === "source") setDimension("horizon");
  }, [user, isCurator, dimension]);
  const visibleTabs = useMemo(
    () => visibleTabDefs(isCurator).map((d) => {
      const Icon = d.icon;
      return { value: d.value, key: d.key, label: <><Icon className="h-3.5 w-3.5" aria-hidden="true" />{t(`tabs.${d.value}`)}</> };
    }),
    [isCurator, t],
  );

  // 1–9 switch tabs (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const hit = visibleTabs.find((x) => x.key === e.key);
      if (hit) setTab(hit.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleTabs]);

  // A saved curator-only tab must not survive a role change.
  useEffect(() => {
    if (!visibleTabs.some((x) => x.value === tab)) setTab("overview");
  }, [visibleTabs, tab]);

  const options: FilterOptions = useMemo(() => {
    const traders = [...new Set([...(facets.data?.traders ?? []), ...trades.map((tr) => tr.trader ?? "")].filter((x) => !!x))]
      .sort(comparePersonNames);
    const o = agg?.options;
    if (o) {
      return {
        traders, setups: o.setups, hasNoSetup: o.hasNoSetup, tickers: o.tickers, accounts: o.accounts, hasMixedSources: o.sources.length > 1,
      };
    }
    const scope = applyNonPeriodFilters(trades, { ...DEFAULT_FILTERS, trader: filters.trader });
    const setups = [...new Set(scope.map((tr) => tr.setup?.trim()).filter((x): x is string => !!x))].sort();
    const counts = new Map<string, number>();
    scope.forEach((tr) => { const k = (tr.ticker ?? "").toUpperCase(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); });
    const tickers = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    const accounts = [...new Set(scope.map(accountOf).filter(Boolean))].sort();
    const sources = new Set(scope.map(sourceOf));
    return { traders, setups, hasNoSetup: scope.some((tr) => !tr.setup), tickers, accounts, hasMixedSources: sources.size > 1 };
  }, [trades, filters.trader, facets.data, agg]);

  const filtered = useMemo(() => applyAnalyticsFilters(trades, filters), [trades, filters]);
  const current = filtered.current;
  // The comparison window loads after the current one: no deltas until it is there (never a half-loaded «previous»).
  const previous = prevLoading ? null : filtered.previous;
  const hasR = useMemo(() => (agg ? field(agg.total, "rN") > 0 : current.some((tr) => realizedR(tr) != null)), [agg, current]);
  const hasPnl = useMemo(() => (agg ? field(agg.total, "pnlN") > 0 : current.some((tr) => pnlValue(tr) != null)), [agg, current]);
  /** Trades of the window after the filters (staff: the server total). */
  const count = agg && !needRaw ? field(agg.total, "n") : current.length;
  const unit: Unit | null = unitPref === "usd" && hasPnl ? "usd" : hasR ? "r" : hasPnl ? "usd" : null;

  const openDimension = useCallback((d: DimensionKey) => { setDimension(d); setTab("edge"); }, []);

  const psychUser = isCurator ? (filters.trader || user?.traderName || "") : (user?.traderName ?? "");

  const summary = useMemo(() => {
    const parts = [commonI18n.t("units.trades", { count })];
    parts.push(personName(filters.trader) || (isCurator ? t("summary.team") : t("summary.mine")));
    parts.push(t(`period.${filters.period}`).toLowerCase());
    if (filters.horizon) parts.push(horizonLabel(filters.horizon).toLowerCase());
    if (!hasPnl && hasR) parts.push(t("summary.rOnly"));
    return parts.filter(Boolean).join(" · ");
  }, [count, filters, hasPnl, hasR, isCurator, t]);
  const lastKey = visibleTabs[visibleTabs.length - 1]?.key;
  const [hotBefore, hotAfter] = t("hotkeys", { range: "\u0000" }).split("\u0000");

  return (
    <Page>
      <PageHeader
        title={t("title")}
        icon={BarChart3}
        description={isLoading ? t("loadingTrades") : summary}
        actions={
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {hotBefore}<kbd className="rounded bg-[var(--glass-bg)] px-1.5 py-0.5 font-sans">1</kbd>–<kbd className="rounded bg-[var(--glass-bg)] px-1.5 py-0.5 font-sans">{lastKey}</kbd>{hotAfter}
          </span>
        }
      >
        <Segmented<TabKey> ariaLabel={t("tabsAria")} options={visibleTabs} value={tab} onChange={setTab} className="self-start" />
      </PageHeader>

      {!isError && !isLoading && !bookEmpty && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          options={options}
          unit={unit ?? unitPref}
          onUnitChange={setUnitPref}
          hasPnl={hasPnl}
          hasR={hasR}
          showTrader={isCurator}
          showSource={isCurator}
          className="lg:sticky lg:top-[var(--sticky-top)] lg:z-sticky lg:bg-[var(--sticky-bg)]"
        />
      )}

      {!isError && (tab === "overview" || bookEmpty) && (
        <BrokerStatsCard trader={(isCurator && filters.trader) || user?.traderName} />
      )}

      {isError ? (
        <Panel>
          <EmptyState
            icon={BarChart3}
            title={t("loadError.title")}
            description={t("loadError.description")}
            action={<Button variant="outline" onClick={() => void refetch()}><RefreshCw aria-hidden="true" /> {commonI18n.t("actions.retry")}</Button>}
          />
        </Panel>
      ) : isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("loadingAria")}>
          <Skeleton className="h-12 rounded-2xl" />
          <StatGrid>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[96px] rounded-2xl" />)}</StatGrid>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Skeleton className="h-[330px] rounded-2xl lg:col-span-2" />
            <Skeleton className="h-[330px] rounded-2xl" />
          </div>
        </div>
      ) : bookEmpty ? (
        <Panel>
          <EmptyState
            icon={BarChart3}
            title={t("bookEmpty.title")}
            description={t("bookEmpty.description")}
            action={<Button asChild><Link href="/trades">{t("bookEmpty.action")}</Link></Button>}
          />
        </Panel>
      ) : (
        <motion.div
          key={tab}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {tab === "psychology" ? (
            <PsychologyTab userId={psychUser} isOwn={psychUser === user?.traderName} filters={filters} trades={current} />
          ) : count === 0 ? (
            <Panel>
              <EmptyState
                icon={SearchX}
                title={t("noMatch.title")}
                description={t("noMatch.description")}
                action={activeFilterCount(filters) > 0 ? <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>{commonI18n.t("actions.resetFilters")}</Button> : undefined}
              />
            </Panel>
          ) : tab === "overview" && agg ? (
            <AggOverview
              agg={agg} previous={aggPrevQ.data ?? null} unit={unit} horizon={filters.horizon}
              dimension={statsDim} onDimension={setStatsDim}
              onHorizon={(h) => setFilters((f) => ({ ...f, horizon: h }))}
              onPickTrader={!filters.trader ? (name) => setFilters((f) => ({ ...f, trader: name })) : undefined}
              onOpenEdge={() => openDimension("setup")}
            />
          ) : tab === "overview" ? (
            <OverviewTab trades={current} previous={previous} unit={unit} onOpenDimension={openDimension} />
          ) : tab === "matrix" ? (
            <EdgeMatrixTab filters={filters} unit={unit} hasR={hasR} hasPnl={hasPnl} isCurator={isCurator} />
          ) : tab === "whatif" ? (
            <WhatIfTab trades={current} unit={unit} filters={filters} />

          ) : tab === "montecarlo" ? (
            <MonteCarloTab trades={current} unit={unit} filters={filters} />
          ) : tab === "desk" ? (
            <DeskTab filters={filters} unit={unit} />
          ) : tab === "edge" ? (
            <EdgeTab
              trades={current}
              dimension={dimension}
              onDimensionChange={setDimension}
              filters={filters}
              onFiltersChange={setFilters}
              hasR={hasR}
              hasPnl={hasPnl}
              topPatterns={topPatterns}
              isStaff={isCurator}
            />
          ) : (
            <AnalyticsPro trades={current} />
          )}
        </motion.div>
      )}
    </Page>
  );
}
