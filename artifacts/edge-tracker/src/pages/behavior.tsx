/**
 * «Поведение и сетапы» — профиль трейдера, поведенческие паттерны с $-стоимостью, трендом и правилом,
 * индекс дисциплины по дням с лентой сессии, «мои триггеры» и авто-классификатор сетапов (правила без ИИ)
 * с интервалами, матрицами и принятием в сделку. Трейдер видит себя; staff (= трейдер + доп. функции) — тоже себя
 * по умолчанию, и любого человека со сделками через выбор (components/behavior/behavior-trader).
 * URL: ?trader=&period=&tab=&day=.
 */
import * as React from "react";
import { Activity, BellRing, Brain, CalendarRange, Gauge, Grid3x3, LineChart, Sparkles, UserRound } from "lucide-react";
import {
  ChartSkeleton, EmptyLink, EmptyState, ErrorState, ListSkeleton, Page, PageHeader, Panel, PanelSkeleton, Pill, SectionTabs, Segmented, SkeletonBlock, TableSkeleton,
} from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { addDays, nyDate } from "@/lib/trading-date";
import { useReducedMotion } from "@/lib/motion";
import {
  useBehavior, useComputeAll, useSetupAggregates, useSetupsAuto, type BehaviorReport, type Range,
} from "@/components/behavior/api";
import { fmtDate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { behaviorI18n } from "@/i18n/ns/behavior";

const tb = behaviorI18n.t;
import { TraderProfilePanel } from "@/components/behavior/trader-profile";
import { PatternCards } from "@/components/behavior/pattern-cards";
import { DisciplineHeatmap } from "@/components/behavior/discipline-heatmap";
import { SessionTimeline } from "@/components/behavior/session-timeline";
import { TriggersPanel } from "@/components/behavior/triggers-panel";
import { BucketBars } from "@/components/behavior/behavior-charts";
import { SetupsTable } from "@/components/behavior/setups-table";
import { SetupsAggregates } from "@/components/behavior/setups-aggregates";
import { SetupsMatrix } from "@/components/behavior/setups-matrix";
import { ComputeAllBar } from "@/components/behavior/setups-compute";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { useTradesBookFacets } from "@/hooks/use-trades-window";
import { fallbackBehaviorTrader, initialBehaviorTrader } from "@/components/behavior/behavior-trader";
import { PeriodPicker } from "@/components/shared/period/PeriodPicker";
import { RangeFacetsPanel, useRangeFacets } from "@/components/shared/trade-facets/range-facets";
import { parseDayRange, type DayRange } from "@/lib/period-range";
import { HelpButton, PageHint } from "@/components/shared/page-hint";

type Tab = "behavior" | "setups";
type Preset = "30d" | "90d" | "ytd" | "all";
/** A preset or «Свой период» (?period=custom&from=&to=). */
type Period = Preset | "custom";
const PERIOD_KEYS: Preset[] = ["30d", "90d", "ytd", "all"];
const periodOptions = () => PERIOD_KEYS.map((value) => ({ value, label: tb(`period.${value}`) }));
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function rangeOf(p: Period, custom: DayRange | null): Range {
  const today = nyDate();
  if (p === "custom" && custom) return { from: custom.from, to: custom.to };
  if (p === "all") return { from: null, to: null };
  if (p === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: null };
  return { from: addDays(today, -(p === "30d" ? 29 : 89)), to: null };
}

function readParams(): { trader: string | null; period: Period; custom: DayRange | null; tab: Tab; day: string | null } {
  const p = new URLSearchParams(window.location.search);
  const period = p.get("period");
  const custom = parseDayRange(p.get("from"), p.get("to"));
  const tab = p.get("tab");
  const day = p.get("day");
  return {
    trader: p.get("trader"),
    period: period === "30d" || period === "90d" || period === "ytd" || period === "all" || (period === "custom" && custom) ? period : "90d",
    custom,
    tab: tab === "setups" ? "setups" : "behavior",
    day: day && YMD.test(day) ? day : null,
  };
}

function writeParams(trader: string | null, period: Period, custom: DayRange | null, tab: Tab, day: string | null) {
  const p = new URLSearchParams(window.location.search);
  if (trader) p.set("trader", trader); else p.delete("trader");
  if (period !== "90d") p.set("period", period); else p.delete("period");
  if (period === "custom" && custom) { p.set("from", custom.from); p.set("to", custom.to); } else { p.delete("from"); p.delete("to"); }
  if (tab !== "behavior") p.set("tab", tab); else p.delete("tab");
  if (day && tab === "behavior") p.set("day", day); else p.delete("day");
  const qs = p.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

// v2: the old key also held the «first trader» the page used to swap a staff member's own name for.
const TRADER_KEY = "behavior.trader.v2";
function readStoredTrader(): string | null {
  try { return localStorage.getItem(TRADER_KEY) || null; } catch { return null; }
}
function storeTrader(name: string) {
  try { localStorage.setItem(TRADER_KEY, name); } catch { /* storage unavailable */ }
}

export default function BehaviorPage() {
  const { user, isCurator, canEdit } = useAuth();
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  const initial = React.useMemo(readParams, []);
  const [tab, setTab] = React.useState<Tab>(initial.tab);
  const [period, setPeriod] = React.useState<Period>(initial.period);
  const [custom, setCustom] = React.useState<DayRange | null>(initial.custom);
  // Staff: an explicit ?trader= wins, then the person picked by hand last time, then their own name.
  const [trader, setTrader] = React.useState<string | null>(() =>
    initialBehaviorTrader({ staff: isCurator, me, urlTrader: initial.trader, stored: isCurator ? readStoredTrader() : null }));
  const [day, setDay] = React.useState<string | null>(initial.day);
  // Everyone with trades in the viewer's scope (traders, curators, admins) — the staff picker's people.
  const facets = useTradesBookFacets({ enabled: isCurator });
  const names = facets.data?.traders;

  React.useEffect(() => { if (!trader && me) setTrader(me); }, [trader, me]);
  React.useEffect(() => {
    const first = fallbackBehaviorTrader({ staff: isCurator, me, trader, names: names ?? [] });
    if (first) setTrader(first);
  }, [isCurator, me, trader, names]);
  React.useEffect(() => { writeParams(isCurator ? trader : null, period, custom, tab, day); }, [trader, period, custom, tab, day, isCurator]);
  const pickTrader = (v: string) => { setTrader(v); setDay(null); storeTrader(v); };

  // Сервер сам ограничивает scope: трейдер всегда видит только себя, staff — выбранного.
  const scopeTrader = isCurator ? trader : null;
  const win = React.useMemo(() => rangeOf(period, custom), [period, custom]);
  // «Разрезы»: every block of both tabs reads the same selection (x* params on /behavior* and /setups-auto*).
  const rf = useRangeFacets({ from: win.from, to: win.to, trader: scopeTrader }, user?.role !== "guest");
  const range = React.useMemo<Range>(() => ({ ...win, facets: rf.query || undefined }), [win, rf.query]);
  const isGuest = user?.role === "guest";
  const openSetups = React.useCallback(() => setTab("setups"), []);

  return (
    <Page>
      <PageHeader
        title={tb("title")}
        description={tb("description")}
        icon={Brain}
        actions={<HelpButton id="behavior" />}
      >
        {/* Tabs left, the scope (person, period) right — one row under the title, so the h1 keeps its width and the
            profile below starts high (design audit wave 2B). Phones: the controls wrap under the tabs. */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[var(--glass-border)]">
          <SectionTabs
            ariaLabel={tb("sectionsAria")}
            value={tab}
            onChange={setTab}
            className="border-b-0"
            tabs={[
              { value: "behavior", label: tb("tab.behavior"), icon: Activity },
              { value: "setups", label: tb("tab.setups"), icon: Sparkles },
            ]}
          />
          <div className="flex w-full min-w-0 items-center gap-2 pb-1.5 sm:w-auto sm:flex-wrap">
            {isCurator && (
              <StaffTraderPicker value={trader ?? ""} onChange={pickTrader} me={me} names={names ?? []} team={false} className="h-9 w-auto min-w-0 flex-1 sm:min-w-[13rem] sm:max-w-[18rem] sm:flex-none" ariaLabel={tb("traderAria")} />
            )}
            <PeriodPicker<Preset>
              ariaLabel={tb("periodAria")} value={period} custom={custom} presetRange={win} today={nyDate()} options={periodOptions()} size="sm"
              onPreset={setPeriod} onCustom={(r) => { setCustom(r); setPeriod("custom"); }}
            />
          </div>
        </div>
      </PageHeader>
      <PageHint id="behavior" />

      {!isGuest && <RangeFacetsPanel rf={rf} />}

      {isGuest ? (
        <Panel><EmptyState icon={Brain} title={tb("guest")} description={tb("guestHint")} action={<EmptyLink href="/">{commonI18n.t("emptyActions.toDashboard")}</EmptyLink>} /></Panel>
      ) : tab === "behavior" ? (
        <BehaviorTab trader={scopeTrader} me={me} range={range} canEdit={canEdit} day={day} onDay={setDay} onOpenSetups={openSetups} />
      ) : (
        <SetupsTab trader={scopeTrader} range={range} canEdit={canEdit} />
      )}
    </Page>
  );
}

/* ─── Вкладка «Поведение» ─────────────────────────────────────────────────── */

function BehaviorSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]" aria-busy="true" aria-label={tb("loadingAria")}>
      <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-12">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass-panel flex h-[196px] flex-col gap-2 rounded-2xl p-4 lg:col-span-3" aria-hidden="true">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-8 w-28" />
            <SkeletonBlock className="h-3 w-3/4" />
            <SkeletonBlock className="mt-auto h-14 w-full rounded-lg" />
          </div>
        ))}
        <ChartSkeleton className="h-[188px] lg:col-span-12" height="100%" kind="bars" />
      </div>
      <div className="grid grid-cols-1 gap-[var(--grid-gap)] xl:grid-cols-2">
        <ChartSkeleton className="h-[460px]" height="100%" />
        <div className="glass-panel flex h-[460px] flex-col gap-3 rounded-2xl p-[var(--panel-p)]"><SkeletonBlock className="h-4 w-40" /><ListSkeleton rows={8} /></div>
      </div>
      <PanelSkeleton height={200} />
    </div>
  );
}

