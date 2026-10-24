// Dashboard = the trader's command screen, composed in labelled sections with one rhythm (owner, 2026-10-25: «всё
// вразнобой … скомпонуй»). Top to bottom:
//   «Сегодня»      — the hero strip: greeting + date, «Мои / Команда», four equal cells (today net · week net · left to
//                    the daily stop · NY market). Nothing else.
//   «План на день» — ONE card: the single next step (daily loop + «Что важно сейчас» ranked together, one primary
//                    button), a slot for one recommended action, the day frame (focus · contract · «Сегодня торгую», or
//                    the evening card), ≤ 3 more rows, and the one progress row (tier ladder, rewards, quests) in its
//                    footer — beside «Кривая капитала» (an empty week shows 30 days instead, with a note).
//   «Ваш edge»     — the insight bento, own trades («Мои») only: «Где уходят деньги» wide + the streak, then the compact
//                    tiles as equal cards (one quieter type scale: hero > section > tile).
//   «Сделки»       — open positions (only while a trade is open), recent trades + «Деск сегодня» (staff).
//   «Дополнительно» — opt-in extras (check-in, brief, sectors, macro, DNA, quote, psychology), off by default.
// Every card is the insight tile's glass shell (components/dashboard/dash-card). Trades arrive automatically, so there
// are no entry CTAs here.
import { lazy, Suspense, useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Page } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { i18nReady } from "@/i18n";
import { useAuth } from "@/contexts/auth-context";
import { nyDate } from "@/lib/trading-date";
import { useTodayHolidays } from "@/lib/market-intel";
import { normalizeResult } from "@/lib/trade-result";
import { useUnreadCount } from "@/components/notifications/use-notifications";
import { useHasRiskAccount } from "@/components/shell/use-shell-badges";
import { DashboardHeader } from "@/components/dashboard/today-hero";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { EquityPanel } from "@/components/dashboard/equity-panel";
import { RecentTradesPanel } from "@/components/dashboard/recent-trades-panel";
import { DeskTodayPanel } from "@/components/dashboard/team-heat-strip";
import { CustomizePopover } from "@/components/dashboard/customize-popover";
import { DashSection } from "@/components/dashboard/dash-card";
import { DayLine, DayProgress } from "@/components/daily/day-line";
import { useDailyNextStep } from "@/components/daily/next-step-card";
import { QuestStrip } from "@/components/quests/quest-strip";
import { FirstSteps } from "@/components/onboarding/first-steps";
import { WrappedDashLine } from "@/components/wrapped/WrappedLaunch";
import { dayView } from "@/components/daily/daily-model";
import { useDailyMe } from "@/components/daily/use-daily";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import {
  EXTRA_WIDTH,
  SECTION_META,
  useDashboardEquity,
  useDashboardToday,
  useEodDay,
  useEodStatus,
  useEventsToday,
  useRecentTrades,
  useRiskDesk,
  useRiskMe,
  type EquityPeriod,
  type SectionId,
} from "@/components/dashboard/use-dashboard";
import { useDashboardPrefs } from "@/components/dashboard/dashboard-prefs";
import { InsightBento, TILE_SIZE, type TileId } from "@/components/insight-tiles/bento";
import type { InsightScope } from "@/components/insight-tiles/nav";
import { periodRanges, periodTexts } from "@/components/stats/metrics";
import { useTradesWindow } from "@/hooks/use-trades-window";
// Every dashboard card is the insight tile's shell (components/dashboard/dash-card): its stylesheet comes with the page.
import "@/components/insight-tiles/insight-tiles.css";

