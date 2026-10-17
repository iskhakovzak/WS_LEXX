import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { BarChart3, FileDown, Microscope, Printer, RefreshCw, SearchX } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, Page, PageHeader, Panel, Segmented, Toolbar } from "@/components/ds";
import { KpiGrid, KpiGridSkeleton } from "@/components/stats/kpi-grid";
import { EquityPanel } from "@/components/stats/equity-panel";
import { CalendarPanel } from "@/components/stats/calendar-panel";
import { TimeHeatmap } from "@/components/stats/time-heatmap";
import { BreakdownPanel, type Dimension } from "@/components/stats/breakdown-panel";
import { ExtremesPanel, InsightsPanel, buildInsights } from "@/components/stats/insights";
import { FeesPanel, HorizonPanel } from "@/components/stats/horizon-fees";
import { downloadReportCsv, openPrintReport } from "@/components/stats/export";
import { PerformanceReportPanel } from "@/components/propreports/PerformanceReportPanel";
import { ReconcilePanel } from "@/components/propreports/ReconcilePanel";
import { usePerformance } from "@/components/propreports/api";
import { useTradesBookFacets, useTradesWindow } from "@/hooks/use-trades-window";
import {
  HORIZON_LABEL, HORIZON_OPTIONS, PERIOD_OPTIONS, computeKpis, dailySeries, equitySeries, feeStats, horizonOf, inRange,
  monthlySeries, parseKey, periodRanges, pluralTrades, preferredMetric,
  type HorizonFilter, type Metric, type PeriodKey, type Range,
} from "@/components/stats/metrics";

/**
 * /stats — the period "report card": headline KPIs vs the previous period, equity curve, P&L calendar,
 * weekday×session heatmap, where-I-make/lose table, best/worst trades and auto-insights.
 * Deep-dive breakdowns (conviction, emotions, patterns) live in /analytics.
 */

