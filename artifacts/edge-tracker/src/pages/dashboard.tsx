// Dashboard = the trader's command screen, composed in labelled sections (owner, 2026-10-25: «всё вразнобой …
// скомпонуй»), and customisable right on the page (the same day: remove, add back, move, resize — components/dashboard
// board). Top to bottom:
//   «Сегодня»      — the hero strip (fixed): greeting + date, «Мои / Команда», four equal cells. Nothing else.
//   «План на день» — the desk's market regime across (name, playbook hint, limit multiplier; staff confirm the
//                    system's suggestion), then the plan card (next step, a slot for one recommended action, the day frame, progress) beside
//                    «Кривая капитала» (an empty week shows 30 days instead, with a note); the morning check-in under
//                    them before the open.
//   «Ваш edge»     — the insight tiles, own trades («Мои») only; each tile has a compact / medium / large layout.
//   «Сделки»       — open positions (only while a trade is open), recent trades, «Деск сегодня» (staff).
//   «Дополнительно» — opt-in extras (check-in, brief, sectors, macro, DNA, quote, psychology).
// Which tiles, in which order and at which size: the viewer's layout (components/dashboard/layout-model, stored in the
// account). Every card is the insight tile's glass shell (components/dashboard/dash-card). Trades arrive automatically,
// so there are no entry CTAs here.
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
import { DashBoard, type BoardSectionDef, type BoardTileDef } from "@/components/dashboard/board";
import { TilePlaceholder } from "@/components/dashboard/board-section";
import { DashCard } from "@/components/dashboard/dash-card";
import { RegimeDayView } from "@/components/shared/regime/regime-day";
import { useDashboardLayout } from "@/components/dashboard/dashboard-layout";
import { addItem, TILE_SPECS, type BoardSection, type TileVariant } from "@/components/dashboard/layout-model";
import { DayLine, DayProgress } from "@/components/daily/day-line";
import { useDailyNextStep } from "@/components/daily/next-step-card";
import { QuestStrip } from "@/components/quests/quest-strip";
import { FirstSteps } from "@/components/onboarding/first-steps";
import { WrappedDashLine } from "@/components/wrapped/WrappedLaunch";
import { dayView } from "@/components/daily/daily-model";
import { useDailyMe } from "@/components/daily/use-daily";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import {
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
import { InsightTileCard, type TileId } from "@/components/insight-tiles/bento";
import type { InsightScope } from "@/components/insight-tiles/nav";
import { periodRanges, periodTexts } from "@/components/stats/metrics";
import { useTradesWindow } from "@/hooks/use-trades-window";
// Every dashboard card is the insight tile's shell (components/dashboard/dash-card): its stylesheet comes with the page.
import "@/components/insight-tiles/insight-tiles.css";

// Opt-in extras and the open-positions panel: own chunks, so the first screen and every other page don't download
// them. Resolved after i18nReady() like route chunks (no flash of RU with EN/UZ).
function extra<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(() => load().then(async (C) => { await i18nReady(); return { default: C }; }));
}
const SectorRadar = extra(() => import("@/components/sector-radar").then((m) => m.SectorRadar));
const MarketDnaWidget = extra(() => import("@/components/market-dna-widget").then((m) => m.MarketDnaWidget));
const UpcomingEventsList = extra(() => import("@/components/holiday-badge").then((m) => m.UpcomingEventsList));
const MarketOpenBrief = extra(() => import("@/components/market-open-brief").then((m) => m.MarketOpenBrief));
const MorningCheckin = extra(() => import("@/components/morning-checkin").then((m) => m.MorningCheckin));
const WeeklyPsychologyReport = extra(() => import("@/components/weekly-psychology-report").then((m) => m.WeeklyPsychologyReport));
// «Сегодняшний рынок → что это значит для вас» (analytics «Мой edge и рынок»): its own small chunk.
const TodayEdgeLine = extra(() => import("@/components/analytics-page/my-edge/TodayEdgeLine").then((m) => m.TodayEdgeLine));
const DailyQuoteCard = extra(() => import("@/components/daily-quote-card").then((m) => m.DailyQuoteCard));
const MentorLine = extra(() => import("@/components/mentor/mentor-line").then((m) => m.MentorLine));
// Open positions show only while a trade is open; the panel brings the trades dictionary (horizon labels) with it.
const PositionsPanel = extra(() => import("@/components/dashboard/positions-panel").then((m) => m.PositionsPanel));

const ExtraFallback = () => <Skeleton className="h-40 w-full rounded-[1.75rem]" />;
const lazyExtra = (node: ReactNode) => <Suspense fallback={<ExtraFallback />}>{node}</Suspense>;

const RITUAL_ANCHOR = "dash-ritual";
const CLOSE_MIN = 16 * 60;
const OPEN_MIN = 9 * 60 + 30;
const EDGE_TILES = new Set<SectionId>(["leaks", "streaks", "seqDay", "afterLoss", "holdTime", "fees", "weekdays"]);
const isEdge = (id: SectionId): id is SectionId & TileId => EDGE_TILES.has(id);