/** День ленты по умолчанию: последний день со срывом среди последних 10 торговых, иначе последний день. */
function defaultDay(r: BehaviorReport): string | null {
  const d = r.discipline;
  if (!d.length) return null;
  const recent = d.slice(-10);
  const bad = [...recent].reverse().find((x) => x.score < 85);
  return (bad ?? d[d.length - 1]).date;
}

function BehaviorTab({
  trader, me, range, canEdit, day, onDay, onOpenSetups,
}: {
  trader: string | null;
  me: string | null;
  range: Range;
  canEdit: boolean;
  day: string | null;
  onDay: (d: string | null) => void;
  onOpenSetups: () => void;
}) {
  const q = useBehavior(trader, range);
  const reduce = useReducedMotion();
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const r = q.data;

  // Выбранный день должен быть в периоде; иначе — день по умолчанию.
  const days = r?.discipline;
  React.useEffect(() => {
    if (!r || !days) return;
    if (!day || !days.some((d) => d.date === day)) onDay(defaultDay(r));
  }, [r, days, day, onDay]);

  const pickFromTriggers = React.useCallback((d: string) => {
    onDay(d);
    timelineRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [onDay, reduce]);
  const pickFromHeatmap = React.useCallback((d: string) => onDay(d), [onDay]);

  if (r === undefined) {
    if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
    return <BehaviorSkeleton />;
  }
  if (!r.summary.closed) {
    return <Panel><EmptyState icon={Brain} title={tb("empty")} description={tb("emptyHint")} action={<EmptyLink href="/trades">{commonI18n.t("emptyActions.toTrades")}</EmptyLink>} /></Panel>;
  }
  const owner = r.scope ?? me;
  const noTime = r.summary.closed - r.summary.withTime;
  const periodLabel = r.summary.from && r.summary.to ? `${fmtDate(r.summary.from, "weekdayDayMonth")} — ${fmtDate(r.summary.to, "weekdayDayMonth")}` : "";

  return (
    <div className={`flex flex-col gap-[var(--grid-gap)] transition-opacity duration-[var(--dur-2)] ${q.isFetching && q.isPlaceholderData ? "opacity-70" : ""}`}>
      {r.profile && <Panel
        title={tb("profile")}
        description={`${tb("profileHint", { trades: commonI18n.t("units.trades", { count: r.summary.closed }), days: tb("tradingDays", { count: r.summary.days }) })}${periodLabel ? ` · ${periodLabel}` : ""}`}
        icon={UserRound}
        actions={noTime > 0 ? <Pill tone="neutral" title={tb("noTimeTitle")}>{tb("noTime", { count: noTime })}</Pill> : undefined}
      >
        <TraderProfilePanel report={r} onOpenSetups={onOpenSetups} />
      </Panel>}

      <Panel
        title={tb("patterns")}
        description={tb("patternsHint")}
        icon={Activity}
      >
        <PatternCards patterns={r.patterns} trader={owner} canEdit={canEdit} />
      </Panel>

      <Panel title={tb("discipline")} description={tb("disciplineHint")} icon={Gauge}>
        <DisciplineHeatmap days={r.discipline} formula={r.disciplineFormula} avg={r.disciplineAvg} selected={day} onSelect={pickFromHeatmap} />
      </Panel>

      <div ref={timelineRef} className="scroll-mt-4">
        <Panel title={tb("session")} description={tb("sessionHint")} icon={CalendarRange}>
          <SessionTimeline trader={trader} range={range} days={r.discipline} date={day} onDateChange={pickFromHeatmap} />
        </Panel>
      </div>

      <Panel title={tb("triggers")} description={tb("triggersHint")} icon={BellRing}>
        <TriggersPanel trader={owner} range={range} onPickDay={pickFromTriggers} />
      </Panel>

      <Panel title={tb("curves")} description={tb("curvesHint")} icon={LineChart}>
        <div className="grid grid-cols-1 gap-[var(--grid-gap)] xl:grid-cols-3">
          <section aria-label={tb("byNumberAria")} className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-medium text-foreground">{tb("byNumber")}</h3>
            <BucketBars data={r.byTradeNumber} ariaLabel={tb("byNumberAria")} />
          </section>
          <section aria-label={tb("byPauseAria")} className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-medium text-foreground">{tb("byPause")}</h3>
            <BucketBars data={r.byMinutesAfterLoss} ariaLabel={tb("byPauseAria")} />
          </section>
          <section aria-label={tb("byHourAria")} className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-medium text-foreground">{tb("byHour")}</h3>
            <BucketBars data={r.byHour} ariaLabel={tb("byHourAria")} />
          </section>
        </div>
      </Panel>
    </div>
  );
}

/* ─── Вкладка «Сетапы» ────────────────────────────────────────────────────── */

/** Сколько недостающих предложений досчитывать в фоне без клика (≈ 4 пакета по 30). */
const AUTO_COMPUTE_MAX = 120;

function SetupsTab({ trader, range, canEdit }: { trader: string | null; range: Range; canEdit: boolean }) {
  // «Все сделки» by default: auto trades almost always carry the broker strategy, so «without one» opened empty.
  const [withSetup, setWithSetup] = React.useState(true);
  // budget 0: страница открывается мгновенно из кэша предложений; недостающие досчитываются в фоне
  // (небольшой хвост — сразу, большой — по кнопке «Посчитать всё», чтобы не жечь лимиты рыночных данных).
  const list = useSetupsAuto(trader, range, { withSetup, budget: 0 });
  const agg = useSetupAggregates(trader, range, withSetup);
  const compute = useComputeAll(trader, range, withSetup);
  const pending = compute.state.status === "running" ? compute.state.pending : list.data?.pending ?? 0;
  const autoKey = `${trader ?? ""}|${range.from ?? ""}|${range.to ?? ""}|${withSetup ? 1 : 0}`;
  const autoRan = React.useRef<string | null>(null);
  const listPending = list.data && !list.isPlaceholderData ? list.data.pending : null;
  const { run: runCompute, state: { status: computeStatus } } = compute;
  React.useEffect(() => {
    if (!canEdit || listPending == null || autoRan.current === autoKey || computeStatus !== "idle") return;
    autoRan.current = autoKey;
    if (listPending > 0 && listPending <= AUTO_COMPUTE_MAX) void runCompute();
  }, [canEdit, listPending, autoKey, computeStatus, runCompute]);

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel={tb("classifyAria")}
          value={withSetup ? "all" : "empty"}
          onChange={(v) => setWithSetup(v === "all")}
          options={[{ value: "empty", label: tb("classifyEmpty") }, { value: "all", label: tb("classifyAll") }]}
        />
        {list.data && (
          <span className="text-xs text-muted-foreground">
            {tb("rulesVersion", { trades: commonI18n.t("units.trades", { count: list.data.total }), version: list.data.version })}
          </span>
        )}
      </div>

      {list.data && (
        <ComputeAllBar state={compute.state} pending={pending} canRun={canEdit} onRun={() => void compute.run()} onCancel={compute.cancel} />
      )}

      <Panel title={tb("setupEdge")} description={tb("setupEdgeHint")} icon={Sparkles}>
        {agg.data === undefined ? (
          agg.isError ? <ErrorState error={agg.error} onRetry={agg.refetch} compact /> : <TableSkeleton rows={5} cols={7} />
        ) : (
          <SetupsAggregates groups={agg.data.groups} covered={agg.data.covered} pending={agg.data.pending} smallSample={agg.data.smallSample} trader={trader} />
        )}
      </Panel>

      <Panel title={tb("setupWhere")} description={tb("setupWhereHint")} icon={Grid3x3}>
        {agg.data === undefined ? (
          agg.isError ? <ErrorState error={agg.error} onRetry={agg.refetch} compact /> : <SkeletonBlock className="h-[240px] w-full rounded-xl" />
        ) : (
          <SetupsMatrix data={agg.data} />
        )}
      </Panel>

      <Panel title={tb("setupTrades")} description={tb("setupTradesHint")} icon={Sparkles}>

        {list.data === undefined ? (
          list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : <TableSkeleton rows={8} cols={8} />
        ) : (
          <SetupsTable items={list.data.items} canEdit={canEdit} onlyUntagged={!withSetup} onShowAll={() => setWithSetup(true)} />
        )}
      </Panel>
    </div>
  );
}
