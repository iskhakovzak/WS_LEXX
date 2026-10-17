/**
 * «Бенчмарк деска» — team comparison for curators / head of desk (GET /api/benchmark, /api/benchmark/same-ticker).
 * Staff: table (sort, sparkline, badges), heatmap of desk percentiles, «один тикер — один день», two-trader compare,
 * 4-weeks trend. Trader: own row vs the anonymised desk median + own trend.
 * URL: ?tab=table|heatmap|same|compare|trend&period=week|month|quarter|all&a=&b=
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { BarChart3, Download, Flame, GitCompare, Gauge, Table2, TrendingUp, Users } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel, Pill, SectionTabs, Segmented, StatCard, StatGrid, Toolbar, toneOf, type SectionTab, type SegmentOption } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/components/analytics-page/metrics";
import { QueryError } from "@/components/query-error";
import { useBenchmark, useSameTicker, type BenchPeriod, type BenchmarkResponse } from "@/components/benchmark/api";
import { BenchmarkTable } from "@/components/benchmark/benchmark-table";
import { BenchmarkHeatmap } from "@/components/benchmark/heatmap";
import { SameTickerView } from "@/components/benchmark/same-ticker";
import { CompareView } from "@/components/benchmark/compare";
import { TrendView } from "@/components/benchmark/trend";
import { SelfView } from "@/components/benchmark/self-view";
import { fmtDay, fmtPct, fmtUsd } from "@/components/benchmark/format";

type Tab = "table" | "heatmap" | "same" | "compare" | "trend";
const TABS: Tab[] = ["table", "heatmap", "same", "compare", "trend"];
const PERIODS: BenchPeriod[] = ["week", "month", "quarter", "all"];
const PERIOD_OPTIONS: SegmentOption<BenchPeriod>[] = [
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "quarter", label: "Квартал" },
  { value: "all", label: "Всё время" },
];

const MIN_TRADES_KEY = "ws.benchmark.minTrades.v1";
function loadMinTrades(): number {
  try {
    const n = Math.floor(Number(localStorage.getItem(MIN_TRADES_KEY)));
    return Number.isFinite(n) && n >= 1 && n <= 500 ? n : 5;
  } catch { return 5; }
}

/** The table as a report: raw values (no $ / % formatting) so it opens cleanly in a spreadsheet. */
function exportCsv(data: BenchmarkResponse) {
  const header = ["Трейдер", "Сделки", "В перцентилях", ...data.metrics.map((m) => m.label)];
  const rows = data.rows.map((r) => [
    r.trader, r.trades, r.qualified ? "да" : "нет",
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
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Загрузка бенчмарка">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      <Skeleton className="h-10 w-full rounded-xl" />
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
    </div>
  );
}

export default function BenchmarkPage() {
  const { q, set } = useUrlState();
  const tab: Tab = TABS.includes(q.get("tab") as Tab) ? (q.get("tab") as Tab) : "table";
  const period: BenchPeriod = PERIODS.includes(q.get("period") as BenchPeriod) ? (q.get("period") as BenchPeriod) : "quarter";
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

  const params = { period, minTrades };
  const summary = useBenchmark(params);
  const data = summary.data;
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
    { value: "table", label: "Таблица", icon: Table2, count: data?.rows.length },
    { value: "heatmap", label: "Тепловая карта", icon: Flame },
    { value: "same", label: "Один тикер — один день", icon: Users, count: same.data?.total },
    { value: "compare", label: "Сравнение двух", icon: GitCompare },
    { value: "trend", label: "Тренд 4 нед.", icon: TrendingUp },
  ];

  return (
    <Page>
      <PageHeader
        title="Бенчмарк деска"
        icon={Gauge}
        description={staff === false
          ? "Ваши метрики против анонимной медианы деска"
          : "Сравнение трейдеров: нетто, стабильность, исполнение и тренд — для кураторов и head of desk"}
        actions={data && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {fmtDay(data.period.from)} – {fmtDay(data.period.to)} · NY
          </span>
        )}
      />

      <Toolbar>
        <Segmented<BenchPeriod> ariaLabel="Период" value={period} onChange={(v) => set({ period: v })} options={PERIOD_OPTIONS} />
        <label className="ml-2 flex items-center gap-2 text-sm text-muted-foreground">
          Мин. сделок
          <Input
            type="number" min={1} max={500} value={minText} className="h-8 w-20 tabular-nums"
            onChange={(e) => setMinText(e.target.value)}
            onBlur={() => {
              const n = Math.floor(Number(minText));
              const v = minText.trim() !== "" && Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : minTrades;
              setMinTrades(v); setMinText(String(v));
            }}
            aria-label="Минимум сделок для перцентилей и медианы"
          />
        </label>
        {summary.isFetching && data && <span className="text-xs text-muted-foreground">обновление…</span>}
        <span className="ml-auto flex items-center gap-2">
          {data?.viewer.scope === "assigned" && <Pill tone="accent">мои подопечные</Pill>}
          {staff && data && data.rows.length > 0 && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => exportCsv(data)} title="Таблица трейдеров за период — CSV для Excel / Google Таблиц">
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />CSV
            </Button>
          )}
        </span>
      </Toolbar>

      {summary.isLoading ? (
        <PageSkeleton />
      ) : summary.error ? (
        <QueryError error={summary.error as Error} onRetry={() => summary.refetch()} />
      ) : !data ? null : data.mode === "self" ? (
        <SelfView data={data} />
      ) : data.rows.length === 0 && data.trend.length === 0 ? (
        <Panel>
          <EmptyState icon={BarChart3} title="Нет закрытых сделок за период" description="Выберите период длиннее — сделки появятся здесь автоматически после закрытия." />
        </Panel>
      ) : (
        <>
          <StatGrid>
            <StatCard label="Трейдеров / сделок" value={`${desk.traders} / ${desk.trades}`} hint={`в перцентилях: ${data.deskSize} (≥ ${data.minTrades} сд.)`} />
            <StatCard label="Нетто деска" value={desk.net != null ? fmtUsd(desk.net) : "—"} tone={toneOf(desk.net)} hint="Σ pnl − |комиссии|" />
            <StatCard label="Комиссии / брутто" value={fmtPct(desk.feeShare)} tone={(desk.feeShare ?? 0) > 0.3 ? "down" : "neutral"} hint="доля брутто, ушедшая в комиссии" />
            <StatCard label="Требуют внимания" value={String(desk.breaches + desk.weaker)}
              tone={desk.breaches + desk.weaker > 0 ? "warn" : "neutral"}
              hint={`консистентность: ${desk.breaches} · хуже за 4 нед.: ${desk.weaker}`} />
          </StatGrid>

          <SectionTabs<Tab> ariaLabel="Виды бенчмарка" tabs={tabs} value={tab} onChange={(v) => set({ tab: v })} />

          {tab === "table" && (
            <Panel padded={false} bodyClassName="p-2">
              {data.rows.length === 0
                ? <EmptyState icon={Table2} title="Нет сделок в периоде" />
                : <BenchmarkTable rows={data.rows} selected={selected} onToggleSelect={toggleSelect} me={data.viewer.name} />}
            </Panel>
          )}
          {tab === "heatmap" && (
            <Panel title="Тепловая карта" description="Цвет — перцентиль внутри деска (зелёный = лучший)">
              <BenchmarkHeatmap rows={data.rows} metrics={data.metrics} median={data.median} />
            </Panel>
          )}
          {tab === "same" && (
            <SameTickerView data={same.data} loading={same.isLoading} error={(same.error as Error | null) ?? null} />
          )}
          {tab === "compare" && (
            <CompareView rows={data.rows} metrics={data.metrics} a={a} b={b}
              onChange={(na, nb) => { setSelected([]); set({ a: na, b: nb }); }} />
          )}
          {tab === "trend" && (
            <Panel title="Последние 4 недели vs предыдущие 4">
              <TrendView trend={data.trend} />
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}
