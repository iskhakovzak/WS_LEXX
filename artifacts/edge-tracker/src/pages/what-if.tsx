import { type ReactNode, useEffect, useMemo, useState } from "react";
import { FeePlanBox } from "@/components/what-if/fee-plan-box";
import type { CommissionPlan } from "@/components/shared/what-if-rules";
import { ChevronDown, FlaskConical, Lightbulb, ListX, Loader2, RefreshCw, Rows3, SearchX, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton, EmptyLink, EmptyState, Page, PageHeader, Panel, Pill } from "@/components/ds";
import { links } from "@/lib/links";
import { addDays, nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { comparePersonNames, personName } from "@/i18n";
import {
  type Scope, type Suggestion, useDebounced, useDeleteScenario, useMyRules, useSaveScenario, useSavedScenarios, useTraderLimits, useWhatIfBase, useWhatIfCombos, useWhatIfRun,
  useWhatIfSuggestions,
} from "@/components/what-if/api";
import { MonthPanel } from "@/components/what-if/month-panel";
import { ComboPanel, ownSet } from "@/components/what-if/combo-panel";
import { MyRulesPanel } from "@/components/what-if/my-rules-panel";
import { LEGACY_RULE_TYPES, type Rule, type RuleType, decodeRules, encodeRules, mergeRule, removeRule, subtractRule } from "@/components/what-if/rules";
import { SuggestionCards, SuggestionsNote } from "@/components/what-if/suggestions-panel";
import { ScenarioBar } from "@/components/what-if/scenario-bar";
import { BootstrapDetails, DeltaHeadline, KeyMetrics, MetricsTable } from "@/components/what-if/compare-panel";
import { DailyHistogram, EquityChart } from "@/components/what-if/equity-chart";
import { RuleBuilder } from "@/components/what-if/rule-builder";
import { ExcludedTable } from "@/components/what-if/excluded-table";
import { ChangedDays, QuestionsBar } from "@/components/what-if/questions-bar";
import { type Question, buildQuestions, changedDays, presetsWithLimits } from "@/components/what-if/presets";
import { useLocation } from "wouter";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { TEAM } from "@/components/people/staff-scope";
import { PeriodPicker, fmtDayRange } from "@/components/shared/period/PeriodPicker";
import { RangeFacetsPanel, useRangeFacets } from "@/components/shared/trade-facets/range-facets";
import { AskAssistantButton } from "@/components/shared/ask-assistant";
import { parseDayRange, type DayRange } from "@/lib/period-range";
import { HelpButton, PageHint } from "@/components/shared/page-hint";

/**
 * /what-if — «Что если» (was /simulator; old links with ?r= / ?p= / ?trader= redirect here): the trader's own closed trades re-run under other rules (server engine
 * api-server/src/lib/whatIf.ts). One page, top to bottom: questions («а что если бы я…», one click each) → the
 * result first (before → after in $ and R, the difference big, equity curves, the days that change most — each
 * opens /day-report) → suggestions found in the data → own rule builder. The scenario, period and trader
 * live in the URL (?r=…&p=…&trader=…), so a link opens exactly the same view. Nothing is stored unless
 * a scenario is saved explicitly. This is the one place for rule what-ifs: the analytics «Что если» tab is a compact
 * summary that links here. Commission tariffs are not simulated for traders (the desk does not choose its broker fees);
 * staff get one plan what-if box (components/what-if/fee-plan-box, roadmap R2.4 — the API refuses it to non-staff).
 */

type Preset = "30d" | "90d" | "ytd" | "all";
/** A preset or «Свой период» (?p=custom&from=&to=; the range is remembered with the prefs). */
type PeriodKey = Preset | "custom";
const PERIOD_KEYS: Preset[] = ["30d", "90d", "ytd", "all"];
const ALL = "__all__";
const PREFS_KEY = "ws.simulator.prefs.v1";

function periodFrom(p: PeriodKey, today: string): string {
  switch (p) {
    case "30d": return addDays(today, -30);
    case "90d": return addDays(today, -90);
    case "ytd": return `${today.slice(0, 4)}-01-01`;
    default: return "";
  }
}

const isPeriod = (v: unknown, custom: DayRange | null): v is PeriodKey => PERIOD_KEYS.includes(v as Preset) || (v === "custom" && !!custom);

function loadPrefs(): { period: PeriodKey; trader: string; custom: DayRange | null } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<{ period: PeriodKey; trader: string; from: string; to: string }>;
    const custom = parseDayRange(p.from, p.to);
    return { period: isPeriod(p.period, custom) ? p.period : "all", trader: typeof p.trader === "string" ? p.trader : "", custom };
  } catch {
    return { period: "all", trader: "", custom: null };
  }
}

