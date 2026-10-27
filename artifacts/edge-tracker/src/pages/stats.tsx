import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { BarChart3, FileDown, Printer, RefreshCw, SearchX } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ChartSkeleton, EmptyState, Page, PageHeader, Panel, emptyActions } from "@/components/ds";
import { StatsVerdict } from "@/components/stats/verdict";
import { useAssistantContext } from "@/components/shared/ask-assistant";
import { StatsScopeToolbar } from "@/components/stats/scope-toolbar";
import { useAnalyticsScope, type AnalyticsUnit, type ScopeSource } from "@/hooks/use-analytics-scope";
import { KpiGridSkeleton } from "@/components/stats/kpi-grid";
import { type Dimension } from "@/components/stats/breakdown-panel";
import { ReportPanels, useReportData, useWindowExport } from "@/components/stats/report";
import { EquityPanel } from "@/components/stats/equity-panel";
import { downloadReportCsv, openPrintReport } from "@/components/stats/export";
import { StatsBrokerBlock } from "@/components/propreports/BrokerReportBlock";
import { usePerformance } from "@/components/propreports/api";
import { usePeriodTrades, useTradesBookFacets } from "@/hooks/use-trades-window";
import { preferredMetricOfAggregate, useStaffAggregates } from "@/components/stats/staff-data";
import { useRangeFacets } from "@/components/shared/trade-facets/range-facets";
import { links } from "@/lib/links";
import {
  horizonLabel, HORIZON_OPTIONS, horizonOf, inRange,
  fmtDayKey, periodTexts, preferredMetric, spansYears, statsRanges, toKey,
  type HorizonFilter, type Metric, type Range,
} from "@/components/stats/metrics";
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
/**
 * The page's own view prefs. The period, the person and the unit are the analytics group's shared scope
 * (hooks/use-analytics-scope: URL → ws.analyticsScope.v1 → the old period / trader of these prefs → «Квартал»).
 * DEV-01: «Всё» and «Вся команда» are never restored from storage — every visit starts on the cheap default window.
 */
type Prefs = { metric: Metric | null; dim: Dimension; horizon: HorizonFilter };
const DEFAULT_PREFS: Prefs = { metric: null, dim: "trader", horizon: "all" };

