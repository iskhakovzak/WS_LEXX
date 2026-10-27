/**
 * «Бенчмарк деска» — team comparison for curators / head of desk (GET /api/benchmark, /api/benchmark/same-ticker).
 * Staff: table (sort, sparkline, badges), heatmap of desk percentiles, «один тикер — один день», two-trader compare,
 * 4-weeks trend. Trader: own row vs the anonymised desk median + own trend.
 * URL: ?tab=table|heatmap|same|compare|trend&a=&b= and the group's shared period (?period=week|month|quarter|year|all,
 * custom + &from=&to=; hooks/use-analytics-scope) — rolling windows ending today (old calendar ?period=week links still open).
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Download, Flame, GitCompare, Scale, Table2, TrendingUp, Users } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel, Pill, SectionTabs, StatCard, StatGrid, Toolbar, toneOf, type SectionTab } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/components/analytics-page/metrics";
import { QueryError } from "@/components/query-error";
import { useBenchmark, useSameTicker, type BenchParams, type BenchmarkResponse } from "@/components/benchmark/api";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { RangeFacetSections, rangeFacetChips, rangeFacetCount, resetRangeFacets, useRangeFacets } from "@/components/shared/trade-facets/range-facets";
import { ActiveFilters, FilterSection, FiltersButton } from "@/components/shared/filters/filter-toolbar";
import { ANALYTICS_PRESETS, useAnalyticsScope, type AnalyticsPreset } from "@/hooks/use-analytics-scope";
import { BenchmarkTable } from "@/components/benchmark/benchmark-table";
import { BenchmarkHeatmap } from "@/components/benchmark/heatmap";
import { SameTickerView } from "@/components/benchmark/same-ticker";
import { CompareView } from "@/components/benchmark/compare";
import { TrendView } from "@/components/benchmark/trend";
import { SelfView } from "@/components/benchmark/self-view";
import { fmtDateRange, fmtRate, fmtUsd } from "@/lib/format";
import { benchmarkI18n } from "@/i18n/ns/benchmark";
import { personName } from "@/i18n";
import { rich } from "@/i18n/rich";
import { cn } from "@/lib/utils";
import { metricLabel } from "@/components/benchmark/format";

type Tab = "table" | "heatmap" | "same" | "compare" | "trend";
const TABS: Tab[] = ["table", "heatmap", "same", "compare", "trend"];
const MIN_TRADES_KEY = "ws.benchmark.minTrades.v1";
const MIN_TRADES_DEFAULT = 5;
function loadMinTrades(): number {
  try {
    const n = Math.floor(Number(localStorage.getItem(MIN_TRADES_KEY)));
    return Number.isFinite(n) && n >= 1 && n <= 500 ? n : MIN_TRADES_DEFAULT;
  } catch { return MIN_TRADES_DEFAULT; }
}

/** The table as a report: raw values (no $ / % formatting) so it opens cleanly in a spreadsheet. */
function exportCsv(data: BenchmarkResponse) {
  const t = benchmarkI18n.t;
  const header = [t("csv.trader"), t("csv.trades"), t("csv.qualified"), ...data.metrics.map(metricLabel)];
  const rows = data.rows.map((r) => [
    personName(r.trader), r.trades, r.qualified ? t("csv.yes") : t("csv.no"),
    ...data.metrics.map((m) => { const v = r[m.key] as unknown; return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 10000 : ""; }),
  ]);
  downloadCsv(`benchmark_${data.period.from}_${data.period.to}.csv`, header, rows);
}

function useUrlState() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const q = useMemo(() => new URLSearchParams(search), [search]);
  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") n.delete(k); else n.set(k, v); }
    const s = n.toString();
    navigate(s ? `${location}?${s}` : location, { replace: true });
  };
  return { q, set };
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={benchmarkI18n.t("loadingAria")}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      <Skeleton className="h-10 w-full rounded-xl" />
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
    </div>
  );
}