// Opt-in extras (off by default, switched on in «Настроить») and the open-positions panel: own chunks, so the first screen and every other page
// don't download them. Resolved after i18nReady() like route chunks (no flash of RU with EN/UZ).
function extra<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(() => load().then(async (C) => { await i18nReady(); return { default: C }; }));
}
const SectorRadar = extra(() => import("@/components/sector-radar").then((m) => m.SectorRadar));
const MarketDnaWidget = extra(() => import("@/components/market-dna-widget").then((m) => m.MarketDnaWidget));
const UpcomingEventsList = extra(() => import("@/components/holiday-badge").then((m) => m.UpcomingEventsList));
const MarketOpenBrief = extra(() => import("@/components/market-open-brief").then((m) => m.MarketOpenBrief));
const MorningCheckin = extra(() => import("@/components/morning-checkin").then((m) => m.MorningCheckin));
const WeeklyPsychologyReport = extra(() => import("@/components/weekly-psychology-report").then((m) => m.WeeklyPsychologyReport));
const DailyQuoteCard = extra(() => import("@/components/daily-quote-card").then((m) => m.DailyQuoteCard));
// Open positions show only while a trade is open; the panel brings the trades dictionary (horizon labels) with it.
const PositionsPanel = extra(() => import("@/components/dashboard/positions-panel").then((m) => m.PositionsPanel));

const ExtraFallback = () => <Skeleton className="h-40 w-full rounded-[1.75rem]" />;
const lazyExtra = (node: ReactNode) => <Suspense fallback={<ExtraFallback />}>{node}</Suspense>;

const RITUAL_ANCHOR = "dash-ritual";
const CLOSE_MIN = 16 * 60;
const OPEN_MIN = 9 * 60 + 30;
/** «Ваш edge»: the primary tiles (wide / streak / weekdays) lead, the compact ones follow as one row of equal cards. */
const isLeadTile = (id: TileId) => TILE_SIZE[id] !== "third";

const SPAN: Record<number, string> = { 5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 12: "lg:col-span-12" };

type Cell = { id: SectionId; node: ReactNode; span: number };

/** Two neighbouring half extras share a row (7/5, 5/7 or 6/6); a full one takes the row. */
function extraRows(blocks: { id: SectionId; node: ReactNode }[]): Cell[][] {
  const rows: Cell[][] = [];
  const pairable = (id: SectionId | undefined) => !!id && EXTRA_WIDTH[id] !== "full";
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    if (pairable(a.id) && b && pairable(b.id)) {
      const wa = EXTRA_WIDTH[a.id];
      const spanA = wa === EXTRA_WIDTH[b.id] ? 6 : wa === "wide" ? 7 : 5;
      rows.push([{ ...a, span: spanA }, { ...b, span: 12 - spanA }]);
      i++;
    } else {
      rows.push([{ ...a, span: 12 }]);
    }
  }
  return rows;
}

