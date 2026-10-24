/**
 * «Отчёт недели» — one weekly report, three audiences (same data, different emphasis):
 *  · Трейдеру   — results vs the previous 4 weeks, three $-tips, what went well, goal for next week;
 *  · Куратору   — plus the rules checklist, desk median, days without review, risk, feedback + grade;
 *  · Партнёрам  — desk executive summary (staff only), print / PDF friendly.
 * Route: /weekly-review?view=trader|curator|partners&trader=&week=YYYY-Www. Week = Mon–Fri, NY dates.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, CalendarRange, ChevronLeft, ChevronRight, ClipboardCopy, FileText, GraduationCap, Lock, Printer, UserRound } from "lucide-react";
import { EmptyState, ErrorState, Page, PageHeader, Panel, PanelSkeleton, Pill, SectionTabs, StatGridSkeleton } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { currentWeekKey, fmtDay, isWeekKey, nextWard, reviewToText, shiftWeek, useWeeklyOverview, useWeeklyReview, weekLabel } from "@/components/weekly-review/api";
import { reviewLastWeek } from "@/components/journal/default-day";
import { nyDate } from "@/lib/trading-date";
import { http } from "@/lib/api/http";
import { ReviewStatusPill } from "@/components/weekly-review/collab";
import { CuratorView, TraderView } from "@/components/weekly-review/audience-views";
import { PartnersView } from "@/components/weekly-review/partners-view";
import { AiReviewCard } from "@/components/shared/ai-review-card";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { WrappedButton } from "@/components/wrapped/WrappedLaunch";
import { useTradesBookFacets } from "@/hooks/use-trades-window";
import { weeklyI18n } from "@/i18n/ns/weeklyReview";
import { shellI18n } from "@/i18n/ns/shell";
import { personName } from "@/i18n";

type View = "trader" | "curator" | "partners";
const VIEWS: View[] = ["trader", "curator", "partners"];

/**
 * Print / PDF: drop the app shell (sidebar, header, tabs, buttons), let the page flow past the
 * viewport-height scroller, and switch the colour tokens to the light palette on white paper.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm 12mm 14mm; }
  html {
    color-scheme: light;
    --background: 0 0% 100% !important; --foreground: 240 3% 14% !important; --card: 0 0% 100% !important;
    --muted-foreground: 220 9% 30% !important; --border: 225 10% 85% !important; --surface-solid: 0 0% 100% !important;
    --primary: 211 100% 42% !important; --up: 152 60% 30% !important; --down: 0 62% 47% !important; --warn: 32 95% 32% !important;
    --glass-bg: transparent !important; --glass-border: hsl(225 10% 85%) !important; --glass-sheen: transparent !important;
    --glass-hi: transparent !important; --glass-lo: transparent !important; --glass-shadow-sm: none !important;
    --tile-bg: transparent !important; --tile-border: hsl(225 10% 85%) !important;
  }
  html, body { background: hsl(var(--background)) !important; color: hsl(var(--foreground)) !important; }
  body * { box-shadow: none !important; text-shadow: none !important; backdrop-filter: none !important; animation: none !important; transition: none !important; }
  .h-svh, .h-screen { height: auto !important; }
  .overflow-hidden, .overflow-auto, #main-content { overflow: visible !important; }
  #main-content { height: auto !important; }
  header, nav, aside, [data-sidebar], [data-variant][data-side], [data-print-hide], [data-sonner-toaster], [role="dialog"], [role="tablist"] { display: none !important; }
  main { padding: 0 !important; margin: 0 !important; max-width: none !important; }
  [data-weekly-report] [data-print-title] { display: block !important; }
  [data-weekly-report] .glass-panel, [data-weekly-report] .tile { break-inside: avoid; page-break-inside: avoid; }
  [data-weekly-report] a { color: inherit !important; text-decoration: none !important; }
  [data-weekly-report] button:not([data-print-keep]) { pointer-events: none; }
  [data-weekly-report] textarea, [data-weekly-report] input { border: 1px solid hsl(var(--border)) !important; background: transparent !important; }
}
`;

function readParams(): { trader: string | null; week: string | null; view: View | null } {
  const p = new URLSearchParams(window.location.search);
  const week = p.get("week");
  const view = p.get("view") as View | null;
  return { trader: p.get("trader"), week: isWeekKey(week) ? week : null, view: view && VIEWS.includes(view) ? view : null };
}

function writeParams(view: View | null, trader: string | null, week: string) {
  const p = new URLSearchParams(window.location.search);
  if (view) p.set("view", view); else p.delete("view");
  if (trader && view !== "partners") p.set("trader", trader); else p.delete("trader");
  if (week && week !== currentWeekKey()) p.set("week", week); else p.delete("week");
  const qs = p.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

const TAB_ICONS = { trader: UserRound, curator: GraduationCap, partners: Briefcase } as const;

export default function WeeklyReviewPage() {
  const { t } = weeklyI18n.useT();
  const tabs = VIEWS.map((v) => ({ value: v, label: t(`page.tabs.${v}`), icon: TAB_ICONS[v] }));
  const { user, isCurator, can, dbUsers } = useAuth();
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  const staff = isCurator || can("journal.review");
  const initial = React.useMemo(readParams, []);
  // Item 1.4: Monday–Wednesday the week to assess is the previous one (this one is nearly empty).
  const [week, setWeek] = React.useState<string>(() => initial.week ?? (reviewLastWeek(nyDate()) ? shiftWeek(currentWeekKey(), -1) : currentWeekKey()));
  const [trader, setTrader] = React.useState<string | null>(initial.trader && staff ? initial.trader : me);
  const [view, setView] = React.useState<View>(
    // A link that names a trader (chart click-through, day report) opens that trader's week, not the desk. Staff are
    // traders too (owner rule 2026-10-21): with no link they open their OWN «Трейдер» week; «Партнёрам» is a tab.
    !staff ? "trader" : initial.view ?? (initial.trader ? (initial.trader !== me ? "curator" : "trader") : me ? "trader" : "partners"),
  );
  const effectiveView: View = staff ? view : "trader";

  React.useEffect(() => {
    if (!trader && me) setTrader(me);
  }, [trader, me]);

  React.useEffect(() => {
    writeParams(staff ? effectiveView : null, staff ? trader : null, week);
  }, [staff, effectiveView, trader, week]);

  const q = useWeeklyReview(trader, week, !!trader && effectiveView !== "partners");
  const doc = q.data;
  const today = currentWeekKey();
  const isFuture = week >= today;

  // The picker: everyone with trades in the viewer's scope (traders, curators, admins) plus active traders without
  // trades yet (a week to review), the own week first.
  const pickerFacets = useTradesBookFacets({ enabled: staff });
  const pickerNames = React.useMemo(
    () => [...(pickerFacets.data?.traders ?? []), ...dbUsers.filter((u) => u.active && !u.banned && u.role === "trader").map((u) => u.name)],
    [pickerFacets.data, dbUsers],
  );

  const copy = async (md: boolean) => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(reviewToText(doc, md));
      toast({ title: md ? t("page.copiedMd") : t("page.copiedText"), description: `${weekLabel(doc.week.key)} · ${personName(doc.trader)}` });
    } catch {
      toast({ title: t("page.copyFailed"), description: t("page.copyFailedDesc"), variant: "destructive" });
    }
  };

  const openTrader = (name: string) => { setTrader(name); setView("curator"); };
  // «Сохранить и следующий» (OLGA-11): my wards in name order, the next one after this trader whose week is not reviewed.
  const wardsQ = useQuery({
    queryKey: ["curator", "wards"],
    queryFn: ({ signal }) => http.get<{ wards: string[] }>("/api/curator/wards", { signal }).then((r) => r.wards).catch(() => null),
    enabled: staff && effectiveView === "curator",
    staleTime: 5 * 60_000,
    retry: false,
  });
  const overviewQ = useWeeklyOverview(week, staff && effectiveView === "curator" && !!wardsQ.data?.length);
  const next = React.useMemo(() => {
    const wards = wardsQ.data;
    if (!wards?.length || !trader) return null;
    const reviewed = new Set((overviewQ.data?.traders ?? []).filter((x) => x.status === "reviewed").map((x) => x.trader));
    const name = nextWard(wards, trader, reviewed);
    return name ? { name, open: () => setTrader(name) } : null;
  }, [wardsQ.data, overviewQ.data, trader]);
  const perTrader = effectiveView !== "partners";

  const weekNav = (
    // Phones: the week label shrinks and «К текущей» wraps instead of running off the right edge.
    <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto" data-print-hide>
      <Button type="button" variant="outline" size="icon" aria-label={t("page.prevWeek")} title={t("page.prevWeek")} onClick={() => setWeek(shiftWeek(week, -1))}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="glass-field inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 px-3 text-sm font-medium tabular-nums sm:min-w-[13rem] sm:flex-none">
        <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {weekLabel(week)}
        {week === today && <Pill tone="accent">{t("page.current")}</Pill>}
      </span>
      <Button type="button" variant="outline" size="icon" aria-label={t("page.nextWeek")} title={t("page.nextWeek")} disabled={isFuture} onClick={() => setWeek(shiftWeek(week, 1))}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      {week !== today && <Button type="button" variant="ghost" size="sm" onClick={() => setWeek(today)}>{t("page.toCurrent")}</Button>}
    </div>
  );

  const description = !perTrader
    ? t("page.descDesk")
    : trader
      ? t("page.descTrader", { trader: personName(trader), range: doc ? `${fmtDay(doc.week.start)} — ${fmtDay(doc.week.end, true)}` : weekLabel(week) })
      : t("page.descDefault");

  const header = (
    <PageHeader
      title={shellI18n.t("nav.weeklyReview")}
      description={description}
      icon={FileText}
      actions={
        <div className="flex flex-wrap items-center gap-2" data-print-hide>
          {staff && perTrader && (
            <StaffTraderPicker
              value={trader ?? ""} onChange={(v) => setTrader(v)} me={me} names={pickerNames} team={false}
              className="w-auto min-w-[13rem] max-w-[18rem]" ariaLabel={t("page.traderAria")}
            />
          )}
          {perTrader && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={!doc}><ClipboardCopy className="h-4 w-4" aria-hidden="true" /> {t("page.copy")}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copy(false)}>{t("page.asText")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copy(true)}>{t("page.asMarkdown")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* «Итоги недели» story: own week only (a card carries the owner's result out of the desk); closed weeks only. */}
          {perTrader && me && trader === me && <WrappedButton week={week} />}
          <Button type="button" variant="outline" size="sm" disabled={perTrader && !doc} onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" /> {t("page.print")}
          </Button>
        </div>
      }
    >
      {staff && <SectionTabs ariaLabel={t("page.tabsAria")} tabs={tabs} value={effectiveView} onChange={setView} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {weekNav}
        {perTrader && doc && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-print-hide>
            <ReviewStatusPill status={doc.review?.status ?? "none"} />
            {doc.review?.reviewedAt && <span>{t("page.reviewedOn", { date: fmtDay(doc.review.reviewedAt.slice(0, 10)) })}</span>}
            {q.isFetching && <span aria-live="polite">{t("page.refreshing")}</span>}
          </div>
        )}
      </div>
    </PageHeader>
  );

  if (!me) {
    return (
      <Page>
        {header}
        <Panel><EmptyState icon={Lock} title={t("page.loginTitle")} description={t("page.loginDesc")} /></Panel>
      </Page>
    );
  }

  return (
    <Page>
      <style>{PRINT_CSS}</style>
      {header}
      <div data-weekly-report>
        {effectiveView === "partners" ? (
          <PartnersView week={week} onOpen={openTrader} />
        ) : q.isError ? (
          <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} inset /></Panel>
        ) : !doc ? (
          <ReportSkeleton />
        ) : (
          <div className={q.isPlaceholderData ? "opacity-70 transition-opacity duration-[var(--dur-2)]" : "transition-opacity duration-[var(--dur-2)]"}>
            <p data-print-title className="mb-3 hidden text-lg font-semibold">
              {t(effectiveView === "curator" ? "page.printTitleCurator" : "page.printTitle", { week: weekLabel(doc.week.key), trader: personName(doc.trader) })}
            </p>
            {/* The nightly AI week review (Fridays, when the desk turned it on); nothing shows until one exists. */}
            <AiReviewCard subject={{ kind: "week", date: doc.week.start, trader: doc.trader }} className="mb-[var(--grid-gap)]" />
            {effectiveView === "curator" ? <CuratorView key={`${doc.trader}:${doc.week.key}`} doc={doc} next={next} /> : <TraderView key={`${doc.trader}:${doc.week.key}`} doc={doc} />}
          </div>
        )}
      </div>
    </Page>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]" aria-busy="true" aria-label={weeklyI18n.t("page.loading")}>
      <StatGridSkeleton count={5} />
      <div className="grid gap-[var(--grid-gap)] lg:grid-cols-12">
        <PanelSkeleton height={260} className="lg:col-span-7" />
        <PanelSkeleton height={260} className="lg:col-span-5" />
      </div>
      <PanelSkeleton height={120} />
    </div>
  );
}