function readPrefsRaw(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The old period / trader of these prefs (read once by the shared scope; "all" = no pick = the own book). */
function legacyStatsScope(): ScopeSource | null {
  const p = readPrefsRaw();
  if (!p) return null;
  return { period: p.period, from: p.from, to: p.to, trader: p.trader === "all" ? "" : p.trader };
}

function loadPrefs(): Prefs {
  const p = readPrefsRaw();
  if (!p) return DEFAULT_PREFS;
  return {
    metric: p.metric === "r" || p.metric === "usd" || p.metric === "net" ? p.metric : null,
    horizon: HORIZON_OPTIONS.some((o) => o.value === p.horizon) ? (p.horizon as HorizonFilter) : "all",
    dim: (["trader", "setup", "sector", "ticker", "session", "conviction"] as Dimension[]).includes(p.dim as Dimension) ? (p.dim as Dimension) : "trader",
  };
}

/** The curve's series under the shared unit: R ↔ R; $ keeps the chosen нетто / брутто (default нетто). */
function metricOfUnit(m: Metric | null, u: AnalyticsUnit | null): Metric | null {
  if (u === "r") return "r";
  if (u === "usd") return m === "usd" || m === "net" ? m : "net";
  return m;
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
    // ?horizon= (the /analytics «Обзор» link card carries its slice).
    const urlHorizon = HORIZON_OPTIONS.find((o) => o.value === new URLSearchParams(window.location.search).get("horizon"))?.value;
    return { ...loadPrefs(), ...(urlHorizon ? { horizon: urlHorizon } : {}) };
  });
  // The analytics group's shared period · person · unit (?period= / ?trader= / ?unit=; ?trader=all = «Вся команда»).
  const sc = useAnalyticsScope({ legacy: legacyStatsScope, restoreAll: false, restoreTeam: false, person: isCurator, unit: true });
  // Server-side window (DEV-01): the selected period first, the equally long previous one after it (deltas only),
  // only the picked trader. "Всё время" (on demand) still needs the whole (scoped) book.
  const ranges = useMemo(() => statsRanges(sc.period, sc.custom), [sc.period, sc.custom]);
  // Own trades only (owner rule 2026-10-21): a member never gets the trader picker or «the whole team», and a shared
  // ?trader= is ignored for them (like /analytics) — their scope is the own book, or their own name for the
  // PropReports-only switch below (soloSelf, per visit).
  const solo = !isCurator;
  const me = user?.traderName ?? null;
  const [soloSelf, setSoloSelf] = useState(false);
  const scope = statsScope({ staff: isCurator, me, picked: sc.trader && sc.trader !== TEAM ? sc.trader : "all", team: sc.trader === TEAM });
  const trader = solo ? (me && soloSelf ? me : "all") : scope.trader ?? "all";
  const windowTrader = trader !== "all" ? trader : null;
  /** The desk aggregate path: staff on «Вся команда» only. Everyone else (staff on one person too) reads raw trades. */
  const staff = scope.team;
  const pickTrader = (v: string) => sc.setTrader(v === me ? "" : v);
  const raw = usePeriodTrades(
    { from: ranges.cur.from, to: ranges.cur.to, prevFrom: ranges.prev?.from ?? null, prevTo: ranges.prev?.to ?? null, trader: windowTrader },
    !staff,
  );
  // «Разрезы» + «Исключить IMX»: x* params for staff aggregates, a filter over the own book.
  const rf = useRangeFacets({ from: ranges.cur.from, to: ranges.cur.to, trader: windowTrader });
  const agg = useStaffAggregates(
    { cur: ranges.cur, prev: ranges.prev, trader: windowTrader, horizon: prefs.horizon !== "all" ? prefs.horizon : null, facets: rf.query },
    staff,
  );
  const { isLoading, isError, refetch, isFetching, prevLoading } = staff ? agg : raw;
  const rfFilter = rf.filter;
  const allTrades = useMemo(() => rfFilter(raw.data), [raw.data, rfFilter]);
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
  // The broker block reads one person: the picked one, else the viewer's own book (never «Вся команда»).
  const brokerTrader = trader !== "all" ? trader : !staff ? me : null;
  const hasBroker = !!brokerTrader && (perf.data?.reports ?? []).some((r) => r.traderName === brokerTrader);
  // A trader whose results live only in PropReports opens straight onto their broker report.
  useEffect(() => {
    if (!solo || !me || trader !== "all" || isLoading || !perf.data) return;
    const hasJournal = teamFacets.data ? teamFacets.data.traders.includes(me) : allTrades.some((tr) => (tr.trader ?? "").trim() === me);
    if (!hasJournal && perf.data.reports.some((r) => r.traderName === me)) setSoloSelf(true);
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
  const metric: Metric = metricOfUnit(prefs.metric, sc.unit) ?? (staff ? preferredMetricOfAggregate(a) : preferredMetric(scoped));
  const pickMetric = (m: Metric) => { set("metric", m); sc.setUnit(m === "r" ? "r" : "usd"); };
  const trades = useMemo(() => inRange(scoped, ranges.cur), [scoped, ranges]);
  const prevTrades = useMemo(() => (ranges.prev && !prevLoading ? inRange(scoped, ranges.prev) : null), [scoped, ranges, prevLoading]);

  const d = useReportData({ staff, cur: a, prev: agg.prev, trades, prevTrades, metric });
  const { kpis, prevKpis, days, fees, count } = d;
  const horizonBase = useMemo(() => inRange(traderScoped, ranges.cur), [traderScoped, ranges]);
  const { exporting, withTrades } = useWindowExport({
    staff, trades, range: ranges.cur, trader: windowTrader, horizon: prefs.horizon, facets: rf.fv.view, deskTags: rf.q.data?.deskTags,
  });

  const periodOpt = periodTexts(sc.period, sc.custom);
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

  // The page header's assistant question («Как прошёл этот период?») reads the same window and person.
  useAssistantContext({ ...(ranges.cur.from ? { from: ranges.cur.from } : {}), ...(ranges.cur.to ? { to: ranges.cur.to } : {}), ...(windowTrader ? { trader: windowTrader } : {}) });

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
    >
      {!isLoading && !isError && count > 0 && (
        <StatsVerdict
          k={kpis} prev={prevKpis} prevLoading={prevLoading} metric={metric} period={sc.period}
          curRange={fmtRange(ranges.cur)} prevRange={ranges.prev ? fmtRange(ranges.prev) : null}
        />
      )}
    </PageHeader>
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
  const bookEmpty = trader === "all" && (bookTotal === 0 || (bookTotal == null && !staff && allTrades.length === 0 && sc.period === "all"));
  const prevNote = prevNoteOf(ranges.prev, prevLoading, prevKpis);

  return (
    <Page>
      {header}

      <StatsScopeToolbar
        sc={sc} presetRange={ranges.cur} rf={rf} horizon={prefs.horizon} onHorizon={(h) => set("horizon", h)}
        picker={solo ? null : { value: scopePickerValue(scope), onChange: pickTrader, me, names: [...traders, ...reportTraders] }}
      />

      {/* The result curve right under the scope row, full width (owner: the first thing after the filters). */}
      {!bookEmpty && count > 0 && (
        <EquityPanel
          equity={d.equity} monthly={d.monthly} metric={metric} trades={staff ? undefined : trades} trader={trader} daily={staff}
          onMetric={pickMetric}
        />
      )}

      {hasBroker && brokerTrader && <StatsBrokerBlock trader={brokerTrader} />}

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
              sc.period !== "all" && { label: t("showAll"), run: () => sc.setPreset("all") },
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
