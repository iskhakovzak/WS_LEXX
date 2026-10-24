/**
 * /stats report body: the numbers (useReportData — from the viewer's own trades, or from the server aggregate in the
 * staff view, Волна 2 п. 2.5) and the panels under the KPI cards (ReportPanels). Split out of pages/stats.tsx.
 */
import { useMemo, useState, type ReactNode } from "react";
import type { Trade } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { statsI18n } from "@/i18n/ns/stats";
import { KpiGrid } from "./kpi-grid";
import { EquityPanel } from "./equity-panel";
import { CalendarPanel } from "./calendar-panel";
import { TimeHeatmap } from "./time-heatmap";
import { BreakdownPanel, type Dimension } from "./breakdown-panel";
import { ExtremesPanel, InsightsPanel, buildInsights, insightsFrom } from "./insights";
import { FeesPanel, HorizonPanel } from "./horizon-fees";
import {
  dailyEquity, daysOf, extremesOf, feesOf as aggFees, groupStat, groupsOf, heatOf, kpisFromAggregate, monthlyOf, type StatsAggregate,
} from "./aggregate";
import { fetchWindowTrades } from "./staff-data";
import { facetFilteredTrades } from "./StatsFacets";
import { facetQuery, type FacetView } from "@/lib/trade-facets";
import {
  computeKpis, dailySeries, equitySeries, feeStats, horizonOf, inRange, monthlySeries, weekdayLabel,
  type HorizonFilter, type Metric, type Range,
} from "./metrics";

/** Every number of the report: staff from the server sums (aggregate.test.ts proves the same values), else from trades. */
export function useReportData(o: {
  staff: boolean; cur: StatsAggregate | undefined; prev: StatsAggregate | null; trades: Trade[]; prevTrades: Trade[] | null; metric: Metric;
}) {
  const { staff, cur: a, prev, trades, prevTrades, metric } = o;
  const agg = staff ? a : undefined;
  const kpis = useMemo(() => (agg ? kpisFromAggregate(agg, metric) : computeKpis(trades, metric)), [agg, trades, metric]);
  const prevKpis = useMemo(
    () => (staff ? (prev ? kpisFromAggregate(prev, metric) : null) : prevTrades ? computeKpis(prevTrades, metric) : null),
    [staff, prev, prevTrades, metric],
  );
  const days = useMemo(() => (agg ? daysOf(agg, metric) : dailySeries(trades, metric)), [agg, trades, metric]);
  const equity = useMemo(() => (staff ? dailyEquity(days) : equitySeries(trades, metric)), [staff, days, trades, metric]);
  const monthly = useMemo(() => (agg ? monthlyOf(agg, metric) : monthlySeries(trades, metric)), [agg, trades, metric]);
  const insights = useMemo(() => (agg
    ? insightsFrom(kpis, metric, groupsOf(agg, "weekday", metric).map((g) => ({ ...g, key: weekdayLabel(Number(g.key)) })), groupsOf(agg, "setup", metric))
    : buildInsights(trades, kpis, metric)), [agg, trades, kpis, metric]);
  const staffFees = useMemo(() => (agg ? aggFees(agg) : null), [agg]);
  const fees = useMemo(() => (staffFees ? staffFees.fees : feeStats(trades)), [staffFees, trades]);
  const prevFees = useMemo(
    () => (staff ? (prev && prev.total[0] ? aggFees(prev).fees : null) : prevTrades && prevTrades.length ? feeStats(prevTrades) : null),
    [staff, prev, prevTrades],
  );
  /** Trades of the period (staff: the server total). */
  const count = staff ? kpis.total : trades.length;
  return { kpis, prevKpis, days, equity, monthly, insights, fees, prevFees, staffFees, count };
}
export type ReportData = ReturnType<typeof useReportData>;

/**
 * CSV / print: staff fetch the raw trades of the window only now (never on open), with the same «Фильтры» selection
 * (incl. «Исключить IMX») as the cards. A trader's `trades` are already filtered by the page.
 */
export function useWindowExport(o: {
  staff: boolean; trades: Trade[]; range: Range; trader: string | null; horizon: HorizonFilter; facets: FacetView; deskTags: readonly string[] | undefined;
}) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const withTrades = async (run: (rows: Trade[]) => void) => {
    if (!o.staff) return run(o.trades);
    setExporting(true);
    try {
      const fetched = await fetchWindowTrades({ from: o.range.from, to: o.range.to, trader: o.trader, facets: facetQuery(o.facets) });
      const rows = facetFilteredTrades(fetched, o.facets, o.deskTags);
      run(inRange(o.horizon === "all" ? rows : rows.filter((tr) => horizonOf(tr) === o.horizon), o.range));
    } catch {
      toast({ title: statsI18n.t("loadError"), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };
  return { exporting, withTrades };
}

/** KPI cards and every panel of the report. */
export function ReportPanels({ d, staff, agg, trades, horizonBase, metric, windowLabel, trader, horizon, dim, oneTrader, solo, onHorizon, onDim, onPickTrader, insights }: {
  d: ReportData; staff: boolean; agg: StatsAggregate | undefined; trades: Trade[]; horizonBase: Trade[]; metric: Metric; windowLabel: string;
  trader: string; horizon: HorizonFilter; dim: Dimension; oneTrader: boolean; solo: boolean;
  onHorizon: (h: HorizonFilter) => void; onDim: (d: Dimension) => void; onPickTrader?: (name: string) => void;
  /** Compact insight cards (streaks, trade number in the day…) under the equity row; raw-trade views only. */
  insights?: ReactNode;
}) {
  const a = staff ? agg : undefined;
  return (
    <>
      <KpiGrid k={d.kpis} prev={d.prevKpis} metric={metric} windowLabel={windowLabel} />

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <EquityPanel equity={d.equity} monthly={d.monthly} metric={metric} trades={staff ? undefined : trades} trader={trader} daily={staff} />
        </div>
        <div className="min-w-0 xl:col-span-2"><InsightsPanel insights={d.insights} /></div>
      </div>

      {insights}

      <div className="grid gap-4 lg:grid-cols-2">
        <HorizonPanel
          trades={staff ? undefined : horizonBase}
          groupsFor={a ? (m) => (a.horizonAll ?? []).map((g) => groupStat(g.key, g.b, m)) : undefined}
          metric={metric} active={horizon} onPick={onHorizon}
        />
        <FeesPanel fees={d.fees} prev={d.prevFees} trades={staff ? undefined : trades} counts={d.staffFees ?? undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CalendarPanel days={d.days} metric={metric} trader={trader} hideTrader={oneTrader} />
        <TimeHeatmap trades={staff ? undefined : trades} cells={a ? heatOf(a, metric) : undefined} metric={metric} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownPanel
          trades={staff ? undefined : trades}
          groupsFor={a ? (x, m) => groupsOf(a, x, m) : undefined}
          metric={metric}
          dimension={dim}
          onDimension={onDim}
          onPickTrader={onPickTrader}
          hideTrader={solo}
        />
        <ExtremesPanel trades={staff ? undefined : trades} lists={a ? extremesOf(a, metric) : undefined} metric={metric} hideTrader={oneTrader} />
      </div>
    </>
  );
}
