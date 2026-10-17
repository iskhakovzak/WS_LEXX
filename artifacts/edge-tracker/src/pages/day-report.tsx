/**
 * «Разбор дня» — автоматический детерминированный разбор одного торгового дня трейдера.
 * Route: /day-report?date=YYYY-MM-DD&trader= · nav group «Разбор».
 * Data: GET /api/day-report (net $, NY trading date, ET times from executions). Print-friendly (A4).
 */
import * as React from "react";
import { CalendarSearch, ChevronLeft, ChevronRight, ClipboardList, Lock, Printer } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/query-error";
import { useAuth } from "@/contexts/auth-context";
import {
  fmtDayLong, fmtDayShort, fmtUsd, isTradingDay, isYmd, lastTradingDay, pluralTrades, shiftTradingDay, useDayReport, useMarketHolidays,
  type DayReport,
} from "@/components/day-report/api";
import {
  BreakdownPanel, ComparisonPanel, EquityPanel, LeaksPanel, LinksPanel, PlanPanel, StrengthsPanel, SummaryBento, TimelinePanel,
} from "@/components/day-report/sections";
import { PersonSelect } from "@/components/people/person-select";

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

  React.useEffect(() => {
    if (date) writeParams(isCurator ? trader : null, date);
  }, [trader, date, isCurator]);

  const q = useDayReport(isCurator ? trader : null, date, !!me);
  const doc = q.data;
  // The API's `today` is the NY calendar date: on a weekend / holiday step back to the last trading day,
  // otherwise «Последний торговый день» jumped to an empty Saturday.
  const today = doc?.today && isTradingDay(doc.today, holidays) ? doc.today : doc?.today ? shiftTradingDay(doc.today, -1, holidays) : lastTradingDay(holidays);
  const nextDay = shiftTradingDay(date, 1, holidays);
  const canNext = nextDay <= today;

  const go = React.useCallback((d: string) => { if (isYmd(d)) setDate(d); }, []);

  // ← / → between trading days (ignored while typing in a field).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setDate((d) => shiftTradingDay(d, -1, holidays)); }
      if (e.key === "ArrowRight" && canNext) { e.preventDefault(); setDate((d) => shiftTradingDay(d, 1, holidays)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [holidays, canNext]);

  const traders = React.useMemo(() => {
    const list = [...(doc?.traders ?? [])];
    if (trader && !list.includes(trader)) list.push(trader);
    return list.sort((a, b) => a.localeCompare(b, "ru"));
  }, [doc?.traders, trader]);

  const nonTrading = holidays ? !isTradingDay(date, holidays) : false;

  const header = (
    <PageHeader
      title="Разбор дня"
      description={`${trader ?? "—"} · ${fmtDayLong(date)} · деньги нетто, время ET`}
      icon={ClipboardList}
      actions={
        <div className="flex flex-wrap items-center gap-2" data-print-hide>
          {isCurator && (
            <PersonSelect value={trader ?? ""} onValueChange={(v) => setTrader(v)} options={traders} self={me} className="w-44" ariaLabel="Трейдер" />
          )}
          <Button type="button" variant="outline" size="sm" disabled={!doc} onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" /> Печать / PDF
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        <Button type="button" variant="outline" size="icon" aria-label="Предыдущий торговый день (←)" onClick={() => go(shiftTradingDay(date, -1, holidays))}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Input
          type="date"
          aria-label="Дата"
          value={date}
          max={today}
          onChange={(e) => go(e.target.value)}
          className="h-9 w-[11.5rem] rounded-full tabular-nums"
        />
        <Button type="button" variant="outline" size="icon" aria-label="Следующий торговый день (→)" disabled={!canNext} onClick={() => go(nextDay)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        {date !== today && <Button type="button" variant="ghost" size="sm" onClick={() => go(today)}>Последний торговый день</Button>}
        {nonTrading && <Pill tone="warn">выходной / праздник — биржа закрыта</Pill>}
        {q.isFetching && <span className="text-xs text-muted-foreground" aria-live="polite">обновление…</span>}
      </div>
    </PageHeader>
  );

  if (!me) {
    return (
      <Page>
        {header}
        <Panel><EmptyState icon={Lock} title="Разбор дня доступен после входа" description="Гостевой режим не видит сделки трейдеров. Войдите как трейдер или куратор." /></Panel>
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
  const parts = [
    `${s.trades} ${pluralTrades(s.trades)}`,
    `нетто ${fmtUsd(s.net, true)}`,
    doc.leaks.length ? `${doc.leaks.length} утеч. ≈ ${fmtUsd(-doc.leaksTotalUsd)}` : "без утечек по правилам",
  ];
  if (doc.comparison.betterThanPct != null) parts.push(`лучше ${Math.round(doc.comparison.betterThanPct * 100)}% из ${doc.comparison.days} дней`);
  return parts.join(" · ");
}

function Report({ doc, stale }: { doc: DayReport; stale: boolean }) {
  return (
    <div data-day-report className={stale ? "flex flex-col gap-4 opacity-70 transition-opacity sm:gap-5" : "flex flex-col gap-4 transition-opacity sm:gap-5"}>
      <p data-print-title className="hidden text-lg font-semibold">Разбор дня — {doc.trader} · {fmtDayLong(doc.date)}</p>
      <section aria-label="Итоги дня" className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{headline(doc)}</p>
        <SummaryBento doc={doc} />
      </section>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><EquityPanel doc={doc} /></div>
        <ComparisonPanel doc={doc} />
      </div>
      <TimelinePanel doc={doc} />
      <div className="grid gap-4 xl:grid-cols-2">
        <LeaksPanel doc={doc} />
        <PlanPanel doc={doc} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><BreakdownPanel doc={doc} /></div>
        <StrengthsPanel doc={doc} />
      </div>
      <LinksPanel doc={doc} />
      <p className="text-2xs text-muted-foreground">
        Нетто = брутто − |комиссии|. День = дата закрытия по Нью-Йорку. Время входа/выхода — по исполнениям брокера.
        Сравнение — последние {doc.comparison.days || 20} торговых дней со сделками. Сформировано {new Date(doc.generatedAt).toLocaleString("ru-RU")}.
      </p>
    </div>
  );
}

function EmptyDay({ doc, onGo }: { doc: DayReport; onGo: (d: string) => void }) {
  const { prevTradeDate, nextTradeDate } = doc.nav;
  return (
    <Panel>
      <EmptyState
        icon={CalendarSearch}
        title="В этот день сделок не было"
        description={prevTradeDate || nextTradeDate ? "Ближайшие дни со сделками:" : "У трейдера пока нет сделок в журнале."}
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
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Загрузка разбора дня">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
