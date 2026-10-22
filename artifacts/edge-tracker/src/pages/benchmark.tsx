/**
 * «Бенчмарк деска» — team comparison for curators / head of desk (GET /api/benchmark, /api/benchmark/same-ticker).
 * Staff: table (sort, sparkline, badges), heatmap of desk percentiles, «один тикер — один день», two-trader compare,
 * 4-weeks trend. Trader: own row vs the anonymised desk median + own trend.
 * URL: ?tab=table|heatmap|same|compare|trend&period=week|month|quarter|all&a=&b=
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { BarChart3, Download, Flame, GitCompare, Gauge, Table2, TrendingUp, Users } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel, Pill, SectionTabs, StatCard, StatGrid, Toolbar, toneOf, type SectionTab, type SegmentOption } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/components/analytics-page/metrics";
import { QueryError } from "@/components/query-error";
import { useBenchmark, useSameTicker, type BenchPeriod, type BenchPeriodKey, type BenchmarkResponse } from "@/components/benchmark/api";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { RangeFacetsPanel, useRangeFacets } from "@/components/shared/trade-facets/range-facets";
import { parseDayRange } from "@/lib/period-range";
import { nyDate } from "@/lib/trading-date";
import { BenchmarkTable } from "@/components/benchmark/benchmark-table";
import { BenchmarkHeatmap } from "@/components/benchmark/heatmap";
import { SameTickerView } from "@/components/benchmark/same-ticker";
import { CompareView } from "@/components/benchmark/compare";
import { TrendView } from "@/components/benchmark/trend";
import { SelfView } from "@/components/benchmark/self-view";
import { fmtDateRange, fmtRate, fmtUsd } from "@/lib/format";
import { benchmarkI18n } from "@/i18n/ns/benchmark";
import { personName } from "@/i18n";
import { metricLabel } from "@/components/benchmark/format";

type Tab = "table" | "heatmap" | "same" | "compare" | "trend";
const TABS: Tab[] = ["table", "heatmap", "same", "compare", "trend"];
const PERIODS: BenchPeriod[] = ["week", "month", "quarter", "all"];
const periodOptions = (): SegmentOption<BenchPeriod>[] => PERIODS.map((value) => ({ value, label: benchmarkI18n.t(`period.${value}`) }));

const MIN_TRADES_KEY = "ws.benchmark.minTrades.v1";
function loadMinTrades(): number {
  try {
    const n = Math.floor(Number(localStorage.getItem(MIN_TRADES_KEY)));
    return Number.isFinite(n) && n >= 1 && n <= 500 ? n : 5;
  } catch { return 5; }
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
  // ?period=custom&from=&to= — «Свой период»; an invalid range falls back to the quarter.
  const custom = parseDayRange(q.get("from"), q.get("to"));
  const periodKey: BenchPeriodKey = q.get("period") === "custom" && custom ? "custom" : PERIODS.includes(q.get("period") as BenchPeriod) ? (q.get("period") as BenchPeriod) : "quarter";
  const period: BenchPeriod = periodKey === "custom" ? "quarter" : periodKey;
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
  // «Разрезы» over the benchmark window (the server's answer; the custom range before it arrives), applied to everyone.
  const rf = useRangeFacets(periodKey === "custom" && custom ? custom : { from: win?.from, to: win?.to });
  const params = { period, minTrades, ...(periodKey === "custom" && custom ? custom : {}), facets: rf.query || undefined };
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
        icon={Gauge}
        description={staff === false ? t("descSelf") : t("descDesk")}
        actions={data && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {fmtDateRange(data.period.from, data.period.to, "short")} · NY
          </span>
        )}
      />

      <Toolbar>
        <PeriodPicker<BenchPeriod>
          ariaLabel={t("periodAria")} value={periodKey} custom={custom} presetRange={win} today={nyDate()} options={periodOptions()}
          onPreset={(v) => set({ period: v, from: null, to: null })} onCustom={(r) => set({ period: "custom", from: r.from, to: r.to })}
        />
        <label className="ml-2 flex items-center gap-2 text-sm text-muted-foreground">
          {t("minTrades")}
          <Input
            type="number" min={1} max={500} value={minText} className="h-8 w-20 tabular-nums"
            onChange={(e) => setMinText(e.target.value)}
            onBlur={() => {
              const n = Math.floor(Number(minText));
              const v = minText.trim() !== "" && Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : minTrades;
              setMinTrades(v); setMinText(String(v));
            }}
            aria-label={t("minTradesAria")}
          />
        </label>
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

      <RangeFacetsPanel rf={rf} />

      {summary.isLoading ? (
        <PageSkeleton />
      ) : summary.error && !data ? (
        <QueryError error={summary.error as Error} onRetry={() => summary.refetch()} />
      ) : !data ? null : data.mode === "self" ? (
        <SelfView data={data} />
      ) : data.rows.length === 0 && data.trend.length === 0 ? (
        <Panel>
          <EmptyState icon={BarChart3} title={t("empty")} description={t("emptyHint")} />
        </Panel>
      ) : (
        <>
          <StatGrid>
            <StatCard label={t("stat.traders")} value={`${desk.traders} / ${desk.trades}`} hint={t("stat.tradersHint", { count: data.deskSize, min: data.minTrades })} />
            <StatCard label={t("stat.net")} value={desk.net != null ? fmtUsd(desk.net, { signed: true, decimals: "auto" }) : "—"} tone={toneOf(desk.net)} hint={t("stat.netHint")} />
            <StatCard label={t("stat.fees")} value={fmtRate(desk.feeShare)} tone={(desk.feeShare ?? 0) > 0.3 ? "down" : "neutral"} hint={t("stat.feesHint")} />
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
