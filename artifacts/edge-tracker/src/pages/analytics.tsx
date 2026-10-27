import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { useGetTopPatterns } from "@workspace/api-client-react";
import { usePeriodTrades, useTradesBookFacets } from "@/hooks/use-trades-window";
import { field, useStatsAggregate } from "@/components/stats/aggregate";
import { type Dimension as StatsDimension } from "@/components/stats/breakdown-panel";
import { AggOverview } from "@/components/stats/agg-overview";
import { comparePersonNames, personName } from "@/i18n";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { TEAM, scopePickerValue } from "@/components/people/staff-scope";
import { analyticsDataPlan, type AnalyticsTabKey } from "@/components/analytics-page/data-plan";
import { Brain, Compass, Dices, FlaskConical, Grid3x3, Layers, LayoutDashboard, LineChart, RefreshCw, SearchX, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ChartSkeleton, Kbd, Page, PageHeader, Panel, EmptyState, StatGridSkeleton } from "@/components/ds";
import { AnalyticsTabBar } from "@/components/analytics-page/TabBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AnalyticsPro from "@/components/analytics/analytics-pro";
import { FilterBar, type FilterOptions } from "@/components/analytics-page/FilterBar";
import { OverviewTab } from "@/components/analytics-page/OverviewTab";
import { EdgeTab } from "@/components/analytics-page/EdgeTab";
import { EdgeMatrixTab } from "@/components/analytics-page/EdgeMatrixTab";
import { WhatIfTab } from "@/components/analytics-page/WhatIfTab";
import { MonteCarloTab } from "@/components/analytics-page/MonteCarloTab";
import { DeskTab } from "@/components/analytics-page/DeskTab";
import { PsychologyTab } from "@/components/analytics-page/PsychologyTab";
import { MyEdgeTab } from "@/components/analytics-page/my-edge/MyEdgeTab";
import {
  type AnalyticsFilters, type DimensionKey, type Unit,
  DEFAULT_FILTERS, DIMENSIONS, applyAnalyticsFilters, applyNonPeriodFilters, activeFilterCount, horizonLabel,
  realizedR, pnlValue, accountOf, customRangeOf, filtersRange, withHotkeys,
} from "@/components/analytics-page/metrics";
import { RangeFacetsPanel, useRangeFacets } from "@/components/shared/trade-facets/range-facets";
import { fmtDayRange } from "@/components/shared/period/PeriodPicker";
import { useAssistantContext } from "@/components/shared/ask-assistant";
import { useAnalyticsLinkCards } from "@/components/analytics-page/link-cards";
import { commonI18n } from "@/i18n/ns/common";
import { analyticsI18n } from "@/i18n/ns/analytics";
import { HelpButton, PageHint } from "@/components/shared/page-hint";

type TabKey = AnalyticsTabKey;

