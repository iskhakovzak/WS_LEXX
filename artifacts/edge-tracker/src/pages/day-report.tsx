/**
 * «Разбор дня» — автоматический детерминированный разбор одного торгового дня трейдера.
 * Route: /day-report?date=YYYY-MM-DD&trader= · nav group «Разбор».
 * Data: GET /api/day-report (net $, NY trading date, ET times from executions). Print-friendly (A4).
 */
import * as React from "react";
import { Link } from "wouter";
import { CalendarSearch, ChevronLeft, ChevronRight, Crown, FileText, Lock, Printer } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { DayStepper } from "@/components/shared/day-stepper";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { useAuth } from "@/contexts/auth-context";
import {
  fmtDayLong, fmtDayShort, isTradingDay, isYmd, lastTradingDay, shiftTradingDay, useDayReport, useMarketHolidays,
  type DayReport,
} from "@/components/day-report/api";
import { fmtDeskDateTime, fmtRate, fmtUsd } from "@/lib/format";
import { comparePersonNames, personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { dayReportI18n } from "@/i18n/ns/dayReport";
import { shellI18n } from "@/i18n/ns/shell";
import { topDayI18n } from "@/i18n/ns/topDay";
import { links } from "@/lib/links";
import {
  BreakdownPanel, ComparisonPanel, EquityPanel, LeaksPanel, LinksPanel, PlanPanel, StrengthsPanel, SummaryBento, TimelinePanel,
} from "@/components/day-report/sections";
import { PersonSelect } from "@/components/people/person-select";
import { useTradesBookFacets } from "@/hooks/use-trades-window";
import { nyDate } from "@/lib/trading-date";
import { defaultReportDay } from "@/components/journal/default-day";
import { DeskDayChips } from "@/components/shared/desk-day-link";
import { TickerContextList } from "@/components/shared/finviz/ticker-context";
import { useFacetView } from "@/components/shared/trade-facets/api";
import { ImxLine, ImxToggle } from "@/components/shared/trade-facets/FacetSummary";
import { useAssistantContext } from "@/components/shared/ask-assistant";
import { AiReviewCard } from "@/components/shared/ai-review-card";

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm 10mm 12mm; }
  html, body { background: #fff !important; color: #111 !important; }
  body * { box-shadow: none !important; text-shadow: none !important; backdrop-filter: none !important; }
  header, nav, aside, [data-print-hide], [data-sonner-toaster], [role="dialog"] { display: none !important; }
  main { padding: 0 !important; margin: 0 !important; max-width: none !important; overflow: visible !important; }
  [data-day-report] { gap: 8px !important; }
  [data-day-report] .glass-panel, [data-day-report] .glass-field { background: #fff !important; border: 1px solid #ddd !important; border-radius: 8px !important; break-inside: avoid; page-break-inside: avoid; }
  [data-day-report] .text-muted-foreground { color: #555 !important; }
  [data-day-report] .text-foreground { color: #111 !important; }
  [data-day-report] .text-up { color: #0a7a3d !important; }
  [data-day-report] .text-down { color: #b42318 !important; }
  [data-day-report] a { color: inherit !important; text-decoration: none !important; }
  [data-day-report] button { display: none !important; }
  [data-day-report] [data-print-title] { display: block !important; }
  [data-day-report] [role="region"] { max-height: none !important; overflow: visible !important; }
  [data-day-report] thead th { position: static !important; background: #f4f4f4 !important; color: #333 !important; }
  [data-day-report] .h-56 { height: 170px !important; }
}
`;

function readParams(): { trader: string | null; date: string | null } {
  const p = new URLSearchParams(window.location.search);
  const date = p.get("date");
  return { trader: p.get("trader"), date: isYmd(date) ? date : null };
}

function writeParams(trader: string | null, date: string) {
  const p = new URLSearchParams(window.location.search);
  if (trader) p.set("trader", trader); else p.delete("trader");
  p.set("date", date);
  window.history.replaceState({}, "", `${window.location.pathname}?${p.toString()}`);
}

const TRADER_KEY = "dayReport.trader";
function readStoredTrader(): string | null {
  try { return localStorage.getItem(TRADER_KEY) || null; } catch { return null; }
}
function storeTrader(name: string) {
  try { localStorage.setItem(TRADER_KEY, name); } catch { /* storage unavailable */ }
}

export default function DayReportPage() {
  const { user, isCurator, dbUsers } = useAuth();
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  const initial = React.useMemo(readParams, []);
  const [date, setDate] = React.useState<string>(initial.date ?? lastTradingDay(undefined));
  const holidays = useMarketHolidays(date).data;
  // Staff: an explicit ?trader= wins, then the trader picked last time on this device.
  const [trader, setTrader] = React.useState<string | null>(initial.trader && isCurator ? initial.trader : isCurator ? (readStoredTrader() ?? me) : me);

  React.useEffect(() => {
    if (!trader && me) setTrader(me);
  }, [trader, me]);
  React.useEffect(() => { if (isCurator && trader) storeTrader(trader); }, [isCurator, trader]);
  // A curator who does not trade would land on an always-empty own report: open the first trader instead.
  React.useEffect(() => {
    if (!isCurator || initial.trader || trader !== me || !dbUsers.length) return;
    if (dbUsers.some((u) => u.name === me && u.role === "trader")) return;
    const first = dbUsers.filter((u) => u.active && !u.banned && u.role === "trader").sort((a, b) => a.name.localeCompare(b.name, "ru"))[0];
    if (first) setTrader(first.name);
  }, [isCurator, initial.trader, trader, me, dbUsers]);

  // No explicit ?date= and today turned out to be a holiday → step back once holidays load.
  React.useEffect(() => {
    if (!initial.date && holidays && !isTradingDay(date, holidays)) setDate(lastTradingDay(holidays));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidays]);

  // Item 1.4: no ?date= → the last day with trades (never an empty today mid-session); once, a pick by hand wins.
  const autoDate = React.useRef(!initial.date);
  const facets = useTradesBookFacets({ trader: isCurator ? trader : null, enabled: autoDate.current && !!trader });
  React.useEffect(() => {
    if (!autoDate.current || facets.isLoading || !trader) return;
    autoDate.current = false;
    const d = defaultReportDay(nyDate(), facets.data?.lastDate ?? null);
    if (isYmd(d)) setDate(d);
  }, [facets.isLoading, facets.data, trader]);

  React.useEffect(() => {
    if (date) writeParams(isCurator ? trader : null, date);
  }, [trader, date, isCurator]);

  const FV = useFacetView(); // «Исключить IMX» — the same saved switch as /trades and /stats
  const q = useDayReport(isCurator ? trader : null, date, !!me, FV.view.excludeImx);
  const doc = q.data;
  // The API's `today` is the NY calendar date: on a weekend / holiday step back to the last trading day,
  // otherwise «Последний торговый день» jumped to an empty Saturday.
  const today = doc?.today && isTradingDay(doc.today, holidays) ? doc.today : doc?.today ? shiftTradingDay(doc.today, -1, holidays) : lastTradingDay(holidays);

  const go = React.useCallback((d: string) => { if (isYmd(d)) { autoDate.current = false; setDate(d); } }, []);

  const traders = React.useMemo(() => {
    const list = [...(doc?.traders ?? [])];
    if (trader && !list.includes(trader)) list.push(trader);
    return list.sort(comparePersonNames);
  }, [doc?.traders, trader]);

  const nonTrading = holidays ? !isTradingDay(date, holidays) : false;
  const t = dayReportI18n.t;

  useAssistantContext({ date, ...(trader ? { trader } : {}) });
  const header = (
    <PageHeader
      title={shellI18n.t("nav.dayReport")}
      description={t("page.desc", { trader: personName(trader) || "—", date: fmtDayLong(date) })}
      icon={FileText}
      meta={doc?.imx?.count ? <ImxLine total={doc.summary.net} imx={doc.imx} excluded={doc.imx.excluded} /> : undefined}
      actions={
        <div className="flex flex-wrap items-center gap-2" data-print-hide>
          <ImxToggle value={FV.view.excludeImx} onChange={(v) => FV.update((cur) => ({ ...cur, excludeImx: v }))} />
          {isCurator && (
            <PersonSelect value={trader ?? ""} onValueChange={(v) => setTrader(v)} options={traders} self={me} className="w-44" ariaLabel={commonI18n.t("fields.trader")} />
          )}
          <Button type="button" variant="outline" size="sm" disabled={!doc} onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" /> {t("page.print")}
          </Button>
        </div>
      }
    >
      <DayStepper
        value={date}
        onChange={go}
        max={today}
        home={today}
        homeLabel={commonI18n.t("dayStepper.lastDay")}
        homeTitle={commonI18n.t("dayStepper.lastDayKey")}
        arrows
        className="print:hidden"
      >
        {nonTrading && <Pill tone="warn">{t("page.nonTrading")}</Pill>}
        {!nonTrading && (
          <Link href={links.topDay(date)} data-slot="button" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:bg-primary/10">
            <Crown className="h-4 w-4" aria-hidden="true" /> {topDayI18n.t("link")}
          </Link>
        )}
        {q.isFetching && <span className="text-xs text-muted-foreground" aria-live="polite">{t("page.refreshing")}</span>}
      </DayStepper>
    </PageHeader>
  );

  if (!me) {
    return (
      <Page>
        {header}
        <Panel><EmptyState icon={Lock} title={t("page.guestTitle")} description={t("page.guestDesc")} /></Panel>
      </Page>
    );
  }

  return (
    <Page className="print:gap-2">
      <style>{PRINT_CSS}</style>
      {header}
      {q.isError ? (
        <Panel><QueryError error={q.error} onRetry={() => q.refetch()} /></Panel>
      ) : !doc ? (
        <ReportSkeleton />
      ) : doc.summary.trades === 0 ? (
        <EmptyDay doc={doc} onGo={go} />
      ) : (
        <Report doc={doc} stale={q.isPlaceholderData} />
      )}
    </Page>
  );
}

function headline(doc: DayReport): string {
  const s = doc.summary;
  const t = dayReportI18n.t;
  const parts = [
    commonI18n.t("units.trades", { count: s.trades }),
    t("page.net", { amount: fmtUsd(s.net, { signed: true }) }),
    doc.leaks.length ? t("page.leaks", { count: doc.leaks.length, amount: fmtUsd(-doc.leaksTotalUsd) }) : t("page.noLeaks"),
  ];
  if (doc.comparison.betterThanPct != null) parts.push(t("page.betterThan", { pct: fmtRate(doc.comparison.betterThanPct), days: doc.comparison.days }));
  return parts.join(" · ");
}

function Report({ doc, stale }: { doc: DayReport; stale: boolean }) {
  const { t } = dayReportI18n.useT();
  // AI day review (the assistant's budget): for whoever may use the assistant.
  const canAi = useAuth().can("assistant.use");
  return (
    <div data-day-report className={stale ? "flex flex-col gap-4 opacity-70 transition-opacity sm:gap-5" : "flex flex-col gap-4 transition-opacity sm:gap-5"}>
      <p data-print-title className="hidden text-lg font-semibold">{t("page.printTitle", { trader: personName(doc.trader), date: fmtDayLong(doc.date) })}</p>
      <section aria-label={t("page.summaryAria")} className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{headline(doc)}</p>
        <SummaryBento doc={doc} />
      </section>
      {canAi ? <AiReviewCard subject={{ kind: "day", date: doc.date, trader: doc.trader }} /> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><EquityPanel doc={doc} /></div>
        <ComparisonPanel doc={doc} />
      </div>
      <TimelinePanel doc={doc} />
      <DeskDayChips tickers={doc.timeline.map((r) => r.ticker)} date={doc.date} trader={doc.trader} className="-mt-1 px-1" />
      <TickerContextList tickers={doc.timeline.map((r) => r.ticker)} day={doc.date} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <LeaksPanel doc={doc} />
        <PlanPanel doc={doc} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><BreakdownPanel doc={doc} /></div>
        <StrengthsPanel doc={doc} />
      </div>
      <LinksPanel doc={doc} />
      <p className="text-2xs text-muted-foreground">
        {t("page.footnote", { days: doc.comparison.days || 20, date: fmtDeskDateTime(doc.generatedAt, { style: "shortDateTime" }) })}
      </p>
    </div>
  );
}

function EmptyDay({ doc, onGo }: { doc: DayReport; onGo: (d: string) => void }) {
  const { prevTradeDate, nextTradeDate } = doc.nav;
  const { t } = dayReportI18n.useT();
  return (
    <Panel>
      <EmptyState
        icon={CalendarSearch}
        title={t("page.emptyTitle")}
        description={prevTradeDate || nextTradeDate ? t("page.emptyNearby") : t("page.emptyNone")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {prevTradeDate && <Button type="button" variant="outline" onClick={() => onGo(prevTradeDate)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /> {fmtDayShort(prevTradeDate)}</Button>}
            {nextTradeDate && <Button type="button" variant="outline" onClick={() => onGo(nextTradeDate)}>{fmtDayShort(nextTradeDate)} <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>}
          </div>
        }
      />
    </Panel>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={dayReportI18n.t("page.loadingAria")}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
