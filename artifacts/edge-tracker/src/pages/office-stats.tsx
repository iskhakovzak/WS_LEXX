/**
 * «Статистика офиса» — office-wide performance for everyone in the office.
 *
 * Partners (role admin) see $ and %, per-trader rows and set the yearly capital + goal.
 * Traders / curators get % of office capital only — the server strips $, absolute volume and per-trader rows
 * before the response leaves it, so nothing here relies on hiding for privacy; admin blocks are simply not mounted.
 */
import * as React from "react";
import { AlertTriangle, BadgeCheck, Building2, CalendarDays, Clock, GraduationCap, Landmark, LayoutDashboard, Layers, ShieldAlert, Users } from "lucide-react";
import { BentoGrid, EmptyState, Page, PageHeader, Panel, Pill, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api/http";
import { monthLong, useOfficeStats, type Unit } from "@/components/office-stats/api";
import { nyDate } from "@/lib/trading-date";
import {
  CalendarHeatmap, DayDetail, GeneralChart, InsightsStrip, KpiRow, PacePanel, type Ctx,
} from "@/components/office-stats/overview";
import { StrategyMonthMatrix, StrategyMultiples, StrategyTable, TotalNetByStrategy, VolumeShare } from "@/components/office-stats/strategies";
import { BestWorstDays, DailyHistogram, StreaksPanel, Tickers, TimeOfDay, Underwater, WeekdayProfile } from "@/components/office-stats/time-risk";
import { CapitalPanel, CsvButton, RulesPopover, TradersTable } from "@/components/office-stats/team";
import { MonthlyPanel } from "@/components/office-stats/monthly";
import { OfficeRecommendations } from "@/components/office-stats/recommendations";
import { WeeklyPulseCard } from "@/components/office-stats/pulse-card";
import { officeRecsI18n } from "@/i18n/ns/officeRecs";
import { JuniorCostDesk } from "@/components/office-stats/junior-cost-desk";
import { juniorCostI18n } from "@/i18n/ns/juniorCost";
import { scrollBehavior } from "@/lib/motion";
import { officeI18n } from "@/i18n/ns/officeStats";
import { shellI18n } from "@/i18n/ns/shell";
import { commonI18n } from "@/i18n/ns/common";
import { useAuth } from "@/contexts/auth-context";
import { fmtDayRange } from "@/components/shared/period/PeriodPicker";
import { ActiveFilters } from "@/components/shared/filters/filter-toolbar";
import { rangeFacetChips, resetRangeFacets, useRangeFacets } from "@/components/shared/trade-facets/range-facets";
import { OfficeScopeBar } from "@/components/office-stats/office-scope-bar";
import { parseDayRange, type DayRange } from "@/lib/period-range";
import { readOfficeUrl, useStoredState, writeOfficeUrl, type OfficeMode as PeriodMode } from "@/components/office-stats/office-period";

const MODES: PeriodMode[] = ["ytd", "quarter", "month", "custom"];

const nyToday = (): string => nyDate();
const pad2 = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const minYmd = (a: string, b: string) => (a < b ? a : b);

const SECTIONS = [
  { id: "overview", icon: LayoutDashboard },
  { id: "advice", icon: BadgeCheck },
  { id: "juniors", icon: GraduationCap, staff: true },
  { id: "strategies", icon: Layers },
  { id: "time", icon: Clock },
  { id: "risk", icon: ShieldAlert },
  { id: "team", icon: Users, admin: true },
] as const;

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    // The scroller's scroll-padding (--scroll-pad-top) already clears a stuck bar; the margin is just breathing room.
    <section id={`office-${id}`} aria-labelledby={`office-${id}-h`} className="flex scroll-mt-3 flex-col gap-[var(--grid-gap)]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-2">
        <h2 id={`office-${id}-h`} className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * Section jump: land the heading right under the sticky section nav, measured (the nav's height and the header
 * differ between desktop and phone), instead of relying on a fixed scroll margin that can end up under the nav.
 */
function jumpToSection(id: string, nav: HTMLElement | null) {
  const el = document.getElementById(`office-${id}`);
  if (!el) return;
  const scroller = document.getElementById("main-content");
  if (!scroller || !nav) { el.scrollIntoView({ behavior: scrollBehavior(), block: "start" }); return; }
  const sc = scroller.getBoundingClientRect();
  const navH = nav.offsetHeight + (parseFloat(getComputedStyle(nav).top) || 0);
  const top = scroller.scrollTop + el.getBoundingClientRect().top - sc.top - navH - 12;
  scroller.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
}

export default function OfficeStatsPage() {
  const { t } = officeI18n.useT();
  const today = nyToday();
  const ty = Number(today.slice(0, 4));
  // Years with desk trades (from the last answer): no chips for empty years (OWNER-13: 2023 / 2024 before the data starts).
  const [dataYears, setDataYears] = React.useState<number[] | null>(null);
  const yearChoices = React.useMemo(() => [ty - 3, ty - 2, ty - 1, ty].filter((y) => y === ty || !dataYears || dataYears.includes(y)), [ty, dataYears]);
  // The period lives in the URL (?period=&q=&m=&years=, components/office-stats/office-period); the device keys are
  // the fallback for a bare /office.
  const [url] = React.useState(() => readOfficeUrl(typeof window === "undefined" ? "" : window.location.search));
  const [years, setYears] = useStoredState<number[]>("office-stats.years", url.years, [ty - 1, ty]);
  const selYears = React.useMemo(() => {
    const ok = years.filter((y) => yearChoices.includes(y)).sort((a, b) => a - b);
    return ok.length ? ok : [ty];
  }, [years, ty, yearChoices]);
  const focusYear = selYears[selYears.length - 1];

  const [storedMode, setMode] = useStoredState<PeriodMode>("office-stats.period", url.mode, "ytd");
  const curQ = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const [quarter, setQuarter] = React.useState<number>(url.q ?? (focusYear === ty ? curQ : 4));
  const [month, setMonth] = React.useState<number>(url.m ?? (focusYear === ty ? Number(today.slice(5, 7)) : 12));
  const [storedCustom, setCustom] = useStoredState<DayRange | null>("office-stats.custom", url.mode === "custom" ? url.custom : null, null);
  const custom = parseDayRange(storedCustom?.from, storedCustom?.to);
  const mode: PeriodMode = MODES.includes(storedMode) && (storedMode !== "custom" || custom) ? storedMode : "ytd";

  // A month / quarter picked for an earlier year can lie in the future of the current one (December → 2026 in
  // October): clamp it to today, otherwise the period would start after it ends.
  const tm = Number(today.slice(5, 7));
  const effMonth = focusYear === ty ? Math.min(month, tm) : month;
  const effQuarter = focusYear === ty ? Math.min(quarter, curQ) : quarter;

  const period = React.useMemo(() => {
    const y = focusYear;
    const quarter = effQuarter;
    const month = effMonth;
    const cap = (ymd: string) => minYmd(ymd, today);
    if (mode === "quarter") { const m0 = (quarter - 1) * 3 + 1; return { from: `${y}-${pad2(m0)}-01`, to: cap(`${y}-${pad2(m0 + 2)}-${lastDay(y, m0 + 2)}`) }; }
    if (mode === "month") return { from: `${y}-${pad2(month)}-01`, to: cap(`${y}-${pad2(month)}-${lastDay(y, month)}`) };
    if (mode === "custom" && custom) return custom;
    return { from: `${y}-01-01`, to: cap(`${y}-12-31`) };
  }, [mode, effQuarter, effMonth, custom?.from, custom?.to, focusYear, today]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    writeOfficeUrl({ mode, custom, q: effQuarter, m: effMonth, years: selYears });
  }, [mode, custom?.from, custom?.to, effQuarter, effMonth, selYears]); // eslint-disable-line react-hooks/exhaustive-deps

  const periodLabel = mode === "quarter"
    ? t("period.quarterOfYear", { q: effQuarter, year: focusYear })
    : mode === "month"
      ? t("period.monthOfYear", { month: monthLong(effMonth - 1), year: focusYear })
      : mode === "custom" && custom
        ? fmtDayRange(custom)
        : t("period.ytdOf", { year: focusYear });

  // «Разрезы» for partners only: a member's facet buckets would be the own book, not the office the numbers are about.
  const { user, isCurator: isStaff } = useAuth();
  const partner = user?.role === "admin";
  const rf = useRangeFacets({ from: period.from, to: period.to }, partner);
  const q = useOfficeStats({ years: selYears, from: period.from, to: period.to, facets: rf.query || undefined });
  const data = q.data;
  const answerYears = data?.dataYears;
  React.useEffect(() => { if (answerYears) setDataYears((cur) => (cur && cur.join() === answerYears.join() ? cur : answerYears)); }, [answerYears]);
  const isAdmin = data?.role === "admin";

  const [unitPref, setUnitPref] = usePersistentState<Unit | null>("office-stats.unit", null);
  const focusSetting = isAdmin ? data.settings.find((s) => s.year === focusYear) : undefined;
  const capitalSet = isAdmin ? !!focusSetting?.capital : data?.role === "member" ? !!data.settings.find((s) => s.year === focusYear)?.hasCapital : false;
  // The remembered unit wins, except % for a year without capital (nothing to divide by) — then $.
  const unit: Unit = isAdmin ? (unitPref === "usd" || (unitPref === "pct" && capitalSet) ? unitPref : capitalSet ? "pct" : "usd") : "pct";
  const view = data ? (data.role === "admin" ? (unit === "usd" ? data.usd : data.pct) : data.pct) : undefined;
  const focus = view?.years.find((y) => y.year === focusYear);

  const [day, setDay] = React.useState<string | null>(null);
  React.useEffect(() => { setDay(null); }, [focusYear]);
  const pickDay = (d: string) => { setDay(d); document.getElementById("office-day")?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }); };
  const pickMonth = (m: number) => { setMonth(m); setMode("month"); };
  const navRef = React.useRef<HTMLElement>(null);
  const jump = (id: string) => jumpToSection(id, navRef.current);

  const toggleYear = (y: number) => setYears((cur) => {
    const has = cur.includes(y);
    if (has && cur.length === 1) return cur;
    return has ? cur.filter((x) => x !== y) : [...cur, y].sort((a, b) => a - b);
  });

  const forbidden = q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401);
  const memberNoCapital = data?.role === "member" && !capitalSet;
  const adminPctNoCapital = isAdmin && unit === "pct" && !capitalSet;
  const liveKey = q.isPlaceholderData ? "loading" : [unit, selYears.join(","), period.from, period.to, rf.query ?? ""].join("|");
  const ctx: Ctx | null = view && focus ? { unit, view, focus, isAdmin, liveKey } : null;
  const showAdminHint = isAdmin && !capitalSet;

  return (
    <Page>
      <PageHeader
        title={shellI18n.t("nav.office")}
        icon={Building2}
        description={isAdmin
          ? t("page.descAdmin")
          : t("page.descMember")}
        meta={data && (
          <>
            <Pill tone={isAdmin ? "accent" : "neutral"}>{isAdmin ? t("page.pillAdmin") : t("page.pillMember")}</Pill>
            <span>{t("page.meta", { period: periodLabel })}</span>
          </>
        )}
        actions={data && (
          <span className="hidden items-center gap-2 sm:flex">
            <RulesPopover rules={data.rules} isAdmin={isAdmin} />
            {data.role === "admin" && <CsvButton data={data} unit={unit} />}
          </span>
        )}
      >
        {data && (
          <div className="flex items-center gap-2 sm:hidden">
            <RulesPopover rules={data.rules} isAdmin={isAdmin} />
            {data.role === "admin" && <CsvButton data={data} unit={unit} />}
          </div>
        )}
      </PageHeader>

      <OfficeScopeBar
        yearChoices={yearChoices} selYears={selYears} focusYear={focusYear} onToggleYear={toggleYear}
        mode={mode} custom={custom} period={period} today={today} onMode={setMode} onCustom={(r) => { setCustom(r); setMode("custom"); }}
        quarter={effQuarter} onQuarter={setQuarter} maxQuarter={focusYear === ty ? curQ : 4}
        month={effMonth} onMonth={setMonth} maxMonth={focusYear === ty ? Number(today.slice(5, 7)) : 12}
        unit={isAdmin ? { value: unit, onChange: setUnitPref, capitalSet } : null} rf={rf}
      />
      <ActiveFilters items={rangeFacetChips(rf)} onReset={() => resetRangeFacets(rf)} />

      {/* Section anchors (sticky). */}
      {ctx && !memberNoCapital && (
        <nav ref={navRef} aria-label={t("page.sectionsNav")} className="sticky top-2 z-sticky -my-1 flex justify-center">
          <div className="glass-panel scrollbar-none flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-surface-solid/95 p-[3px] shadow-sm">
            {SECTIONS.filter((s) => (!("admin" in s) || isAdmin) && (!("staff" in s) || isStaff)).map((s) => (
              <button key={s.id} type="button" onClick={() => jump(s.id)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] hover:text-foreground">
                <s.icon className="h-3.5 w-3.5" aria-hidden="true" />{s.id === "advice" ? officeRecsI18n.t("title") : s.id === "juniors" ? juniorCostI18n.t("desk.title") : t(`page.sections.${s.id}`)}
              </button>
            ))}
          </div>
        </nav>
      )}

      {forbidden ? (
        <Panel><EmptyState icon={Building2} title={t("states.noAccessTitle")} description={t("states.noAccessDesc")} /></Panel>
      ) : q.isError && !data ? (
        <Panel><EmptyState icon={AlertTriangle} title={t("states.loadFailed")} description={q.error instanceof Error ? q.error.message : undefined} action={<Button size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{commonI18n.t("actions.retry")}</Button>} /></Panel>
      ) : !data ? (
        <div className="flex flex-col gap-[var(--grid-gap)]" aria-busy="true" aria-label={t("page.loading")}>
          <div className="skeleton h-24 rounded-2xl" />
          <div className="grid grid-cols-2 gap-[var(--grid-gap)] md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}</div>
          <div className="skeleton h-[380px] rounded-2xl" />
        </div>
      ) : memberNoCapital ? (
        <Panel>
          <EmptyState
            icon={Landmark}
            title={t("states.noCapitalTitle", { year: focusYear })}
            description={t("states.noCapitalDesc")}
            action={data.settings.filter((s) => s.hasCapital && s.year !== focusYear).slice(-1).map((s) => (
              <Button key={s.year} size="sm" variant="outline" onClick={() => setYears([s.year])}>{t("states.openYear", { year: s.year })}</Button>
            ))}
          />
        </Panel>
      ) : !ctx || !view || !focus ? (
        <Panel><EmptyState icon={CalendarDays} title={t("states.noTradesYear", { year: focusYear })} /></Panel>
      ) : (
        <div className={cn("flex flex-col gap-[var(--page-gap)] transition-opacity duration-[var(--dur-2)]", q.isFetching && "opacity-70")} aria-busy={q.isFetching || undefined}>
          {(showAdminHint || adminPctNoCapital) && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/30 bg-warn/10 p-3 text-sm">
              <Landmark className="h-4 w-4 text-warn" aria-hidden="true" />
              <span className="min-w-0 flex-1">{t("states.adminNoCapital", { year: focusYear })}</span>
              <Button size="sm" variant="outline" onClick={() => jump("team")}>{t("states.setCapital")}</Button>
            </div>
          )}

          <Section id="overview" title={t("page.sections.overview")} hint={periodLabel}>
            {/* The answer first (design audit wave 2B): the year's totals, then the pace to the goal beside the curve;
                the automatic insights and the week's pulse follow. */}
            <KpiRow ctx={ctx} period={view.period} onJump={jump} />
            <BentoGrid>
              <GeneralChart ctx={ctx} onPickDay={pickDay} />
              <div className="flex flex-col gap-[var(--grid-gap)] lg:col-span-4">
                <PacePanel ctx={ctx} today={data.today} />
                <div id="office-day" className="flex-1"><DayDetail ctx={ctx} date={day} onClear={() => setDay(null)} /></div>
              </div>
            </BentoGrid>
            <BentoGrid>
              {view.insights.length > 0 && <div className="lg:col-span-12 xl:col-span-8"><InsightsStrip insights={view.insights} /></div>}
              <WeeklyPulseCard ctx={ctx} today={data.today} onPickDay={pickDay} className={view.insights.length > 0 ? "lg:col-span-12 xl:col-span-4" : "lg:col-span-6"} />
            </BentoGrid>
            <CalendarHeatmap ctx={ctx} selected={day} onPickDay={pickDay} onPickMonth={pickMonth} />
            <MonthlyPanel ctx={ctx} today={data.today} onPickMonth={pickMonth} />
          </Section>

          <Section id="advice" title={officeRecsI18n.t("title")} hint={officeRecsI18n.t("hint")}>
            <OfficeRecommendations />
          </Section>

          {isStaff && <Section id="juniors" title={juniorCostI18n.t("desk.title")} hint={juniorCostI18n.t("desk.hint")}><JuniorCostDesk /></Section>}

          <Section id="strategies" title={t("page.sections.strategies")} hint={t("page.strategiesHint")}>
            <BentoGrid>
              <TotalNetByStrategy ctx={ctx} years={view.years.filter((y) => y.year <= focusYear)} />
              <VolumeShare years={view.years.filter((y) => y.year <= focusYear)} />
            </BentoGrid>
            <StrategyMultiples ctx={ctx} />
            <StrategyMonthMatrix ctx={ctx} onPickMonth={pickMonth} />
            <StrategyTable period={view.period} prev={view.prev} unit={unit} periodLabel={periodLabel} />
          </Section>

          <Section id="time" title={t("page.sections.time")} hint={periodLabel}>
            <BentoGrid>
              <TimeOfDay period={view.period} unit={unit} />
              <WeekdayProfile period={view.period} unit={unit} />
            </BentoGrid>
            <Tickers period={view.period} unit={unit} />
          </Section>

          <Section id="risk" title={t("page.sections.risk")} hint={`${focusYear}`}>
            <BentoGrid>
              <Underwater ctx={ctx} onPickDay={pickDay} />
              <StreaksPanel ctx={ctx} />
            </BentoGrid>
            <BentoGrid>
              <DailyHistogram ctx={ctx} />
              <BestWorstDays ctx={ctx} onPickDay={pickDay} />
            </BentoGrid>
          </Section>

          {data.role === "admin" && (
            <Section id="team" title={t("page.sections.team")} hint={t("page.teamHint")}>
              <BentoGrid>
                <CapitalPanel data={data} />
                <div className="lg:col-span-6">
                  <Panel title={t("traderView.title")} icon={CalendarDays} fill>
                    <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-muted-foreground">
                      <li>{t("traderView.item1")}</li>
                      <li>{t("traderView.item2")}</li>
                      <li>{t("traderView.item3")}</li>
                      <li>{t("traderView.item4")}</li>
                    </ul>
                  </Panel>
                </div>
              </BentoGrid>
              <TradersTable view={view} unit={unit} periodLabel={periodLabel} />
            </Section>
          )}
        </div>
      )}
    </Page>
  );
}