const PREFS_KEY = "ws.stats.prefs.v2";
type Prefs = { period: PeriodKey; metric: Metric | null; trader: string; dim: Dimension; horizon: HorizonFilter };
const DEFAULT_PREFS: Prefs = { period: "all", metric: null, trader: "all", dim: "trader", horizon: "all" };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      period: PERIOD_OPTIONS.some((o) => o.value === p.period) ? (p.period as PeriodKey) : DEFAULT_PREFS.period,
      metric: p.metric === "r" || p.metric === "usd" || p.metric === "net" ? p.metric : null,
      horizon: HORIZON_OPTIONS.some((o) => o.value === p.horizon) ? (p.horizon as HorizonFilter) : "all",
      trader: typeof p.trader === "string" && p.trader ? p.trader : "all",
      dim: (["trader", "setup", "sector", "ticker", "session", "conviction"] as Dimension[]).includes(p.dim as Dimension) ? (p.dim as Dimension) : "trader",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function fmtRange(r: Range): string {
  const f = (k: string) => {
    const d = parseKey(k);
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`;
  };
  if (!r.from) return "всё время";
  return `${f(r.from)} — ${r.to ? f(r.to) : "сегодня"}`;
}

export default function Stats() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = loadPrefs();
    const urlTrader = new URLSearchParams(window.location.search).get("trader");
    return urlTrader ? { ...p, trader: urlTrader } : p;
  });
  // Server-side window (P1-5): only the selected period + the equally long previous one, only the picked trader.
  // "Всё время" still needs the whole (scoped) book.
  const ranges = useMemo(() => periodRanges(prefs.period), [prefs.period]);
  const windowTrader = prefs.trader !== "all" ? prefs.trader : null;
  const { data: allTrades = [], isLoading, isError, refetch, isFetching } = useTradesWindow({
    from: ranges.prev?.from ?? ranges.cur.from,
    trader: windowTrader,
  });
  // Scope-wide facts (trader list, totals) without loading the whole book.
  const teamFacets = useTradesBookFacets();
  const traderFacets = useTradesBookFacets({ trader: windowTrader, enabled: !!windowTrader });

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable — prefs just won't persist */
    }
  }, [prefs]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  const traders = useMemo(
    () => [...new Set([...(teamFacets.data?.traders ?? []), ...allTrades.map((t) => t.trader ?? "")].map((t) => t.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ru")),
    [allTrades, teamFacets.data],
  );
  // Trades in the scope regardless of the period (for the empty states).
  const bookTotal = (windowTrader ? traderFacets.data?.total : teamFacets.data?.total) ?? null;
  const me = user?.traderName ?? null;
  const perf = usePerformance(null);
  const reportTraders = useMemo(
    () => [...new Set((perf.data?.reports ?? []).map((r) => r.traderName).filter((x): x is string => !!x))].filter((t) => !traders.includes(t)),
    [perf.data, traders],
  );
  const hasBroker = prefs.trader !== "all" && (perf.data?.reports ?? []).some((r) => r.traderName === prefs.trader);
  // A trader whose results live only in PropReports opens straight onto their broker report.
  useEffect(() => {
    if (!me || prefs.trader !== "all" || isLoading || !perf.data) return;
    const hasJournal = teamFacets.data ? teamFacets.data.traders.includes(me) : allTrades.some((t) => (t.trader ?? "").trim() === me);
    if (!hasJournal && perf.data.reports.some((r) => r.traderName === me)) setPrefs((p) => ({ ...p, trader: me }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, perf.data, isLoading]);

  // Trader scope (before horizon) — the horizon table compares all three horizons within it.
  const traderScoped = useMemo(
    () => (prefs.trader === "all" ? allTrades : allTrades.filter((t) => (t.trader ?? "").trim() === prefs.trader)),
    [allTrades, prefs.trader],
  );
  const scoped = useMemo(
    () => (prefs.horizon === "all" ? traderScoped : traderScoped.filter((t) => horizonOf(t) === prefs.horizon)),
    [traderScoped, prefs.horizon],
  );
  const metric: Metric = prefs.metric ?? preferredMetric(scoped);
  const trades = useMemo(() => inRange(scoped, ranges.cur), [scoped, ranges]);
  const prevTrades = useMemo(() => (ranges.prev ? inRange(scoped, ranges.prev) : null), [scoped, ranges]);

  const kpis = useMemo(() => computeKpis(trades, metric), [trades, metric]);
  const prevKpis = useMemo(() => (prevTrades ? computeKpis(prevTrades, metric) : null), [prevTrades, metric]);
  const equity = useMemo(() => equitySeries(trades, metric), [trades, metric]);
  const monthly = useMemo(() => monthlySeries(trades, metric), [trades, metric]);
  const days = useMemo(() => dailySeries(trades, metric), [trades, metric]);
  const insights = useMemo(() => buildInsights(trades, kpis, metric), [trades, kpis, metric]);
  const fees = useMemo(() => feeStats(trades), [trades]);
  const prevFees = useMemo(() => (prevTrades && prevTrades.length ? feeStats(prevTrades) : null), [prevTrades]);
  const horizonBase = useMemo(() => inRange(traderScoped, ranges.cur), [traderScoped, ranges]);

  const periodOpt = PERIOD_OPTIONS.find((o) => o.value === prefs.period)!;
  const scopeLabel =
    (prefs.trader === "all" ? "Вся команда" : prefs.trader) + (prefs.horizon !== "all" ? ` · ${HORIZON_LABEL[prefs.horizon]}` : "");

  const reportMeta = () => ({
    title: `Отчёт WS_LEXX — ${scopeLabel}`,
    periodLabel: `${periodOpt.label} (${fmtRange(ranges.cur)})`,
    scopeLabel,
    metric,
    generatedAt: new Date(),
    fees,
  });

  const header = (
    <PageHeader
      title="Статистика"
      icon={BarChart3}
      description={
        <>
          Сводный отчёт за период.{" "}
          <Link href="/analytics" className="text-primary underline-offset-4 hover:underline">
            Детальный разбор — в Аналитике
          </Link>
        </>
      }
      actions={
        <>
          <Button variant="outline" size="sm" className="rounded-full" asChild>
            <Link href="/analytics">
              <Microscope className="mr-1.5 h-4 w-4" aria-hidden="true" /> Глубокий анализ
            </Link>
          </Button>
          <Button
            variant="outline" size="sm" className="rounded-full" disabled={!trades.length}
            onClick={() => downloadReportCsv(trades, kpis, prevKpis, reportMeta())}
          >
            <FileDown className="mr-1.5 h-4 w-4" aria-hidden="true" /> CSV
          </Button>
          <Button
            variant="outline" size="sm" className="rounded-full" disabled={!trades.length}
            onClick={() => {
              if (!openPrintReport(trades, kpis, prevKpis, reportMeta())) {
                toast({ title: "Браузер заблокировал окно печати", description: "Разрешите всплывающие окна для этого сайта.", variant: "destructive" });
              }
            }}
          >
            <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> Печать
          </Button>
        </>
      }
    />
  );

  if (isError) {
    return (
      <Page>
        {header}
        <Panel>
          <EmptyState
            icon={SearchX}
            title="Не удалось загрузить сделки"
            description="Проверьте соединение и попробуйте ещё раз."
            action={
              <Button variant="outline" className="rounded-full" onClick={() => void refetch()} disabled={isFetching}>
                <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Повторить
              </Button>
            }
          />
        </Panel>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        {header}
        <div className="glass-panel h-[52px] rounded-2xl" aria-hidden="true" />
        <KpiGridSkeleton />
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="glass-panel h-[360px] animate-pulse rounded-2xl xl:col-span-3" />
          <div className="glass-panel h-[360px] animate-pulse rounded-2xl xl:col-span-2" />
        </div>
        <span className="sr-only" role="status">Загрузка статистики…</span>
      </Page>
    );
  }

  const prevNote = ranges.prev
    ? prevKpis && prevKpis.total > 0
      ? `Сравнение с ${fmtRange(ranges.prev)} · ${prevKpis.total} ${pluralTrades(prevKpis.total)}`
      : `В предыдущем периоде (${fmtRange(ranges.prev)}) сделок нет — сравнивать не с чем`
    : "Выберите период, чтобы сравнить с предыдущим";

  return (
    <Page>
      {header}

      <Toolbar className="justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Segmented<PeriodKey>
            ariaLabel="Период"
            value={prefs.period}
            onChange={(v) => set("period", v)}
            options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Segmented<Metric>
            ariaLabel="Метрика"
            value={metric}
            onChange={(v) => set("metric", v)}
            options={[{ value: "r", label: "R" }, { value: "net", label: "$ нетто" }, { value: "usd", label: "$ брутто" }]}
          />
          <Segmented<HorizonFilter>
            ariaLabel="Горизонт"
            value={prefs.horizon}
            onChange={(v) => set("horizon", v)}
            options={HORIZON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
        <Select value={prefs.trader} onValueChange={(v) => set("trader", v)}>
          <SelectTrigger className="h-9 w-full rounded-full sm:w-[200px]" aria-label="Трейдер">
            <SelectValue placeholder="Вся команда" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Вся команда</SelectItem>
            {me && traders.includes(me) && <SelectItem value={me}>Мои сделки ({me})</SelectItem>}
            {traders.filter((t) => t !== me).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            {reportTraders.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            {prefs.trader !== "all" && !traders.includes(prefs.trader) && !reportTraders.includes(prefs.trader) && <SelectItem value={prefs.trader}>{prefs.trader}</SelectItem>}
          </SelectContent>
        </Select>
      </Toolbar>

      {hasBroker && (
        <div className="space-y-4">
          <PerformanceReportPanel trader={prefs.trader} />
          <ReconcilePanel trader={prefs.trader} compact />
        </div>
      )}

      {prefs.trader === "all" && (bookTotal === 0 || (bookTotal == null && allTrades.length === 0 && prefs.period === "all")) ? (
        <Panel>
          <EmptyState
            icon={BarChart3}
            title="Пока нет сделок"
            description="Сделки подтягиваются автоматически после торговой сессии — тогда здесь появится отчёт: win rate, матожидание, кривая результата, календарь и лучшие сделки."
          />
        </Panel>
      ) : trades.length === 0 && hasBroker ? null : trades.length === 0 ? (
        <Panel>
          <EmptyState
            icon={SearchX}
            title={`Нет сделок за ${periodOpt.long}${prefs.trader !== "all" ? ` у ${prefs.trader}` : ""}${prefs.horizon !== "all" ? ` · ${HORIZON_LABEL[prefs.horizon]}` : ""}`}
            description={`${bookTotal != null ? `Всего в журнале${prefs.trader !== "all" ? ` у ${prefs.trader}` : ""} ${bookTotal} ${pluralTrades(bookTotal)} — в` : "В"}ыберите период длиннее${prefs.trader !== "all" || prefs.horizon !== "all" ? " или снимите фильтры" : ""}.`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {prefs.period !== "all" && (
                  <Button className="rounded-full" onClick={() => set("period", "all")}>Показать всё время</Button>
                )}
                {prefs.trader !== "all" && (
                  <Button variant="outline" className="rounded-full" onClick={() => set("trader", "all")}>Вся команда</Button>
                )}
                {prefs.horizon !== "all" && (
                  <Button variant="outline" className="rounded-full" onClick={() => set("horizon", "all")}>Все горизонты</Button>
                )}
              </div>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-foreground">
              {scopeLabel} · {fmtRange(ranges.cur)}
              <span className="ml-2 font-normal text-muted-foreground">{trades.length} {pluralTrades(trades.length)}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{prevNote}</p>
          </div>

          <KpiGrid k={kpis} prev={prevKpis} metric={metric} />

          <div className="grid gap-4 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-3"><EquityPanel equity={equity} monthly={monthly} metric={metric} trades={trades} trader={prefs.trader} /></div>
            <div className="min-w-0 xl:col-span-2"><InsightsPanel insights={insights} /></div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <HorizonPanel trades={horizonBase} metric={metric} active={prefs.horizon} onPick={(h) => set("horizon", h)} />
            <FeesPanel fees={fees} prev={prevFees} trades={trades} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CalendarPanel days={days} metric={metric} trader={prefs.trader} />
            <TimeHeatmap trades={trades} metric={metric} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownPanel
              trades={trades}
              metric={metric}
              dimension={prefs.dim}
              onDimension={(d) => set("dim", d)}
              onPickTrader={prefs.trader === "all" ? (name) => set("trader", name) : undefined}
            />
            <ExtremesPanel trades={trades} metric={metric} />
          </div>
        </>
      )}
    </Page>
  );
}