/** Initial state: URL first (shared link), then the viewer's last choice. */
function initialState(me: string) {
  const sp = new URLSearchParams(window.location.search);
  const prefs = loadPrefs();
  const p = sp.get("p");
  const linked = parseDayRange(sp.get("from"), sp.get("to"));
  const custom = p === "custom" ? linked : prefs.custom;
  return {
    custom,
    period: isPeriod(p, custom) ? p : prefs.period,
    trader: sp.get("trader") ?? (prefs.trader || me),
    rules: decodeRules(sp.get("r")),
  };
}

/** Loading: the page's own order — questions (chips) → result panel (headline, key metrics, equity chart) → suggestion cards. */
function WhatIfSkeleton() {
  return (
    <>
      {/* Same order as the page: questions (chips) → result panel → suggestion cards. */}
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-4 w-48 rounded-md" />
        <div className="flex flex-wrap gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9 w-44 rounded-full" />)}</div>
      </div>
      {/* Result panel: headline delta, key metrics, the equity chart. */}
      <div className="glass-panel flex h-[560px] flex-col gap-4 rounded-2xl p-[var(--panel-p)]" aria-hidden="true">
        <Skeleton className="h-6 w-2/3 max-w-md rounded-md" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="space-y-2 rounded-xl border border-border/40 p-3"><Skeleton className="h-3 w-16 rounded" /><Skeleton className="h-6 w-24 rounded" /></div>)}
        </div>
        <ChartSkeleton bare title={false} height={340} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-[var(--grid-gap)]" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass-panel flex h-[168px] flex-col gap-2 rounded-2xl p-4">
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-2/3 rounded" />
            <Skeleton className="mt-auto h-8 w-28 rounded-full" />
          </div>
        ))}
      </div>
    </>
  );
}