/** One row: a single block full width, two side by side from lg (equal heights). */
function Row({ cells }: { cells: Cell[] }) {
  if (cells.length === 1) return <div className="min-w-0">{cells[0].node}</div>;
  return (
    <div className="grid grid-cols-1 items-stretch gap-[var(--grid-gap)] lg:grid-cols-12">
      {cells.map((c) => (
        <div key={c.id} className={`min-w-0 ${SPAN[c.span]}`}>{c.node}</div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { t } = dashboardI18n.useT();
  const { user, isCurator } = useAuth();
  const isGuest = !user || user.role === "guest";
  const userName = user?.traderName ?? null;
  const staff = isCurator;
  const authed = !isGuest;

  // Staff = traders + extras (owner rule 2026-10-21): everyone opens on «Мои» (own day frame, next step, quests,
  // check-in); staff always have the «Мои» / «Команда» toggle. A trader always sees their own desk.
  const { prefs, update, reset } = useDashboardPrefs("me", user ? `${user.role}:${userName ?? ""}` : null);
  const scope = staff ? prefs.scope : "me";
  const on = (id: SectionId) => authed && !prefs.hidden.includes(id) && (id !== "desk" || staff);

  // «Кривая капитала»: a week without closed trades shows 30 days instead of an empty card (with a note) — until the
  // viewer picks «1Н» by hand in this visit.
  const [weekPinned, setWeekPinned] = useState(false);
  const todayQ = useDashboardToday(scope, authed);
  const equityQ = useDashboardEquity(scope, prefs.period, on("equity"));
  const weekEmpty = prefs.period === "week" && !weekPinned && !!equityQ.data && !equityQ.isPlaceholderData && equityQ.data.totals.trades === 0;
  const widenedQ = useDashboardEquity(scope, "30d", on("equity") && weekEmpty);
  const widened = weekEmpty && !!widenedQ.data && widenedQ.data.totals.trades > 0;
  const onPeriodChange = (period: EquityPeriod) => {
    if (period === "week") setWeekPinned(true);
    update({ period });
  };
  const recentQ = useRecentTrades(scope, authed);
  // Staff without their own limits row have no risk account: no /api/risk/me polling for them.
  const riskAccount = useHasRiskAccount();
  const riskQ = useRiskMe(authed && !!userName && riskAccount.has);
  const deskQ = useRiskDesk(authed && staff);
  // Insight tiles: own trades of the /stats «90 дней» window (same query key → shared cache with /stats), then the 90
  // days before it for the trend chips (after the current window has arrived).
  const tileIds = prefs.order.filter((id): id is SectionId & TileId => SECTION_META[id].group === "edge" && on(id));
  const insightsOn = authed && scope === "me" && tileIds.length > 0;
  const insightRanges = useMemo(() => periodRanges("90d"), []);
  const insightWindow = insightRanges.cur;
  const insightTrader = staff ? userName : null;
  const insightQ = useTradesWindow({ from: insightWindow.from, to: insightWindow.to, trader: insightTrader }, { enabled: insightsOn });
  const insightPrevQ = useTradesWindow(
    { from: insightRanges.prev?.from ?? null, to: insightRanges.prev?.to ?? null, trader: insightTrader },
    { enabled: insightsOn && insightQ.isSuccess && !!insightRanges.prev },
  );
  const insightScope = useMemo<InsightScope>(
    () => ({ target: "stats", from: insightWindow.from, to: insightWindow.to, trader: insightTrader, statsPeriod: "90d", periodLong: periodTexts("90d", null).long }),
    [insightWindow, insightTrader],
  );
  const eodQ = useEodStatus(authed && scope === "team");
  const eventsQ = useEventsToday(on("attention"));
  const holidaysQ = useTodayHolidays();
  const unreadQ = useUnreadCount();

  const today = todayQ.data;
  const tradingDate = today?.date ?? nyDate();
  const afterClose = today ? today.market.nyMinutes >= CLOSE_MIN || today.market.weekend : false;

  // The most recent own trading day that can be closed: before today, or today once the session is over.
  const lastDay =
    scope === "me"
      ? ((recentQ.data ?? [])
          .filter((t) => normalizeResult(t.result) != null)
          .map((t) => t.closeDate.slice(0, 10))
          .find((d) => d < tradingDate || (d === tradingDate && afterClose)) ?? null)
      : null;
  const lastDayEodQ = useEodDay(lastDay, userName, authed && scope === "me" && on("attention"));
  // The day frame owns the last finished day's review; the journal stays the next step while still open.
  const dailyOn = authed && scope === "me";
  const dailyQ = useDailyMe(dailyOn);
  const dayCardDate = dayView(dailyQ.data)?.evening?.date ?? null;
  const lastDayRow = lastDayEodQ.data?.traders.find((x) => x.trader === userName);
  const journalOpenDate = lastDay && lastDayRow?.status === "open" && lastDayRow.trades > 0 ? lastDay : null;
  const daily = useDailyNextStep(dailyOn, journalOpenDate);
  // «План на день» counts tasks from all of these: render it once they have answered (no 2 → 3 jump).
  const attentionLoading = todayQ.isLoading || recentQ.isLoading || riskQ.isLoading || deskQ.isLoading || eodQ.isLoading
    || eventsQ.isLoading || holidaysQ.isLoading || unreadQ.isLoading || lastDayEodQ.isLoading || daily.isLoading;

  const goToCheckin = useCallback(() => {
    if (prefs.hidden.includes("checkin")) update({ hidden: prefs.hidden.filter((h) => h !== "checkin") });
    window.setTimeout(() => {
      const el = document.getElementById(RITUAL_ANCHOR);
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      el.focus({ preventScroll: true });
    }, 50);
  }, [prefs.hidden, update]);

  const extraNode = (id: SectionId): ReactNode => {
    switch (id) {
      case "checkin":
        return (
          <section id={RITUAL_ANCHOR} tabIndex={-1} aria-label={t("sections.checkin.label")} className="scroll-mt-24 outline-none">
            {lazyExtra(<MorningCheckin />)}
          </section>
        );
      case "brief": return lazyExtra(<MarketOpenBrief />);
      case "quote": return lazyExtra(<DailyQuoteCard />);
      case "sectors": return lazyExtra(<SectorRadar />);
      case "macro": return lazyExtra(<UpcomingEventsList />);
      case "dna": return lazyExtra(<MarketDnaWidget />);
      case "psychology": return lazyExtra(<WeeklyPsychologyReport />);
      default: return null;
    }
  };

  // ── «План на день» + «Кривая капитала» ──────────────────────────────────────
  const plan = on("attention") ? (
    <AttentionPanel
      fill
      data={today}
      risk={riskQ.data}
      desk={deskQ.data}
      eod={eodQ.data}
      lastDay={lastDay}
      lastDayEod={lastDayEodQ.data}
      recent={scope === "me" ? recentQ.data : undefined}
      events={eventsQ.data}
      marketEvents={holidaysQ.data?.today ?? []}
      unread={unreadQ.data}
      isLoading={attentionLoading}
      updatedAt={todayQ.dataUpdatedAt || undefined}
      onCheckin={goToCheckin}
      dayCardDate={dayCardDate}
      dailyStep={daily.step}
      dailyToday={daily.today}
      frame={dailyOn ? <DayLine enabled={dailyOn} journalOpenDate={journalOpenDate} embedded /> : null}
      progress={dailyOn ? <DayProgress enabled={dailyOn} quests={<QuestStrip enabled={dailyOn} />} /> : null}
    />
  ) : null;
  const shownEquity = widened ? widenedQ.data : equityQ.data;
  const equity = on("equity") ? (
    <EquityPanel
      fill
      data={weekEmpty && widenedQ.isLoading ? undefined : shownEquity}
      isLoading={equityQ.isLoading || (weekEmpty && widenedQ.isLoading)}
      isError={equityQ.isError}
      onRetry={() => equityQ.refetch()}
      period={widened ? "30d" : prefs.period}
      onPeriodChange={onPeriodChange}
      metric={prefs.metric}
      onMetricChange={(metric) => update({ metric })}
      note={widened ? t("equity.widened") : null}
    />
  ) : null;
  const dayCells: Cell[] = [
    ...(plan ? [{ id: "attention" as const, node: plan, span: equity ? 5 : 12 }] : []),
    ...(equity ? [{ id: "equity" as const, node: equity, span: plan ? 7 : 12 }] : []),
  ];

  // The morning check-in leads the extras before the open on a trading day and is gone on weekends / market holidays
  // (ILYA-20); before the open it sits right under the plan.
  const tradingDay = today ? !today.market.weekend && !today.market.holidayToday : true;
  const morning = !!today && tradingDay && today.market.nyMinutes < OPEN_MIN;
  const checkinNow = morning && on("checkin");

  // ── «Ваш edge» («Мои» only: a team-wide sequence mixes different people's trades; staff read one trader on /stats) ──
  const edgeOn = scope === "me" && tileIds.length > 0;
  const bento = (ids: TileId[], layout: "lead" | "row") =>
    ids.length > 0 ? (
      <InsightBento
        ids={ids}
        layout={layout}
        trades={insightQ.data}
        prev={insightPrevQ.isSuccess && !insightPrevQ.isPlaceholderData ? insightPrevQ.data : null}
        isLoading={insightQ.isLoading}
        scope={insightScope}
      />
    ) : null;

  // ── «Сделки» ──────────────────────────────────────────────────────────────
  const positions = on("positions") && today?.positions && today.positions.length > 0 ? lazyExtra(<PositionsPanel data={today} />) : null;
  const recent = on("recent") ? (
    <RecentTradesPanel fill trades={recentQ.data} isLoading={recentQ.isLoading} isError={recentQ.isError} onRetry={() => recentQ.refetch()} showTrader={scope === "team"} />
  ) : null;
  // Staff only; hidden when the risk desk is not deployed (null).
  const desk = on("desk") && deskQ.data !== null ? (
    <DeskTodayPanel fill data={deskQ.data} isLoading={deskQ.isLoading} isError={deskQ.isError} onRetry={() => void deskQ.refetch()} />
  ) : null;
  const tradeCells: Cell[] = [
    ...(recent ? [{ id: "recent" as const, node: recent, span: desk ? 7 : 12 }] : []),
    ...(desk ? [{ id: "desk" as const, node: desk, span: recent ? 5 : 12 }] : []),
  ];

  // ── «Дополнительно» ───────────────────────────────────────────────────────
  const extras = prefs.order
    .filter((id) => SECTION_META[id].extra && on(id) && (id !== "checkin" || (tradingDay && !checkinNow)))
    .map((id) => ({ id, node: extraNode(id) }))
    .filter((b) => b.node != null);

  const customize = authed ? (
    <CustomizePopover staff={staff} order={prefs.order} hidden={prefs.hidden} onChange={(patch) => update(patch)} onReset={reset} />
  ) : null;

  return (
    <Page className="dash-page">
      <DashSection id="dash-today" title={t("layout.today")} action={customize}>
        <DashboardHeader
          data={today}
          risk={riskQ.data}
          desk={deskQ.data}
          isLoading={todayQ.isLoading}
          isError={todayQ.isError}
          onRetry={() => todayQ.refetch()}
          guest={isGuest}
          scope={scope}
          onScopeChange={(s) => update({ scope: s, scopePicked: true })}
          canChooseScope={staff}
          userName={userName}
        />
        {authed && <FirstSteps />}
        {dailyOn && <WrappedDashLine />}
      </DashSection>

      {(dayCells.length > 0 || checkinNow) && (
        <DashSection id="dash-plan" title={t("layout.plan")}>
          {dayCells.length > 0 && <Row cells={dayCells} />}
          {checkinNow && extraNode("checkin")}
        </DashSection>
      )}

      {edgeOn && (
        <DashSection
          id="dash-edge"
          title={t("layout.edge")}
          hint={t("layout.edgeHint")}
          action={
            <Link href="/stats" className="inline-flex min-h-8 items-center gap-0.5 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("layout.edgeAll")}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        >
          {bento(tileIds.filter(isLeadTile), "lead")}
          {bento(tileIds.filter((id) => !isLeadTile(id)), "row")}
        </DashSection>
      )}

      {(positions || tradeCells.length > 0) && (
        <DashSection id="dash-trades" title={t("layout.trades")}>
          {positions}
          {tradeCells.length > 0 && <Row cells={tradeCells} />}
        </DashSection>
      )}

      {extras.length > 0 && (
        <DashSection id="dash-extras" title={t("layout.extras")} className="dash-extras">
          {extraRows(extras).map((cells) => <Row key={cells.map((c) => c.id).join("+")} cells={cells} />)}
        </DashSection>
      )}
    </Page>
  );
}
