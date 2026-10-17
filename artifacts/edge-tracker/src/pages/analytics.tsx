import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { useGetTopPatterns } from "@workspace/api-client-react";
import { useTradesBookFacets, useTradesWindow } from "@/hooks/use-trades-window";
import { BarChart3, Brain, Dices, FlaskConical, Grid3x3, LayoutDashboard, Layers, LineChart, Receipt, RefreshCw, SearchX, Users } from "lucide-react";
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
import { CostsTab } from "@/components/analytics-page/CostsTab";
import { WhatIfTab } from "@/components/analytics-page/WhatIfTab";
import { MonteCarloTab } from "@/components/analytics-page/MonteCarloTab";
import { DeskTab } from "@/components/analytics-page/DeskTab";
import { PsychologyTab } from "@/components/analytics-page/PsychologyTab";
import {
  type AnalyticsFilters, type DimensionKey, type Unit,
  DEFAULT_FILTERS, DIMENSIONS, PERIOD_OPTIONS, HORIZON_LABEL, applyAnalyticsFilters, applyNonPeriodFilters, activeFilterCount,
  realizedR, pnlValue, sdeal, accountOf, sourceOf, periodRange,
} from "@/components/analytics-page/metrics";

type TabKey = "overview" | "edge" | "matrix" | "costs" | "whatif" | "montecarlo" | "desk" | "psychology" | "pro";