export default function WhatIf() {
  const { t } = whatIfI18n.useT();
  const { user, isCurator, canEdit, dbUsers } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const me = user?.role !== "guest" ? user?.traderName ?? "" : "";

  const [init] = useState(() => initialState(me));
  const [period, setPeriod] = useState<PeriodKey>(init.period);
  const [custom, setCustom] = useState<DayRange | null>(init.custom);
  const [trader, setTrader] = useState<string>(init.trader);
  const [rules, setRules] = useState<Rule[]>(init.rules);

  // Persist the viewer's period/trader; mirror everything into the URL (replaceState: no history spam).
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ period, trader, ...(custom ?? {}) })); } catch { /* storage unavailable */ }
  }, [period, trader, custom]);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const r = encodeRules(rules);
    if (r) sp.set("r", r); else sp.delete("r");
    if (period !== "all") sp.set("p", period); else sp.delete("p");
    if (period === "custom" && custom) { sp.set("from", custom.from); sp.set("to", custom.to); } else { sp.delete("from"); sp.delete("to"); }
    if (isCurator && trader) sp.set("trader", trader); else sp.delete("trader");
    const q = sp.toString();
    const next = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  }, [rules, period, custom, trader, isCurator]);

  const today = nyDate();
  // Traders see only themselves (the server enforces it anyway); staff pick a trader or the whole team.
  const scopeTrader = isCurator ? (trader === ALL ? "" : trader) : "";
  // 30 / 90 days move their start every day: the suggestions take the fast path there (no honest verdict can resolve).
  const win = period === "custom" && custom ? custom : { from: period === "custom" ? "" : periodFrom(period, today), to: "" };
  // «Разрезы»: x* params on every engine request (base, run, suggestions) — the engine only sees the trades that pass.
  const rf = useRangeFacets({ from: win.from || null, to: win.to || null, trader: scopeTrader || null }, user?.role !== "guest");
  const scope = useMemo<Scope>(
    () => ({ trader: scopeTrader, from: win.from, to: win.to, rolling: period === "30d" || period === "90d", facets: rf.query || undefined }),
    [scopeTrader, win.from, win.to, period, rf.query],
  );
  // The honest check runs on «всё время»: a short period's note and a card that outruns the year offer the switch.
  const showAllTime = period === "all" ? undefined : () => setPeriod("all");
  const scenarioOwner = isCurator ? (trader === ALL ? "" : trader) : me;
  const periodPhrase = period === "custom" && custom ? fmtDayRange(custom) : t(`period.${period === "custom" ? "all" : period}.phrase`);
  const periodOptions = PERIOD_KEYS.map((value) => ({ value, label: t(`period.${value}.label`) }));
  // Fee table by trader / account / month / setup / horizon (/api/edge/costs) — same trader and period as the page.

  const traders = useMemo(
    () => dbUsers.filter((u) => u.active && !u.banned && u.role !== "guest").map((u) => u.name).sort(comparePersonNames),
    [dbUsers],
  );

  const base = useWhatIfBase(scope);
  // Presets and the day-stop question follow the trader's own limits (DENIS-36); the whole team has none.
  const limitsOf = isCurator ? scopeTrader : me;
  const limits = useTraderLimits(limitsOf).data ?? null;
  const presets = useMemo(
    () => presetsWithLimits(base.data?.presets ?? [], limits ?? {})
      .map((p) => ({ ...p, rules: p.rules.filter((r) => r.type !== "commissionPlan") }))
      .filter((p) => p.rules.length > 0),
    [base.data?.presets, limits],
  );
  const hasTrades = (base.data?.trades.length ?? 0) > 0;
  // Older API builds do not list ruleTypes: then only the legacy rules are offered and sent.
  // Broker commissions are not the desk's choice (owner 2026-10-22): no tariff what-ifs — the commission-plan rule is
  // never offered, applied from a preset or sent.
  const supported = useMemo(() => new Set<RuleType>((base.data?.ruleTypes ?? LEGACY_RULE_TYPES).filter((x) => x !== "commissionPlan")), [base.data?.ruleTypes]);
  const sendable = useMemo(() => rules.filter((r) => supported.has(r.type)), [rules, supported]);
  const unsupported = useMemo(
    () => rules.filter((r) => !supported.has(r.type)).map((r) => ({ rule: r.type, reason: t("unsupportedRule") })),
    [rules, supported, t],
  );

  const rulesKey = JSON.stringify(sendable);
  const debouncedKey = useDebounced(rulesKey, 250);
  const runRules = useMemo(() => JSON.parse(debouncedKey) as Rule[], [debouncedKey]);
  const hasRules = runRules.length > 0;
  const pendingRecalc = rulesKey !== debouncedKey;

  const run = useWhatIfRun(scope, runRules, hasRules && hasTrades);
  const suggestions = useWhatIfSuggestions(scope, hasTrades);
  // «Набор правил» (the best sets + the scenario as a set) and «Мои правила в деле» (the trader's own rules).
  const combos = useWhatIfCombos(scope, useMemo(() => ownSet(runRules), [runRules]), hasTrades);
  const myRules = useMyRules(isCurator ? scopeTrader : "", hasTrades && user?.role !== "guest");
  const saved = useSavedScenarios(scenarioOwner, canEdit);
  const save = useSaveScenario(scenarioOwner);
  const del = useDeleteScenario();

  const addRule = (r: Rule) => setRules((rs) => mergeRule(rs, r));
  const toggleSuggestion = (s: Suggestion, applied: boolean) => setRules((rs) => (applied ? subtractRule(rs, s.rule) : mergeRule(rs, s.rule)));
  const toggleQuestion = (q: Question, applied: boolean) => { if (q.rule) { const rule = q.rule; setRules((rs) => (applied ? subtractRule(rs, rule) : mergeRule(rs, rule))); } };
  const questions = useMemo(
    () => buildQuestions(base.data?.trades ?? [], presets, limits ?? {}).map((q) => (q.rule && !supported.has(q.rule.type) ? { ...q, rule: null, disabled: t("unsupportedQuestion") } : q)),
    [base.data?.trades, presets, limits, supported, t],
  );
  const dayTrader = isCurator ? (trader === ALL ? "" : trader) : "";
  const openDay = (day: string) => navigate(`/day-report?date=${day}${dayTrader ? `&trader=${encodeURIComponent(dayTrader)}` : ""}`);

  // Also while a period / trader switch loads: the previous base stays on screen (placeholder), dimmed.
  const recalculating = (hasRules && (run.isFetching || pendingRecalc)) || base.isPlaceholderData;
  const controls = (
    <>
      <PeriodPicker<Preset>
        ariaLabel={t("periodAria")} value={period} custom={custom} presetRange={win.from ? { from: win.from, to: today } : null} today={today} options={periodOptions}
        onPreset={setPeriod} onCustom={(r) => { setCustom(r); setPeriod("custom"); }}
      />
      {isCurator && (
        <StaffTraderPicker
          value={!trader || trader === ALL ? TEAM : trader}
          onChange={(v) => setTrader(v === TEAM ? ALL : v)}
          me={me}
          names={traders}
          teamLabel={t("wholeTeam")}
          className="h-10 w-auto min-w-[13rem] max-w-[18rem]"
          ariaLabel={t("traderAria")}
        />
      )}
    </>
  );
  const header = (<>
    <PageHeader
      title={t("title")}
      icon={FlaskConical}
      description={t("description")}
      meta={
        recalculating ? (
          <Pill tone="accent"><Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("recalculating")}</Pill>
        ) : base.data ? (
          <span className="tabular-nums">{t("meta", { trades: commonI18n.t("units.trades", { count: base.data.trades.length }), days: t("tradingDays", { count: base.data.baseline.days }), period: periodPhrase })}</span>
        ) : null
      }
      actions={<>{controls}<AskAssistantButton context={{ ...(win.from ? { from: win.from } : {}), ...(win.to ? { to: win.to } : {}), ...(scopeTrader ? { trader: scopeTrader } : {}) }} /><HelpButton id="whatIf" /></>}
    />
    <PageHint id="whatIf" />
  </>);

  if (base.isError) {
    return (
      <Page>
        {header}
        <Panel>
          <EmptyState
            icon={SearchX}
            title={t("loadError")}
            description={(base.error as Error | null)?.message ?? t("loadErrorHint")}
            action={<Button className="rounded-full" onClick={() => void base.refetch()} disabled={base.isFetching}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> {commonI18n.t("actions.retry")}</Button>}
          />
        </Panel>
      </Page>
    );
  }

  if (base.isLoading || !base.data) {
    return (
      <Page>
        {header}
        <WhatIfSkeleton />
        <span className="sr-only" role="status">{t("loadingTrades")}</span>
      </Page>
    );
  }

  const b = base.data;
  if (b.trades.length === 0) {
    return (
      <Page>
        {header}
        <RangeFacetsPanel rf={rf} />
        <Panel>
          <EmptyState
            icon={SearchX}
            title={scopeTrader ? t("empty.titleOf", { trader: personName(scopeTrader), period: periodPhrase }) : t("empty.title", { period: periodPhrase })}
            description={period !== "all" ? (isCurator ? t("empty.longerCurator") : t("empty.longer")) : (isCurator ? t("empty.syncCurator") : t("empty.sync"))}
            action={period !== "all" ? <Button className="rounded-full" onClick={() => setPeriod("all")}>{t("empty.showAll")}</Button> : <EmptyLink href={links.myPlan()}>{commonI18n.t("emptyActions.toPlan")}</EmptyLink>}
          />
        </Panel>
      </Page>
    );
  }

  // With rules, the run response is the source of truth (placeholder keeps the previous run while the next computes).
  const r = hasRules ? run.data : undefined;
  const showScenario = hasRules && !!r;
  const baselineM = r?.baseline ?? b.baseline;
  const scenarioM = r?.scenario ?? b.baseline;
  const skipped = [...(r?.skipped ?? []), ...unsupported];

  return (
    <Page>
      {header}
      <RangeFacetsPanel rf={rf} />

      <QuestionsBar questions={questions} rules={rules} onToggle={toggleQuestion} />


      <Panel title={t("result")} icon={TrendingUp} aria-busy={recalculating || undefined}>
        <div className="flex flex-col gap-4">
          <ScenarioBar
            rules={rules}
            skipped={skipped}
            onRemove={(t) => setRules((rs) => removeRule(rs, t))}
            onClear={() => setRules([])}
            onLoad={(rs, name) => {
              setRules(decodeRules(encodeRules(rs)));
              toast({ title: t("toast.opened"), description: name });
            }}
            saved={saved.data ?? []}
            canSave={canEdit && !!scenarioOwner}
            saving={save.isPending}
            onSave={(name) =>
              save.mutate({ name, rules: sendable }, {
                onSuccess: () => toast({ title: t("toast.saved"), description: name }),
                onError: (e) => toast({ title: t("toast.saveFailed"), description: (e as Error).message, variant: "destructive" }),
              })
            }
            onDelete={(id) => del.mutate(id, {
              onSuccess: () => toast({ title: t("toast.removed") }),
              onError: (e) => toast({ title: t("toast.removeFailed"), description: (e as Error).message, variant: "destructive" }),
            })}
          />
          {run.isError && hasRules && (
            <p className="rounded-xl bg-[hsl(var(--down)/0.1)] px-3 py-2 text-sm text-down">
              {t("runError", { message: (run.error as Error | null)?.message ?? t("serverError") })}
            </p>
          )}
          <div className={cn("flex flex-col gap-4 transition-opacity duration-[var(--dur-2)] motion-reduce:transition-none", recalculating && "opacity-60")}>
            <DeltaHeadline baseline={baselineM} scenario={scenarioM} hasScenario={showScenario} bootstrap={r?.bootstrap ?? null} />
            {hasRules && !r ? (
              <ChartSkeleton bare title={false} height={340} />
            ) : (
              <EquityChart base={r?.baselineEquity ?? b.equity} scenario={r?.scenarioEquity ?? []} hasScenario={showScenario} onDay={openDay} />
            )}
            <KeyMetrics baseline={baselineM} scenario={scenarioM} hasScenario={showScenario} />
            {showScenario && <ChangedDays days={changedDays(r!.baselineDaily, r!.scenarioDaily)} trader={dayTrader} />}
          </div>
        </div>
      </Panel>

      {showScenario && <MonthPanel trades={b.trades} run={r!} onDay={openDay} />}

      <section aria-labelledby="sim-suggestions" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sim-suggestions" className="flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {t("suggestionsTitle")}
          </h2>
          <SuggestionsNote data={suggestions.data} periodPhrase={periodPhrase} onAllTime={showAllTime} />
        </div>
        <SuggestionCards data={suggestions.data} isLoading={suggestions.isLoading} rules={rules} periodLabel={periodPhrase} onToggle={toggleSuggestion} onAllTime={showAllTime} onDay={openDay} />
        {suggestions.isError && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-down" role="alert">
            {t("suggestionsError")}
            <Button variant="ghost" size="sm" onClick={() => void suggestions.refetch()} disabled={suggestions.isFetching}>
              <RefreshCw className={cn(suggestions.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /> {commonI18n.t("actions.retry")}
            </Button>
          </p>
        )}
      </section>

      <ComboPanel data={combos.data} isLoading={combos.isLoading} rules={rules} onApply={(set) => setRules((rs) => set.reduce(mergeRule, rs))} />
      <MyRulesPanel data={myRules.data} isLoading={myRules.isLoading} />

      <Panel title={t("ownTitle")} icon={SlidersHorizontal} description={t("ownHint")}>
        <RuleBuilder trades={b.trades} supported={supported} rules={rules} presets={presets} team={b.scope == null} onAdd={addRule} onApplyPreset={(p) => setRules((rs) => p.rules.filter((x) => supported.has(x.type)).reduce(mergeRule, rs))} />
      </Panel>

      {showScenario && (
        <Fold title={t("removedTitle")} icon={ListX} hint={`${commonI18n.t("units.trades", { count: r!.excluded.length })}${r!.changed.length ? ` · ${t("changedCount", { count: r!.changed.length })}` : ""}`}>
          <ExcludedTable excluded={r!.excluded} changed={r!.changed} />
        </Fold>
      )}
      {isCurator && hasTrades && <FeePlanBox scope={scope} preset={tariffPreset(base.data?.presets)} />}
      <Fold title={t("allTitle")} icon={Rows3} hint={t("allHint")}>
        <div className="flex flex-col gap-5">
          <MetricsTable baseline={baselineM} scenario={scenarioM} hasScenario={showScenario} />
          <div>
            <p className="mb-1 text-sm font-semibold">{t("daysByResult")}</p>
            <DailyHistogram base={r?.baselineDaily ?? b.daily} scenario={r?.scenarioDaily ?? []} hasScenario={showScenario} />
          </div>
          {showScenario && (
            <div>
              <p className="mb-2 text-sm font-semibold">{t("howReliable")}</p>

              <BootstrapDetails b={r!.bootstrap} />
            </div>
          )}
        </div>
      </Fold>
    </Page>
  );
}

/** The server's «tariff» preset plan (staff box default). */
function tariffPreset(presets: { id: string; rules: Rule[] }[] | undefined): CommissionPlan | null {
  const r = presets?.find((p) => p.id === "tariff")?.rules.find((x) => x.type === "commissionPlan");
  return r && r.type === "commissionPlan" ? r : null;
}

/** Collapsed-by-default section in a glass panel. */
function Fold({ title, hint, icon: Icon, children }: { title: string; hint?: string; icon: typeof ListX; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="glass-panel rounded-2xl">
      <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 rounded-2xl p-[var(--panel-p)] text-left transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-semibold">{title}</span>
        {hint && <span className="min-w-0 truncate text-xs text-muted-foreground" title={hint}>{hint}</span>}
        <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-1)] motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-[var(--panel-p)] pb-[var(--panel-p)]">{children}</CollapsibleContent>
    </Collapsible>
  );
}
