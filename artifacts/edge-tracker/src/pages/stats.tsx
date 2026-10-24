import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { BarChart3, FileDown, Microscope, Printer, RefreshCw, SearchX } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ChartSkeleton, EmptyState, Page, PageHeader, Panel, Segmented, Toolbar, emptyActions } from "@/components/ds";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { parseDayRange, type DayRange } from "@/lib/period-range";
import { KpiGridSkeleton } from "@/components/stats/kpi-grid";
import { type Dimension } from "@/components/stats/breakdown-panel";
import { ReportPanels, useReportData, useWindowExport } from "@/components/stats/report";
import { EquityPanel } from "@/components/stats/equity-panel";
import { downloadReportCsv, openPrintReport } from "@/components/stats/export";
import { PerformanceReportPanel } from "@/components/propreports/PerformanceReportPanel";
import { ReconcilePanel } from "@/components/propreports/ReconcilePanel";
import { usePerformance } from "@/components/propreports/api";
import { usePeriodTrades, useTradesBookFacets } from "@/hooks/use-trades-window";
import { preferredMetricOfAggregate, useStaffAggregates } from "@/components/stats/staff-data";
import { StatsFacets, facetFilteredTrades, useStatsFacets } from "@/components/stats/StatsFacets";
import { useFacetView } from "@/components/shared/trade-facets/api";
import { facetQuery } from "@/lib/trade-facets";
import { links } from "@/lib/links";
import {
  horizonLabel, HORIZON_OPTIONS, PERIOD_OPTIONS, horizonOf, inRange,
  fmtDayKey, periodTexts, preferredMetric, spansYears, statsRanges, toKey,
  type HorizonFilter, type Metric, type PeriodKey, type Range, type StatsPeriod,
} from "@/components/stats/metrics";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { TEAM, scopePickerValue } from "@/components/people/staff-scope";
import { statsScope } from "@/components/stats/staff-data";
import { comparePersonNames, personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { statsI18n } from "@/i18n/ns/stats";
import { InsightBento } from "@/components/insight-tiles/bento";

/**
 * /stats — the period "report card": headline KPIs vs the previous period, equity curve, P&L calendar,
 * weekday×session heatmap, where-I-make/lose table, best/worst trades and auto-insights.
 * Deep-dive breakdowns (conviction, emotions, patterns) live in /analytics.
 * Staff = traders + extras (owner rule 2026-10-21): staff open on their own book and any single person is the trader
 * path (raw trades, the equity chart with day hover and «Разбор дня»); only «Вся команда» reads server aggregates
 * (GET /api/stats/aggregate, Волна 2 п. 2.5) — the same cards from sums, no raw trades on open.
 */

const PREFS_KEY = "ws.stats.prefs.v2";
/** The insight tiles of the period (no «Сегодня»: a period page has no live day). */
const STATS_TILES = ["streaks", "leaks", "seqDay", "afterLoss", "holdTime", "weekdays", "fees"] as const;
/** `from` / `to`: the «Свой период» range (kept while a preset is picked, so «Период…» reopens on it). */
type Prefs = { period: StatsPeriod; from?: string; to?: string; metric: Metric | null; trader: string; dim: Dimension; horizon: HorizonFilter };
/**
 * DEV-01: the page opens on 90 days; «Всё время» (the whole book, tens of MB for staff) is on demand only.
 * `trader`: a picked person, or "all" = the default (the own book; «Вся команда» is a per-visit pick, never stored).
 */
const DEFAULT_PREFS: Prefs = { period: "90d", metric: null, trader: "all", dim: "trader", horizon: "all" };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    const custom = parseDayRange(p.from, p.to);
    return {
      // «Всё время» is never restored: every visit starts on the cheap default window. A custom range is (when valid).
      period: p.period === "custom" ? (custom ? "custom" : DEFAULT_PREFS.period)
        : p.period !== "all" && PERIOD_OPTIONS.some((o) => o.value === p.period) ? (p.period as PeriodKey) : DEFAULT_PREFS.period,
      ...(custom ?? {}),
      metric: p.metric === "r" || p.metric === "usd" || p.metric === "net" ? p.metric : null,
      horizon: HORIZON_OPTIONS.some((o) => o.value === p.horizon) ? (p.horizon as HorizonFilter) : "all",
      trader: typeof p.trader === "string" && p.trader ? p.trader : "all",
      dim: (["trader", "setup", "sector", "ticker", "session", "conviction"] as Dimension[]).includes(p.dim as Dimension) ? (p.dim as Dimension) : "trader",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** «22 июл — сегодня»; both ends carry the year when the range crosses a year (MAKSIM-34). */
function fmtRange(r: Range): string {
  if (!r.from) return statsI18n.t("range.all");
  const y = spansYears(r.from, r.to ?? toKey(new Date()));
  return statsI18n.t("range.span", { from: fmtDayKey(r.from, y), to: r.to ? fmtDayKey(r.to, y) : statsI18n.t("range.today") });
}

/** The window every card is computed over: the period, or the real span of the book for «Всё время». */
function windowLabelOf(cur: Range, days: { key: string }[]): string {
  if (cur.from || !days.length) return fmtRange(cur);
  const first = days[0].key, last = days[days.length - 1].key;
  const y = spansYears(first, last);
  return statsI18n.t("range.span", { from: fmtDayKey(first, y), to: fmtDayKey(last, y) });
}

/** «Сравнение с …» line: loading / compared / empty previous period / no period. */
function prevNoteOf(prev: Range | null, loading: boolean, prevKpis: { total: number } | null): string {
  const t = statsI18n.t;
  if (!prev) return t("prevNone");
  if (loading) return t("prevLoading", { range: fmtRange(prev) });
  return prevKpis && prevKpis.total > 0
    ? t("prevCompare", { range: fmtRange(prev), trades: commonI18n.t("units.trades", { count: prevKpis.total }) })
    : t("prevEmpty", { range: fmtRange(prev) });
}

export default function Stats() {
  const { t } = statsI18n.useT();
  const { user, isCurator } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = loadPrefs();
    const sp = new URLSearchParams(window.location.search);
    const urlTrader = sp.get("trader");
    // ?period=<preset> (the dashboard insight cards open /stats on their own window).
    const urlPeriod = PERIOD_OPTIONS.find((o) => o.value === sp.get("period"))?.value;
    return { ...p, ...(urlTrader ? { trader: urlTrader } : {}), ...(urlPeriod ? { period: urlPeriod } : {}) };
  });
  // «Вся команда»: an explicit pick (or a ?trader=all link) for this visit only.
  const [team, setTeam] = useState(() => new URLSearchParams(window.location.search).get("trader") === "all");
  // Server-side window (DEV-01): the selected period first, the equally long previous one after it (deltas only),
  // only the picked trader. "Всё время" (on demand) still needs the whole (scoped) book.
  const custom = useMemo<DayRange | null>(() => parseDayRange(prefs.from, prefs.to), [prefs.from, prefs.to]);
  const ranges = useMemo(() => statsRanges(prefs.period, custom), [prefs.period, custom]);
  // Own trades only (owner rule 2026-10-21): a member never gets the trader picker or «the whole team», and a saved
  // prefs.trader / ?trader= is ignored for them (like /analytics) — their scope is the own book, or their own name
  // for the PropReports-only switch below.
  const solo = !isCurator;
  const me = user?.traderName ?? null;
  const scope = statsScope({ staff: isCurator, me, picked: prefs.trader, team });
  const trader = solo ? (me && prefs.trader === me ? me : "all") : scope.trader ?? "all";
  const windowTrader = trader !== "all" ? trader : null;
  /** The desk aggregate path: staff on «Вся команда» only. Everyone else (staff on one person too) reads raw trades. */
  const staff = scope.team;
  const pickTrader = (v: string) => { setTeam(v === TEAM); set("trader", v === TEAM ? "all" : v); };
  const raw = usePeriodTrades(
    { from: ranges.cur.from, to: ranges.cur.to, prevFrom: ranges.prev?.from ?? null, prevTo: ranges.prev?.to ?? null, trader: windowTrader },
    !staff,
  );
  const FV = useFacetView(); // «Фильтры» + «Исключить IMX»: x* params for staff aggregates, a filter over the own book
  const FQ = useStatsFacets(ranges.cur, windowTrader, FV);
  const agg = useStaffAggregates(
    { cur: ranges.cur, prev: ranges.prev, trader: windowTrader, horizon: prefs.horizon !== "all" ? prefs.horizon : null, facets: facetQuery(FV.view) },
    staff,
  );
  const { isLoading, isError, refetch, isFetching, prevLoading } = staff ? agg : raw;
  const allTrades = useMemo(() => facetFilteredTrades(raw.data, FV.view, FQ.data?.deskTags), [raw.data, FV.view, FQ.data?.deskTags]);
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
    () => [...new Set([
      ...(teamFacets.data?.traders ?? []), ...allTrades.map((tr) => tr.trader ?? ""), ...(agg.cur?.groups?.trader ?? []).map((g) => g.key),
    ].map((x) => x.trim()).filter((x) => x && x !== "—"))].sort(comparePersonNames),
    [allTrades, teamFacets.data, agg.cur],
  );
  // Trades in the scope regardless of the period (for the empty states).
  const bookTotal = (windowTrader ? traderFacets.data?.total : teamFacets.data?.total) ?? null;
  const perf = usePerformance(null);
  const reportTraders = useMemo(
    () => [...new Set((perf.data?.reports ?? []).map((r) => r.traderName).filter((x): x is string => !!x))].filter((t) => !traders.includes(t)),
    [perf.data, traders],
  );
  const hasBroker = trader !== "all" && (perf.data?.reports ?? []).some((r) => r.traderName === trader);
  // A trader whose results live only in PropReports opens straight onto their broker report.
  useEffect(() => {
    if (!solo || !me || trader !== "all" || isLoading || !perf.data) return;
    const hasJournal = teamFacets.data ? teamFacets.data.traders.includes(me) : allTrades.some((tr) => (tr.trader ?? "").trim() === me);
    if (!hasJournal && perf.data.reports.some((r) => r.traderName === me)) setPrefs((p) => ({ ...p, trader: me }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, perf.data, isLoading]);

  // Trader scope (before horizon) — the horizon table compares all three horizons within it.
  const traderScoped = useMemo(
    () => (trader === "all" ? allTrades : allTrades.filter((tr) => (tr.trader ?? "").trim() === trader)),
    [allTrades, trader],
  );
  const scoped = useMemo(
    () => (prefs.horizon === "all" ? traderScoped : traderScoped.filter((tr) => horizonOf(tr) === prefs.horizon)),
    [traderScoped, prefs.horizon],
  );
  const a = agg.cur;
  const metric: Metric = prefs.metric ?? (staff ? preferredMetricOfAggregate(a) : preferredMetric(scoped));
  const trades = useMemo(() => inRange(scoped, ranges.cur), [scoped, ranges]);
  const prevTrades = useMemo(() => (ranges.prev && !prevLoading ? inRange(scoped, ranges.prev) : null), [scoped, ranges, prevLoading]);

  const d = useReportData({ staff, cur: a, prev: agg.prev, trades, prevTrades, metric });
  const { kpis, prevKpis, days, fees, count } = d;
  const horizonBase = useMemo(() => inRange(traderScoped, ranges.cur), [traderScoped, ranges]);
  const { exporting, withTrades } = useWindowExport({
    staff, trades, range: ranges.cur, trader: windowTrader, horizon: prefs.horizon, facets: FV.view, deskTags: FQ.data?.deskTags,
  });

  const periodOpt = periodTexts(prefs.period, custom);
  // A trader's book holds only own trades: no team picker, and the scope reads «Мои сделки».
  // One person's report: trade rows don't repeat the name (MAKSIM-37).
  const oneTrader = solo || trader !== "all";
  const scopeLabel =
    (trader === "all" ? (solo ? t("myTrades") : t("wholeTeam")) : trader === me ? t("myTrades") : personName(trader)) + (prefs.horizon !== "all" ? ` · ${horizonLabel(prefs.horizon)}` : "");

  const reportMeta = () => ({
    title: t("reportTitle", { scope: scopeLabel }),
    periodLabel: t("reportPeriod", { label: periodOpt.label, range: fmtRange(ranges.cur) }),
    scopeLabel,
    metric,
    generatedAt: new Date(),
    fees,
  });

  const header = (
    <PageHeader
      title={t("title")}
      icon={BarChart3}
      description={
        <>
          {t("description")}{" "}
          <Link href="/analytics" className="text-primary underline-offset-4 hover:underline">
            {t("deepLink")}
          </Link>
        </>
      }
      actions={
        <>
          <Button variant="outline" size="sm" className="rounded-full" asChild>
            <Link href="/analytics">
              <Microscope className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("deepButton")}
            </Link>
          </Button>
          <Button
            variant="outline" size="sm" className="hidden rounded-full md:inline-flex" disabled={!count || exporting}
            onClick={() => void withTrades((rows) => downloadReportCsv(rows, kpis, prevKpis, reportMeta()))}
          >
            <FileDown className="mr-1.5 h-4 w-4" aria-hidden="true" /> CSV
          </Button>
          <Button
            variant="outline" size="sm" className="hidden rounded-full md:inline-flex" disabled={!count || exporting}
            onClick={() => void withTrades((rows) => {
              if (!openPrintReport(rows, kpis, prevKpis, reportMeta())) {
                toast({ title: t("printBlocked"), description: t("printBlockedHint"), variant: "destructive" });
              }
            })}
          >
            <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("print")}
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
            title={t("loadError")}
            description={t("loadErrorHint")}
            action={
              <Button className="rounded-full" onClick={() => void refetch()} disabled={isFetching}>
                <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> {commonI18n.t("actions.retry")}
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
        <div className="skeleton h-[52px] rounded-2xl" aria-hidden="true" />
        <ChartSkeleton className="h-[460px]" height="100%" />
        <KpiGridSkeleton />
        <span className="sr-only" role="status">{t("loading")}</span>
      </Page>
    );
  }

  const windowLabel = windowLabelOf(ranges.cur, days);
  const bookEmpty = trader === "all" && (bookTotal === 0 || (bookTotal == null && !staff && allTrades.length === 0 && prefs.period === "all"));
  const prevNote = prevNoteOf(ranges.prev, prevLoading, prevKpis);

  return (
    <Page>
      {header}

      <Toolbar className="justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <PeriodPicker<PeriodKey>
            ariaLabel={t("periodAria")} value={prefs.period} custom={custom} presetRange={ranges.cur} today={toKey(new Date())} comparePrev
            onPreset={(v) => set("period", v)} onCustom={(r) => setPrefs((p) => ({ ...p, period: "custom", ...r }))}
            options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Segmented<Metric>
            ariaLabel={t("metricAria")}
            value={metric}
            onChange={(v) => set("metric", v)}
            options={[{ value: "r", label: t("metric.r") }, { value: "net", label: t("metric.net") }, { value: "usd", label: t("metric.usd") }]}
          />
          <Segmented<HorizonFilter>
            ariaLabel={t("horizonAria")}
            value={prefs.horizon}
            onChange={(v) => set("horizon", v)}
            options={HORIZON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
        {!solo && (
          <StaffTraderPicker
            value={scopePickerValue(scope)} onChange={pickTrader} me={me} names={[...traders, ...reportTraders]} teamLabel={t("wholeTeam")}
            className="h-9 w-full sm:w-auto sm:min-w-[13rem] sm:max-w-[18rem]" ariaLabel={t("traderAria")}
          />
        )}
      </Toolbar>

      <StatsFacets fv={FV} data={FQ.data} loading={FQ.isFetching} error={FQ.isError} />

      {/* The result curve right under the cuts, full width (owner: the first thing after the filters). */}
      {!bookEmpty && count > 0 && (
        <EquityPanel equity={d.equity} monthly={d.monthly} metric={metric} trades={staff ? undefined : trades} trader={trader} daily={staff} />
      )}

      {hasBroker && (
        <div className="space-y-4">
          <PerformanceReportPanel trader={trader} />
          <ReconcilePanel trader={trader} compact />
        </div>
      )}

      {bookEmpty ? (
        <Panel>
          <EmptyState
            icon={BarChart3}
            title={t("bookEmpty")}
            description={t("bookEmptyHint")}
            action={<Button asChild><Link href={links.myPlan()}>{commonI18n.t("emptyActions.toPlan")}</Link></Button>}
          />
        </Panel>
      ) : count === 0 && hasBroker ? null : count === 0 ? (
        <Panel>
          <EmptyState
            icon={SearchX}
            title={`${trader !== "all" ? t("noTradesTitleOf", { period: periodOpt.long, trader: personName(trader) }) : t("noTradesTitle", { period: periodOpt.long })}${prefs.horizon !== "all" ? ` · ${horizonLabel(prefs.horizon)}` : ""}`}
            description={[
              bookTotal != null
                ? trader !== "all"
                  ? t("inJournalOf", { trader: personName(trader), trades: commonI18n.t("units.trades", { count: bookTotal }) })
                  : t("inJournal", { trades: commonI18n.t("units.trades", { count: bookTotal }) })
                : "",
              trader !== "all" || prefs.horizon !== "all" ? t("pickLongerOrClear") : t("pickLonger"),
            ].filter(Boolean).join(" ")}
            {...emptyActions([
              prefs.period !== "all" && { label: t("showAll"), run: () => set("period", "all") },
              !solo && trader !== "all" && { label: t("wholeTeam"), run: () => pickTrader(TEAM) },
              prefs.horizon !== "all" && { label: t("allHorizons"), run: () => set("horizon", "all") },
            ])}
          />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-foreground">
              {scopeLabel} · {fmtRange(ranges.cur)}
              <span className="ml-2 font-normal text-muted-foreground">{commonI18n.t("units.trades", { count })}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{prevNote}</p>
          </div>

          <ReportPanels
            d={d} staff={staff} agg={a} trades={trades} horizonBase={horizonBase} metric={metric} windowLabel={windowLabel}
            trader={trader} horizon={prefs.horizon} dim={prefs.dim} oneTrader={oneTrader} solo={oneTrader}
            onHorizon={(h) => set("horizon", h)} onDim={(x) => set("dim", x)}
            onPickTrader={!solo && trader === "all" ? pickTrader : undefined}
            insights={staff ? undefined : (
              <InsightBento
                ids={STATS_TILES}
                trades={trades}
                prev={prevTrades}
                scope={{ target: "trades", from: ranges.cur.from, to: ranges.cur.to, trader: windowTrader, periodLong: periodOpt.long }}
              />
            )}
          />
        </>
      )}
    </Page>
  );
}