const TABS: { value: TabKey; label: React.ReactNode; key: string; curatorOnly?: boolean }[] = [
  { value: "overview", key: "1", label: <><LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />Обзор</> },
  { value: "edge", key: "2", label: <><Layers className="h-3.5 w-3.5" aria-hidden="true" />Преимущество</> },
  { value: "matrix", key: "3", label: <><Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" />Матрица</> },
  { value: "costs", key: "4", label: <><Receipt className="h-3.5 w-3.5" aria-hidden="true" />Издержки</> },
  { value: "whatif", key: "5", label: <><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />Что если</> },
  { value: "montecarlo", key: "6", label: <><Dices className="h-3.5 w-3.5" aria-hidden="true" />Монте-Карло</> },
  { value: "desk", key: "7", label: <><Users className="h-3.5 w-3.5" aria-hidden="true" />Деск</>, curatorOnly: true },
  { value: "psychology", key: "8", label: <><Brain className="h-3.5 w-3.5" aria-hidden="true" />Психология</> },
  { value: "pro", key: "9", label: <><LineChart className="h-3.5 w-3.5" aria-hidden="true" />Pro</> },
];

const STORAGE_KEY = "analytics.page.v2";

type Saved = { tab: TabKey; filters: AnalyticsFilters; unit: Unit; dimension: DimensionKey };

function loadSaved(): Saved {
  const fallback: Saved = { tab: "overview", filters: DEFAULT_FILTERS, unit: "r", dimension: "horizon" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Saved>;
    return {
      tab: TABS.some((t) => t.value === s.tab) ? (s.tab as TabKey) : fallback.tab,
      filters: { ...DEFAULT_FILTERS, ...(s.filters ?? {}) },
      unit: s.unit === "usd" ? "usd" : "r",
      dimension: DIMENSIONS.some((d) => d.key === s.dimension) ? (s.dimension as DimensionKey) : fallback.dimension,
    };
  } catch {
    return fallback;
  }
}

export default function Analytics() {
  const { user } = useAuth();
  const { data: topPatterns } = useGetTopPatterns();
  const reduceMotion = useReducedMotion();

  const [saved] = useState(loadSaved);
  const [tab, setTab] = useState<TabKey>(saved.tab);
  const [filters, setFilters] = useState<AnalyticsFilters>(saved.filters);

  // Server-side window (P1-5): the period + the equally long previous one (comparison), one trader when picked.
  // "Всё время" still loads the whole scoped book.
  const periodWin = useMemo(() => periodRange(filters.period), [filters.period]);
  const { data: trades = [], isLoading, isError, refetch } = useTradesWindow({ from: periodWin?.prevFrom ?? null, trader: filters.trader || null });
  const facets = useTradesBookFacets();
  // The book itself is empty (not just the chosen window) — only then show the "no trades yet" state.
  const bookEmpty = facets.data ? facets.data.total === 0 : trades.length === 0 && filters.period === "all" && !filters.trader;
  const [unitPref, setUnitPref] = useState<Unit>(saved.unit);
  const [dimension, setDimension] = useState<DimensionKey>(saved.dimension);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, filters, unit: unitPref, dimension }));
    } catch { /* storage unavailable */ }
  }, [tab, filters, unitPref, dimension]);

  const isCurator = user?.role === "curator" || user?.role === "admin";
  // The source switch is staff-only; drop a source filter a trader may have saved earlier (it would be invisible).
  useEffect(() => {
    if (user && !isCurator && filters.source) setFilters((f) => ({ ...f, source: "" }));
  }, [user, isCurator, filters.source]);
  useEffect(() => {
    if (user && !isCurator && dimension === "source") setDimension("horizon");
  }, [user, isCurator, dimension]);
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.curatorOnly || isCurator), [isCurator]);

  // 1–9 switch tabs (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const t = visibleTabs.find((x) => x.key === e.key);
      if (t) setTab(t.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleTabs]);

  // A saved curator-only tab must not survive a role change.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.value === tab)) setTab("overview");
  }, [visibleTabs, tab]);

  const options: FilterOptions = useMemo(() => {
    const traders = [...new Set([...(facets.data?.traders ?? []), ...trades.map((t) => t.trader ?? "")].filter((x) => !!x))]
      .sort((a, b) => a.localeCompare(b, "ru"));
    const scope = applyNonPeriodFilters(trades, { ...DEFAULT_FILTERS, trader: filters.trader });
    const setups = [...new Set(scope.map((t) => t.setup?.trim()).filter((x): x is string => !!x))].sort();
    const counts = new Map<string, number>();
    scope.forEach((t) => { const k = (t.ticker ?? "").toUpperCase(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); });
    const tickers = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    const accounts = [...new Set(scope.map(accountOf).filter(Boolean))].sort();
    const sources = new Set(scope.map(sourceOf));
    return { traders, setups, hasNoSetup: scope.some((t) => !t.setup), tickers, accounts, hasMixedSources: sources.size > 1 };
  }, [trades, filters.trader, facets.data]);

  const { current, previous } = useMemo(() => applyAnalyticsFilters(trades, filters), [trades, filters]);
  const hasR = useMemo(() => current.some((t) => realizedR(t) != null), [current]);
  const hasPnl = useMemo(() => current.some((t) => pnlValue(t) != null), [current]);
  const unit: Unit | null = unitPref === "usd" && hasPnl ? "usd" : hasR ? "r" : hasPnl ? "usd" : null;

  const openDimension = useCallback((d: DimensionKey) => { setDimension(d); setTab("edge"); }, []);

  const psychUser = isCurator ? (filters.trader || user?.traderName || "") : (user?.traderName ?? "");

  const summary = useMemo(() => {
    const parts = [sdeal(current.length)];
    parts.push(filters.trader || "вся команда");
    parts.push(PERIOD_OPTIONS.find((p) => p.value === filters.period)?.label.toLowerCase() ?? "");
    if (filters.horizon) parts.push(HORIZON_LABEL[filters.horizon].toLowerCase());
    if (!hasPnl && hasR) parts.push("P&L не заполнен — считаем в R");
    return parts.filter(Boolean).join(" · ");
  }, [current.length, filters, hasPnl, hasR]);

  return (
    <Page>
      <PageHeader
        title="Аналитика"
        icon={BarChart3}
        description={isLoading ? "Загружаем сделки…" : summary}
        actions={
          <span className="hidden text-xs text-muted-foreground lg:inline">
            Клавиши <kbd className="rounded bg-[var(--glass-bg)] px-1.5 py-0.5 font-sans">1</kbd>–<kbd className="rounded bg-[var(--glass-bg)] px-1.5 py-0.5 font-sans">{visibleTabs[visibleTabs.length - 1]?.key}</kbd> — вкладки
          </span>
        }
      >
        <Segmented<TabKey> ariaLabel="Разделы аналитики" options={visibleTabs} value={tab} onChange={setTab} className="self-start" />
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
          showTrader={isCurator || options.traders.length > 1}
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
            title="Не удалось загрузить сделки"
            description="Проверьте соединение и попробуйте ещё раз."
            action={<Button variant="outline" onClick={() => void refetch()}><RefreshCw aria-hidden="true" /> Повторить</Button>}
          />
        </Panel>
      ) : isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Загрузка аналитики">
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
            title="Пока нет сделок"
            description="Аналитика строится по журналу сделок. Запишите первые сделки со стопом и выходом — R, win rate и разрезы посчитаются автоматически."
            action={<Button asChild><Link href="/trades">Перейти к сделкам</Link></Button>}
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
          ) : current.length === 0 ? (
            <Panel>
              <EmptyState
                icon={SearchX}
                title="Под фильтры не попала ни одна сделка"
                description="Расширьте период или снимите часть фильтров."
                action={activeFilterCount(filters) > 0 ? <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>Сбросить фильтры</Button> : undefined}
              />
            </Panel>
          ) : tab === "overview" ? (
            <OverviewTab trades={current} previous={previous} unit={unit} onOpenDimension={openDimension} />
          ) : tab === "matrix" ? (
            <EdgeMatrixTab filters={filters} unit={unit} hasR={hasR} hasPnl={hasPnl} isCurator={isCurator} />
          ) : tab === "costs" ? (
            <CostsTab filters={filters} isCurator={isCurator} />
          ) : tab === "whatif" ? (
            <WhatIfTab trades={current} unit={unit} />
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