/** Everything the dashboard reads, gated by what the viewer's layout shows. */
function useDashboardModel(editing: boolean) {
  const { user, isCurator } = useAuth();
  const isGuest = !user || user.role === "guest";
  const userName = user?.traderName ?? null;
  const staff = isCurator;
  const authed = !isGuest;
  const viewer = user ? `${user.role}:${userName ?? ""}` : null;

  // Staff = traders + extras (owner rule 2026-10-21): everyone opens on «Мои»; staff always have «Мои» / «Команда».
  const { prefs, update } = useDashboardPrefs("me", viewer);
  const board = useDashboardLayout(viewer, authed);
  const scope = staff ? prefs.scope : "me";
  const allowed = useCallback((id: SectionId) => authed && (staff || !TILE_SPECS[id].staffOnly), [authed, staff]);
  const inScope = useCallback((id: SectionId) => scope === "me" || !TILE_SPECS[id].meOnly, [scope]);
  const on = (id: SectionId) => allowed(id) && inScope(id) && board.layout.items.some((it) => it.id === id);

  // «Кривая капитала»: a week without closed trades shows 30 days instead of an empty card (with a note) — until the
  // viewer picks «Неделя» by hand in this visit.
  const [weekPinned, setWeekPinned] = useState(false);
  const todayQ = useDashboardToday(scope, authed);
  const equityQ = useDashboardEquity(scope, prefs.period, on("equity"));
  const weekEmpty = prefs.period === "week" && !weekPinned && !!equityQ.data && !equityQ.isPlaceholderData && equityQ.data.totals.trades === 0;
  const widenedQ = useDashboardEquity(scope, "month", on("equity") && weekEmpty);
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
  // Insight tiles: own trades of the /stats «90 дней» window (shared cache with /stats), then the 90 days before it for
  // the trend chips. Also while editing (the gallery previews them).
  const edgeShown = board.layout.items.some((it) => isEdge(it.id));
  const insightsOn = authed && scope === "me" && (edgeShown || editing);
  const insightRanges = useMemo(() => periodRanges("quarter"), []);
  const insightWindow = insightRanges.cur;
  const insightTrader = staff ? userName : null;
  const insightQ = useTradesWindow({ from: insightWindow.from, to: insightWindow.to, trader: insightTrader }, { enabled: insightsOn });
  const insightPrevQ = useTradesWindow(
    { from: insightRanges.prev?.from ?? null, to: insightRanges.prev?.to ?? null, trader: insightTrader },
    { enabled: insightsOn && insightQ.isSuccess && !!insightRanges.prev },
  );
  const insightScope = useMemo<InsightScope>(
    () => ({ target: "stats", from: insightWindow.from, to: insightWindow.to, trader: insightTrader, statsPeriod: "quarter", periodLong: periodTexts("quarter", null).long }),
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
  // The morning check-in leads before the open on a trading day and is gone on weekends / market holidays (ILYA-20).
  const tradingDay = today ? !today.market.weekend && !today.market.holidayToday : true;
  const morning = !!today && tradingDay && today.market.nyMinutes < OPEN_MIN;

  return {
    isGuest, authed, staff, userName, scope, prefs, update, board, allowed, inScope, on, todayQ, equityQ, widenedQ, weekEmpty,
    widened, onPeriodChange, recentQ, riskQ, deskQ, insightQ, insightPrevQ, insightScope, eodQ, eventsQ, holidaysQ, unreadQ,
    lastDay, lastDayEodQ, dailyOn, dayCardDate, journalOpenDate, daily, attentionLoading, tradingDay, morning,
  };
}

export default function Dashboard() {
  const { t } = dashboardI18n.useT();
  const [editing, setEditing] = useState(false);
  const m = useDashboardModel(editing);
  const { scope, prefs, board, todayQ, equityQ, widenedQ, riskQ, deskQ, recentQ } = m;
  const today = todayQ.data;
  const checkinNow = m.morning && m.on("checkin");

  const goToCheckin = useCallback(() => {
    board.setLayout((cur) => addItem(cur, "checkin"));
    window.setTimeout(() => {
      const el = document.getElementById(RITUAL_ANCHOR);
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      el.focus({ preventScroll: true });
    }, 50);
  }, [board]);

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

  const plan = (
    <AttentionPanel
      fill
      data={today}
      risk={riskQ.data}
      desk={deskQ.data}
      eod={m.eodQ.data}
      lastDay={m.lastDay}
      lastDayEod={m.lastDayEodQ.data}
      recent={scope === "me" ? recentQ.data : undefined}
      events={m.eventsQ.data}
      marketEvents={m.holidaysQ.data?.today ?? []}
      unread={m.unreadQ.data}
      isLoading={m.attentionLoading}
      updatedAt={todayQ.dataUpdatedAt || undefined}
      onCheckin={goToCheckin}
      dayCardDate={m.dayCardDate}
      dailyStep={m.daily.step}
      dailyToday={m.daily.today}
      frame={m.dailyOn ? <DayLine enabled={m.dailyOn} journalOpenDate={m.journalOpenDate} embedded /> : null}
      progress={m.dailyOn ? <DayProgress enabled={m.dailyOn} quests={<QuestStrip enabled={m.dailyOn} />} /> : null}
    />
  );
  const shownEquity = m.widened ? widenedQ.data : equityQ.data;
  const equity = (v: TileVariant) => (
    <EquityPanel
      fill
      density={v}
      data={m.weekEmpty && widenedQ.isLoading ? undefined : shownEquity}
      isLoading={equityQ.isLoading || (m.weekEmpty && widenedQ.isLoading)}
      isError={equityQ.isError}
      onRetry={() => equityQ.refetch()}
      period={m.widened ? "month" : prefs.period}
      onPeriodChange={m.onPeriodChange}
      metric={prefs.metric}
      onMetricChange={(metric) => m.update({ metric })}
      note={m.widened ? t("equity.widened") : null}
      showBreakeven={scope === "me"}
    />
  );
  const insight = (id: SectionId & TileId, v: TileVariant) => (
    <InsightTileCard
      id={id}
      variant={v}
      trades={m.insightQ.data}
      prev={m.insightPrevQ.isSuccess && !m.insightPrevQ.isPlaceholderData ? m.insightPrevQ.data : null}
      isLoading={m.insightQ.isLoading || (!m.insightQ.data && !m.insightQ.isError)}
      scope={m.insightScope}
    />
  );

  const tile = (id: SectionId): BoardTileDef => {
    if (isEdge(id)) return { ready: true, render: (v) => insight(id, v) };
    switch (id) {
      // The desk regime of the day (shared with the plan / risk headers); staff confirm the system's suggestion here.
      case "regime":
        return {
          ready: m.authed,
          render: (v) => <DashCard fill title={t("sections.regime.label")}><RegimeDayView variant={v === "l" ? "row" : "tile"} /></DashCard>,
        };
      // The AI mentor's line (own day only; staff see their own mentor): opens /coach.
      case "mentor":
        return { ready: m.authed && scope === "me", render: () => <DashCard fill aria-label={t("sections.mentor.label")}>{lazyExtra(<MentorLine />)}</DashCard> };
      case "attention": return { ready: true, render: () => plan };
      case "equity": return { ready: true, render: equity };
      case "positions": return { ready: !!today?.positions?.length, render: () => (today ? lazyExtra(<PositionsPanel data={today} />) : null) };
      case "recent":
        return {
          ready: true,
          render: () => <RecentTradesPanel fill trades={recentQ.data} isLoading={recentQ.isLoading} isError={recentQ.isError} onRetry={() => recentQ.refetch()} showTrader={scope === "team"} />,
        };
      // Staff only; hidden when the risk desk is not deployed (null).
      case "desk":
        return {
          ready: m.staff && deskQ.data !== null,
          render: () => <DeskTodayPanel fill data={deskQ.data} isLoading={deskQ.isLoading} isError={deskQ.isError} onRetry={() => void deskQ.refetch()} />,
        };
      // Before the open it sits under the plan (outside the edit mode); off on weekends / market holidays.
      case "checkin": return { ready: m.tradingDay && (!checkinNow || editing), render: () => extraNode("checkin") };
      default: return { ready: true, render: () => extraNode(id) };
    }
  };
  const preview = (id: SectionId) => {
    const def = tile(id);
    return def.ready ? def.render("m") : <TilePlaceholder label={SECTION_META[id].label} />;
  };

  const sections: Record<BoardSection, BoardSectionDef> = {
    plan: { title: t("layout.plan"), after: checkinNow && !editing ? extraNode("checkin") : null },
    edge: {
      title: t("layout.edge"),
      hint: t("layout.edgeHint"),
      action: (
        <Link href="/stats" className="inline-flex min-h-8 items-center gap-0.5 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("layout.edgeAll")}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ),
    },
    trades: { title: t("layout.trades") },
    extras: { title: t("layout.extras") },
  };

  const hero = (
    <>
      <DashboardHeader
        data={today}
        risk={riskQ.data}
        desk={deskQ.data}
        isLoading={todayQ.isLoading}
        isError={todayQ.isError}
        onRetry={() => todayQ.refetch()}
        guest={m.isGuest}
        scope={scope}
        onScopeChange={(s) => m.update({ scope: s, scopePicked: true })}
        canChooseScope={m.staff}
        userName={m.userName}
      />
      {m.authed && <FirstSteps />}
      {m.dailyOn && <WrappedDashLine />}
      {m.authed && <Suspense fallback={null}><TodayEdgeLine /></Suspense>}
    </>
  );

  return (
    <Page className="dash-page">
      <DashBoard
        layout={board.layout}
        setLayout={board.setLayout}
        reset={board.reset}
        editable={m.authed}
        allowed={m.allowed}
        inScope={m.inScope}
        tile={tile}
        preview={preview}
        sections={sections}
        hero={{ title: t("layout.today"), node: hero }}
        onEditingChange={setEditing}
      />
    </Page>
  );
}