// Hotkeys follow the VISIBLE order (1…N): a trader without the staff-only tab gets 1–7, not 1–8 with a gap (MAKSIM-32).
// On view: the five tabs that answer «где мой edge»; the rest sit under «Ещё ▾» (design audit wave 2B: fewer choices).
const TAB_DEFS: { value: TabKey; icon: typeof LayoutDashboard; curatorOnly?: boolean; more?: boolean }[] = [
  { value: "overview", icon: LayoutDashboard },
  { value: "edge", icon: Layers },
  { value: "matrix", icon: Grid3x3 },
  { value: "psychology", icon: Brain },
  { value: "desk", icon: Users, curatorOnly: true },
  { value: "myedge", icon: Compass, more: true },
  { value: "whatif", icon: FlaskConical, more: true },
  { value: "montecarlo", icon: Dices, more: true },
  { value: "pro", icon: LineChart, more: true },
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
    const { facets: _facets, ...stored } = s.filters ?? {};
    const filters: AnalyticsFilters = { ...DEFAULT_FILTERS, ...stored };
    // «Всё время» is never restored (DEV-01): every visit starts on the cheap default window. «Свой период» is (valid).
    if (filters.period === "all" || (filters.period === "custom" && !customRangeOf(filters))) filters.period = DEFAULT_FILTERS.period;
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
  // «Вся команда» (staff): an explicit pick for this visit, never restored — the page opens on the viewer's own book.
  const [teamPick, setTeamPick] = useState(false);

  // Server-side window (DEV-01): the period first, the equally long previous one after it (comparison only), one
  // trader when picked. "Всё время" (on demand) still loads the whole scoped book.
  // Staff = traders + extras (owner rule 2026-10-21): one person — the viewer's own name unless another is picked —
  // is exactly the trader experience on raw trades; server sums (Волна 2 п. 2.5) only for «Вся команда» on
  // «Обзор», «Матрица», «Деск» (components/analytics-page/data-plan).
  const staffView = user?.role === "curator" || user?.role === "admin";
  const me = user?.traderName ?? null;
  const plan = analyticsDataPlan({ staff: staffView, me, picked: filters.trader, team: teamPick, tab });
  const { scope, needRaw } = plan;
  const scopeTrader = scope.trader ?? "";
  const periodWin = useMemo(() => filtersRange(filters), [filters.period, filters.from, filters.to]); // eslint-disable-line react-hooks/exhaustive-deps
  // «Разрезы»: raw trades are filtered here; the server-computed tabs (team overview, matrix, desk, psychology) get x*.
  const rf = useRangeFacets({ from: periodWin?.from, to: periodWin?.to, trader: scope.trader });
  /** The filters every tab sees: for staff on one person they carry that name (the own one by default), + «Разрезы». */
  const view = useMemo(() => ({ ...filters, trader: staffView ? scopeTrader : filters.trader, facets: rf.query || undefined }), [staffView, filters, scopeTrader, rf.query]);
  const rawQ = usePeriodTrades({
    from: periodWin?.from ?? null,
    to: filters.period === "custom" ? periodWin?.to ?? null : null,
    prevFrom: periodWin?.prevFrom ?? null,
    prevTo: periodWin?.prevTo ?? null,
    trader: scope.trader,
  }, needRaw);
  const aggBase = {
    scope: "desk" as const, trader: null, side: filters.side || null, horizon: filters.horizon || null,
    ticker: filters.ticker || null, setup: filters.setup || null, account: filters.account || null, source: filters.source || null,
    facets: rf.query,
  };
  const aggQ = useStatsAggregate({ ...aggBase, from: periodWin?.from ?? null, to: periodWin?.to ?? null }, plan.aggregate);
  const aggPrevQ = useStatsAggregate(
    { ...aggBase, from: periodWin?.prevFrom ?? null, to: periodWin?.prevTo ?? null, lite: true },
    plan.aggregate && !!periodWin && tab === "overview" && aggQ.isSuccess,
  );
  const agg = plan.aggregate ? aggQ.data : undefined;
  const facetFilter = rf.filter;
  const trades = useMemo(() => facetFilter(rawQ.data), [rawQ.data, facetFilter]);
  // Only the source the visible tab reads: a failed desk aggregate never blanks a per-trade tab, and vice versa.
  const isLoading = needRaw ? rawQ.isLoading : aggQ.isLoading;
  const isError = needRaw ? rawQ.isError : aggQ.isError;
  const refetch = useCallback(() => (needRaw ? rawQ.refetch() : aggQ.refetch()), [needRaw, aggQ, rawQ]);
  const prevLoading = rawQ.prevLoading;
  const facets = useTradesBookFacets(); // staff: the whole scope — the people of the picker
  const personFacets = useTradesBookFacets({ trader: scope.trader, enabled: staffView && !!scope.trader });
  const bookFacets = staffView && scope.trader ? personFacets : facets;
  // The book itself is empty (not just the chosen window) — only then show the "no trades yet" state.
  const bookEmpty = bookFacets.data ? bookFacets.data.total === 0 : !staffView && trades.length === 0 && filters.period === "all" && !filters.trader;
  /** Staff picker: TEAM, the own name (kept as no pick) or another person. */
  const pickTrader = useCallback((v: string) => {
    setTeamPick(v === TEAM);
    setFilters((f) => ({ ...f, trader: v === TEAM || v === me ? "" : v }));
  }, [me]);
  /** Tabs hand back `view`: the implicit own name is not a filter. */
  const changeFilters = useCallback(({ facets: _f, ...f }: AnalyticsFilters) => setFilters(staffView && me && f.trader === me ? { ...f, trader: "" } : f), [staffView, me]);
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
  // Trades come only from PropReports: no source filter (an old saved one is dropped); a trader has no person filter.
  useEffect(() => {
    if (filters.source || (user && !isCurator && filters.trader)) setFilters((f) => ({ ...f, source: "", trader: isCurator ? f.trader : "" }));
  }, [user, isCurator, filters.source, filters.trader]);
  useEffect(() => {
    if (dimension === "source") setDimension("horizon");
  }, [dimension]);
  const visibleTabs = useMemo(
    () => visibleTabDefs(isCurator).map((d) => ({ value: d.value, key: d.key, icon: d.icon, more: !!d.more, label: t(`tabs.${d.value}`) })),
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

  // Everyone with trades in the viewer's scope (traders, curators, admins) — the staff picker's people.
  const pickerNames = useMemo(
    () => [...new Set([...(facets.data?.traders ?? []), ...trades.map((tr) => tr.trader ?? "")].filter((x) => !!x))].sort(comparePersonNames),
    [facets.data, trades],
  );
  const options: FilterOptions = useMemo(() => {
    const o = agg?.options;
    if (o) {
      return { setups: o.setups, hasNoSetup: o.hasNoSetup, tickers: o.tickers, accounts: o.accounts };
    }
    const book = applyNonPeriodFilters(trades, { ...DEFAULT_FILTERS, trader: view.trader });
    const setups = [...new Set(book.map((tr) => tr.setup?.trim()).filter((x): x is string => !!x))].sort();
    const counts = new Map<string, number>();
    book.forEach((tr) => { const k = (tr.ticker ?? "").toUpperCase(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); });
    const tickers = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    const accounts = [...new Set(book.map(accountOf).filter(Boolean))].sort();
    return { setups, hasNoSetup: book.some((tr) => !tr.setup), tickers, accounts };
  }, [trades, view.trader, agg]);

  const filtered = useMemo(() => applyAnalyticsFilters(trades, view), [trades, view]);
  const current = filtered.current;
  // The comparison window loads after the current one: no deltas until it is there (never a half-loaded «previous»).
  const previous = prevLoading ? null : filtered.previous;
  const hasR = useMemo(() => (agg ? field(agg.total, "rN") > 0 : current.some((tr) => realizedR(tr) != null)), [agg, current]);
  const hasPnl = useMemo(() => (agg ? field(agg.total, "pnlN") > 0 : current.some((tr) => pnlValue(tr) != null)), [agg, current]);
  /** Trades of the window after the filters (staff: the server total). */
  const count = agg ? field(agg.total, "n") : current.length;
  const unit: Unit | null = unitPref === "usd" && hasPnl ? "usd" : hasR ? "r" : hasPnl ? "usd" : null;

  const openDimension = useCallback((d: DimensionKey) => { setDimension(d); setTab("edge"); }, []);

  const psychUser = isCurator ? (scopeTrader || me || "") : (me ?? "");

  const summary = useMemo(() => {
    const parts = [commonI18n.t("units.trades", { count })];
    parts.push(scope.self ? t("summary.mine") : scope.team ? t("summary.team") : personName(scope.trader));
    const custom = filters.period === "custom" ? customRangeOf(filters) : null;
    const preset = filters.period === "custom" ? DEFAULT_FILTERS.period : filters.period;
    parts.push(custom ? fmtDayRange(custom) : t(`period.${preset as Exclude<typeof preset, "custom">}`).toLowerCase());
    if (filters.horizon) parts.push(horizonLabel(filters.horizon).toLowerCase());
    if (!hasPnl && hasR) parts.push(t("summary.rOnly"));
    return parts.filter(Boolean).join(" · ");
  }, [count, filters, hasPnl, hasR, scope, t]);
  const cards = useAnalyticsLinkCards(filters, view, scope);
  // The page header's assistant question («Где мой edge и где утечки?») reads the same window and person.
  useAssistantContext({ ...(periodWin?.from ? { from: periodWin.from } : {}), ...(periodWin?.to ? { to: periodWin.to } : {}), ...(scope.trader ? { trader: scope.trader } : {}) });
  const lastKey = visibleTabs[visibleTabs.length - 1]?.key;
  const [hotBefore, hotAfter] = t("hotkeys", { range: "\u0000" }).split("\u0000");

  return (
    <Page>
      <PageHeader
        title={t("title")}
        icon={LineChart}
        description={isLoading ? t("loadingTrades") : summary}
        actions={<>
          <span className="hidden items-center gap-1 text-xs text-muted-foreground lg:inline-flex">
            {hotBefore}<Kbd>1</Kbd>–<Kbd>{lastKey}</Kbd>{hotAfter}
          </span>
          <HelpButton id="analytics" />
        </>}
      >
        <AnalyticsTabBar<TabKey> tabs={visibleTabs} value={tab} onChange={setTab} />
      </PageHeader>
      <PageHint id="analytics" />

      {/* Staff keep the trader picker on an empty / failed book too — the way to another person or the team. */}
      {!isLoading && (staffView || (!isError && !bookEmpty)) && (
        <FilterBar
          filters={filters}
          onChange={changeFilters}
          options={options}
          unit={unit ?? unitPref}
          onUnitChange={setUnitPref}
          hasPnl={hasPnl}
          hasR={hasR}
          traderPicker={staffView ? (
            <StaffTraderPicker
              value={scopePickerValue(scope)} onChange={pickTrader} me={me} names={pickerNames}
              ariaLabel={t("filters.trader")} className="h-9 w-auto min-w-[160px] max-w-[18rem]"
            />
          ) : undefined}
          className="lg:sticky lg:top-[var(--sticky-top)] lg:z-sticky lg:bg-[var(--sticky-bg)]"
        />
      )}
      {!isLoading && (staffView || (!isError && !bookEmpty)) && <RangeFacetsPanel rf={rf} />}

      {isError ? (
        <Panel>
          <EmptyState
            icon={LineChart}
            title={t("loadError.title")}
            description={t("loadError.description")}
            action={<Button onClick={() => void refetch()}><RefreshCw aria-hidden="true" /> {commonI18n.t("actions.retry")}</Button>}
          />
        </Panel>
      ) : isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("loadingAria")}>
          <Skeleton className="h-12 rounded-2xl" />
          <StatGridSkeleton count={8} min="10rem" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartSkeleton className="h-[330px] lg:col-span-2" height="100%" />
            <ChartSkeleton className="h-[330px]" height="100%" kind="bars" />
          </div>
        </div>
      ) : bookEmpty ? (
        <Panel>
          <EmptyState
            icon={LineChart}
            title={t("bookEmpty.title")}
            description={t("bookEmpty.description")}
            action={staffView && !scope.team
              ? <Button onClick={() => pickTrader(TEAM)}>{commonI18n.t("people.wholeTeam")}</Button>
              : <Button asChild><Link href="/trades">{t("bookEmpty.action")}</Link></Button>}
          />
        </Panel>
      ) : (
        <motion.div
          key={tab}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {tab === "myedge" ? (
            <MyEdgeTab filters={view} team={scope.team} />
          ) : tab === "psychology" ? (
            <PsychologyTab
              userId={psychUser} isOwn={psychUser === user?.traderName} filters={view} trades={current}
              behaviorLink={cards.behavior}
            />
          ) : count === 0 ? (
            <Panel>
              <EmptyState
                icon={SearchX}
                title={t("noMatch.title")}
                description={t("noMatch.description")}
                action={activeFilterCount(filters) > 0 ? <Button onClick={() => setFilters(DEFAULT_FILTERS)}>{commonI18n.t("actions.resetFilters")}</Button> : undefined}
              />
            </Panel>
          ) : tab === "overview" && agg ? (
            <AggOverview
              agg={agg} previous={aggPrevQ.data ?? null} unit={unit}
              dimension={statsDim} onDimension={setStatsDim}
              onPickTrader={pickTrader}
              onOpenEdge={() => openDimension("setup")}
              reportLink={cards.report}
            />
          ) : tab === "overview" ? (
            <OverviewTab trades={current} previous={previous} unit={unit} onOpenDimension={openDimension} reportLink={cards.report} />
          ) : tab === "matrix" ? (
            <EdgeMatrixTab filters={view} unit={unit} hasR={hasR} hasPnl={hasPnl} isCurator={isCurator} />
          ) : tab === "whatif" ? (
            <div className="flex flex-col gap-section">
              {cards.whatIf}
              <WhatIfTab trades={current} unit={unit} />
            </div>

          ) : tab === "montecarlo" ? (
            <MonteCarloTab trades={current} unit={unit} filters={view} />
          ) : tab === "desk" ? (
            <DeskTab filters={view} unit={unit} />
          ) : tab === "edge" ? (
            <EdgeTab
              trades={current}
              dimension={dimension}
              onDimensionChange={setDimension}
              filters={view}
              onFiltersChange={changeFilters}
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