export default function BenchmarkPage() {
  const { t } = benchmarkI18n.useT();
  const { q, set } = useUrlState();
  const tab: Tab = TABS.includes(q.get("tab") as Tab) ? (q.get("tab") as Tab) : "table";
  // The group's shared period (no person here: the benchmark is the desk). Presets are rolling windows ending today.
  const sc = useAnalyticsScope();
  const custom = sc.period === "custom" ? sc.custom : null;
  // The field may be cleared while typing; the query follows the last valid number, 400 ms after typing stops.
  const [minTrades, setMinTrades] = useState(loadMinTrades);
  const [minText, setMinText] = useState(() => String(minTrades));
  useEffect(() => { try { localStorage.setItem(MIN_TRADES_KEY, String(minTrades)); } catch { /* storage unavailable */ } }, [minTrades]);
  useEffect(() => {
    const n = Math.floor(Number(minText));
    if (minText.trim() === "" || !Number.isFinite(n) || n < 1) return;
    const id = window.setTimeout(() => setMinTrades(Math.min(n, 500)), 400);
    return () => window.clearTimeout(id);
  }, [minText]);
  const [selected, setSelected] = useState<string[]>([]);
  const a = q.get("a");
  const b = q.get("b");

  const [win, setWin] = useState<{ from: string; to: string } | null>(null);
  // «Разрезы» over the benchmark window (the period's own window; the server's answer for «Всё»), applied to everyone.
  const rf = useRangeFacets(sc.window ?? { from: win?.from, to: win?.to });
  const facets = rf.query || undefined;
  const params: BenchParams = custom
    ? { period: "custom", minTrades, ...custom, facets }
    : sc.days != null ? { period: "days", days: sc.days, minTrades, facets } : { period: "all", minTrades, facets };
  const setMin = (n: number) => { setMinTrades(n); setMinText(String(n)); };
  const resetAll = () => { setMin(MIN_TRADES_DEFAULT); resetRangeFacets(rf); };
  const summary = useBenchmark(params);
  const data = summary.data;
  const dataFrom = data?.period.from, dataTo = data?.period.to;
  useEffect(() => { if (dataFrom && dataTo) setWin((w) => (w?.from === dataFrom && w.to === dataTo ? w : { from: dataFrom, to: dataTo })); }, [dataFrom, dataTo]);
  const staff = data?.mode === "desk";
  const same = useSameTicker(params, staff === true && tab === "same");

  // two checked rows → compare
  useEffect(() => {
    if (selected.length === 2) set({ tab: "compare", a: selected[0], b: selected[1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const toggleSelect = (t: string) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t].slice(-2)));

  const desk = useMemo(() => {
    const rows = data?.rows ?? [];
    const money = rows.filter((r) => r.net != null);
    const net = money.reduce((s, r) => s + (r.net ?? 0), 0);
    const fees = money.reduce((s, r) => s + (r.fees ?? 0), 0);
    const gross = money.reduce((s, r) => s + (r.gross ?? 0), 0);
    return {
      traders: rows.length,
      trades: rows.reduce((s, r) => s + r.trades, 0),
      net: money.length ? net : null,
      feeShare: gross > 0 ? fees / gross : null,
      breaches: rows.filter((r) => r.consistencyFlag === "breach").length,
      weaker: (data?.trend ?? []).filter((t) => t.verdict === "worse").length,
      best: [...money].sort((x, y) => (y.net ?? 0) - (x.net ?? 0))[0] ?? null,
      // Who needs attention: the consistency breach or a worse last 4 weeks (the same two counts as the KPI card).
      attention: [...new Set([
        ...rows.filter((r) => r.consistencyFlag === "breach").map((r) => r.trader),
        ...(data?.trend ?? []).filter((t) => t.verdict === "worse").map((t) => t.trader),
      ])],
    };
  }, [data]);

  const tabs: SectionTab<Tab>[] = [
    { value: "table", label: t("tab.table"), icon: Table2, count: data?.rows.length },
    { value: "heatmap", label: t("tab.heatmap"), icon: Flame },
    { value: "same", label: t("tab.same"), icon: Users, count: same.data?.total },
    { value: "compare", label: t("tab.compare"), icon: GitCompare },
    { value: "trend", label: t("tab.trend"), icon: TrendingUp },
  ];

  return (
    <Page>
      <PageHeader
        title={t("title")}
        icon={Scale}
        description={staff === false ? t("descSelf") : t("descDesk")}
        actions={data && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {fmtDateRange(data.period.from, data.period.to, "short")} · NY
          </span>
        )}
      >
        {/* The answer first (design audit wave 2B): the desk's net, its leader and who needs attention, in one line. */}
        {staff && data && data.rows.length > 0 && (
          <p className="text-base font-medium text-foreground sm:text-lg" data-testid="benchmark-verdict">
            {rich(t("verdict.net", { net: "{net}" }), {
              net: <span className={cn("font-semibold tabular-nums", desk.net == null || desk.net === 0 ? "" : desk.net > 0 ? "text-up" : "text-down")}>{desk.net != null ? fmtUsd(desk.net, { signed: true, decimals: "auto" }) : "—"}</span>,
            })}
            <span className="font-normal text-muted-foreground">
              {desk.best && desk.best.net != null && desk.best.net > 0 ? ` · ${t("verdict.best", { name: personName(desk.best.trader), net: fmtUsd(desk.best.net, { signed: true, decimals: "auto" }) })}` : ""}
              {" · "}
              {desk.attention.length ? t("verdict.attention", { names: desk.attention.map((n) => personName(n)).join(", ") }) : t("verdict.allClear")}
            </span>
          </p>
        )}
      </PageHeader>

      {/* The period and «Фильтры» in one row right under the header (design audit wave 3, the group's order). */}
      <Toolbar>
        <PeriodPicker<AnalyticsPreset>
          compact ariaLabel={t("periodAria")} presets={ANALYTICS_PRESETS} value={sc.period} custom={sc.custom} today={sc.today}
          onPreset={sc.setPreset} onCustom={sc.setCustom}
        />
        <FiltersButton count={(minTrades !== MIN_TRADES_DEFAULT ? 1 : 0) + rangeFacetCount(rf)} onReset={resetAll} width="xl">
          <FilterSection title={t("minTrades")}>
            <Input
              type="number" min={1} max={500} value={minText} className="h-9 w-24 tabular-nums"
              onChange={(e) => setMinText(e.target.value)}
              onBlur={() => {
                const n = Math.floor(Number(minText));
                const v = minText.trim() !== "" && Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : minTrades;
                setMin(v);
              }}
              aria-label={t("minTradesAria")}
            />
            <p className="text-xs text-muted-foreground">{t("minTradesAria")}</p>
          </FilterSection>
          <RangeFacetSections rf={rf} />
        </FiltersButton>
        {summary.isFetching && data && <span className="text-xs text-muted-foreground" role="status">{t("updating")}</span>}
        <span className="ml-auto flex items-center gap-2">
          {data?.viewer.scope === "assigned" && <Pill tone="accent">{t("assigned")}</Pill>}
          {staff && data && data.rows.length > 0 && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => exportCsv(data)} title={t("csvTitle")}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />CSV
            </Button>
          )}
        </span>
      </Toolbar>

      <ActiveFilters
        items={[
          minTrades !== MIN_TRADES_DEFAULT && { key: "minTrades", label: t("minTradesChip", { count: minTrades }), onRemove: () => setMin(MIN_TRADES_DEFAULT) },
          ...rangeFacetChips(rf),
        ]}
        onReset={resetAll}
      />

      {summary.isLoading ? (
        <PageSkeleton />
      ) : summary.error && !data ? (
        <QueryError error={summary.error as Error} onRetry={() => summary.refetch()} />
      ) : !data ? null : data.mode === "self" ? (
        <SelfView data={data} />
      ) : data.rows.length === 0 && data.trend.length === 0 ? (
        <Panel>
          <EmptyState icon={Scale} title={t("empty")} description={t("emptyHint")} />
        </Panel>
      ) : (
        <>
          <StatGrid>
            <StatCard label={t("stat.traders")} value={`${desk.traders} / ${desk.trades}`} hint={t("stat.tradersHint", { count: data.deskSize, min: data.minTrades })} />
            <StatCard label={t("stat.net")} value={desk.net != null ? fmtUsd(desk.net, { signed: true, decimals: "auto" }) : "—"} tone={toneOf(desk.net)} hint={t("stat.netHint")} />
            <StatCard label={t("stat.fees")} value={fmtRate(desk.feeShare)} tone={(desk.feeShare ?? 0) > 0.3 ? "down" : "neutral"} hint={desk.feeShare == null ? t("stat.feesNone") : t("stat.feesHint")} />
            <StatCard label={t("stat.attention")} value={String(desk.breaches + desk.weaker)}
              tone={desk.breaches + desk.weaker > 0 ? "warn" : "neutral"}
              hint={t("stat.attentionHint", { breaches: desk.breaches, weaker: desk.weaker })} />
          </StatGrid>

          <SectionTabs<Tab> ariaLabel={t("tabsAria")} tabs={tabs} value={tab} onChange={(v) => set({ tab: v })} />

          {tab === "table" && (
            <Panel padded={false} bodyClassName="p-2">
              {data.rows.length === 0
                ? <EmptyState icon={Table2} title={t("noTradesPeriod")} />
                : <BenchmarkTable rows={data.rows} selected={selected} onToggleSelect={toggleSelect} me={data.viewer.name} />}
            </Panel>
          )}
          {tab === "heatmap" && (
            <Panel title={t("heatmapTitle")} description={t("heatmapHint")}>
              <BenchmarkHeatmap rows={data.rows} metrics={data.metrics} median={data.median} />
            </Panel>
          )}
          {tab === "same" && (
            <SameTickerView data={same.data} loading={same.isLoading} error={(same.error as Error | null) ?? null} onRetry={() => void same.refetch()} />
          )}
          {tab === "compare" && (
            <CompareView rows={data.rows} metrics={data.metrics} a={a} b={b}
              onChange={(na, nb) => { setSelected([]); set({ a: na, b: nb }); }} />
          )}
          {tab === "trend" && (
            <Panel title={t("trendTitle")}>

              <TrendView trend={data.trend} />
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}
