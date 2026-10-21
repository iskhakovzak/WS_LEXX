// Dashboard = the trader's command screen. Phone (Волна 1, item 1.3): ONE «Следующий шаг» card first (the day line and
// «Что важно сейчас» merged by the phase of the day — components/daily/next-step-card), then the header with P&L and
// the limit. Desktop, top to bottom: header (NY session, today / week net, risk limit + the day
// line: focus / own contract / evening card / tier progress — the one focal point) →
// «Что важно сейчас» + week/month equity → recent trades + desk (staff) or streaks → opt-in extras
// (check-in, brief, sectors, macro, DNA, quote, psychology — off by default, switched on in «Настроить»).
// Each block answers one question; trades arrive automatically, so there are no entry CTAs here.
import { lazy, Suspense, useCallback, type ComponentType, type ReactNode } from "react";
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
import { StreaksPanel } from "@/components/dashboard/streaks-panel";
import { RecentTradesPanel } from "@/components/dashboard/recent-trades-panel";
import { DeskTodayPanel } from "@/components/dashboard/team-heat-strip";
import { CustomizePopover } from "@/components/dashboard/customize-popover";
import { DayLine } from "@/components/daily/day-line";
import { NextStepCard } from "@/components/daily/next-step-card";
import { QuestStrip } from "@/components/quests/quest-strip";
import { dayView } from "@/components/daily/daily-model";
import { useDailyMe } from "@/components/daily/use-daily";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import {
  SECTION_WIDTH,
  useDashboardEquity,
  useDashboardToday,
  useEodDay,
  useEodStatus,
  useEventsToday,
  useRecentTrades,
  useRiskDesk,
  useRiskMe,
  type SectionId,
} from "@/components/dashboard/use-dashboard";
import { useDashboardPrefs } from "@/components/dashboard/dashboard-prefs";

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

const ExtraFallback = () => <Skeleton className="h-40 w-full rounded-2xl" />;
const lazyExtra = (node: ReactNode) => <Suspense fallback={<ExtraFallback />}>{node}</Suspense>;

const RITUAL_ANCHOR = "dash-ritual";
const CLOSE_MIN = 16 * 60;
const OPEN_MIN = 9 * 60 + 30;

const SPAN: Record<number, string> = {
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  12: "lg:col-span-12",
};

type Block = { id: SectionId; node: ReactNode };

/** Group visible blocks into bento rows: two neighbouring half-blocks share a row (7/5, 5/7 or 6/6), full blocks take one. */
function toRows(blocks: Block[]): { key: string; cells: { block: Block; span: number }[] }[] {
  const rows: { key: string; cells: { block: Block; span: number }[] }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    const wa = SECTION_WIDTH[a.id];
    const wb = b ? SECTION_WIDTH[b.id] : "full";
    if (wa !== "full" && b && wb !== "full") {
      const spanA = wa === wb ? 6 : wa === "wide" ? 7 : 5;
      rows.push({ key: `${a.id}+${b.id}`, cells: [{ block: a, span: spanA }, { block: b, span: 12 - spanA }] });
      i++;
    } else {
      rows.push({ key: a.id, cells: [{ block: a, span: 12 }] });
    }
  }
  return rows;
}

export default function Dashboard() {
  const { user, isCurator } = useAuth();
  const isGuest = !user || user.role === "guest";
  const userName = user?.traderName ?? null;
  const staff = isCurator;
  const authed = !isGuest;

  // Staff = traders + extras (owner rule 2026-10-21): everyone opens on «Мои» (own day line, next step, quests,
  // check-in); staff always have the «Мои» / «Команда» toggle. A trader always sees their own desk.
  const { prefs, update, reset } = useDashboardPrefs("me", user ? `${user.role}:${userName ?? ""}` : null);
  const canChooseScope = staff;
  const scope = staff ? prefs.scope : "me";
  const on = (id: SectionId) => authed && !prefs.hidden.includes(id);

  const todayQ = useDashboardToday(scope, authed);
  const equityQ = useDashboardEquity(scope, prefs.period, on("equity"));
  const recentQ = useRecentTrades(scope, authed);
  // Staff without their own limits row have no risk account: no /api/risk/me polling for them.
  const riskAccount = useHasRiskAccount();
  const riskQ = useRiskMe(authed && !!userName && riskAccount.has);
  const deskQ = useRiskDesk(authed && staff);
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
  // The day line (header) owns the last finished day's review; the journal stays its next step while still open.
  const dailyOn = authed && scope === "me";
  const dailyQ = useDailyMe(dailyOn);
  const dayCardDate = dayView(dailyQ.data)?.evening?.date ?? null;
  const lastDayRow = lastDayEodQ.data?.traders.find((x) => x.trader === userName);
  const journalOpenDate = lastDay && lastDayRow?.status === "open" && lastDayRow.trades > 0 ? lastDay : null;
  // «Что важно сейчас» counts tasks from all of these: render it once they have answered (no 2 → 3 jump).
  const attentionLoading = todayQ.isLoading || recentQ.isLoading || riskQ.isLoading || deskQ.isLoading || eodQ.isLoading
    || eventsQ.isLoading || holidaysQ.isLoading || unreadQ.isLoading || lastDayEodQ.isLoading;

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

  const render = (id: SectionId): ReactNode => {
    switch (id) {
      case "attention":
        return (
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
            phoneStepAbove={dailyOn}
          />
        );
      case "equity":
        return (
          <EquityPanel
            fill
            data={equityQ.data}
            isLoading={equityQ.isLoading}
            isError={equityQ.isError}
            onRetry={() => equityQ.refetch()}
            period={prefs.period}
            onPeriodChange={(period) => update({ period })}
            metric={prefs.metric}
            onMetricChange={(metric) => update({ metric })}
          />
        );
      case "recent":
        return (
          <RecentTradesPanel
            fill
            trades={recentQ.data}
            isLoading={recentQ.isLoading}
            isError={recentQ.isError}
            onRetry={() => recentQ.refetch()}
            showTrader={scope === "team"}
          />
        );
      case "desk":
        // Staff only; hidden when the risk desk is not deployed (null).
        return staff && deskQ.data !== null ? <DeskTodayPanel fill data={deskQ.data} isLoading={deskQ.isLoading} isError={deskQ.isError} onRetry={() => void deskQ.refetch()} /> : null;
      case "streaks":
        return <StreaksPanel fill data={today} isLoading={todayQ.isLoading} />;
      case "positions":
        return today?.positions && today.positions.length > 0 ? lazyExtra(<PositionsPanel data={today} />) : null;
      case "checkin":
        return (
          <section id={RITUAL_ANCHOR} tabIndex={-1} aria-label={dashboardI18n.t("sections.checkin.label")} className="scroll-mt-24 outline-none">
            {lazyExtra(<MorningCheckin />)}
          </section>
        );
      case "brief":
        return lazyExtra(<MarketOpenBrief />);
      case "quote":
        return lazyExtra(<DailyQuoteCard />);
      case "sectors":
        return lazyExtra(<SectorRadar />);
      case "macro":
        return lazyExtra(<UpcomingEventsList />);
      case "dna":
        return lazyExtra(<MarketDnaWidget />);
      case "psychology":
        return lazyExtra(<WeeklyPsychologyReport />);
    }
  };

  // The morning check-in leads before the open on a trading day and is gone on weekends / market holidays (ILYA-20).
  const tradingDay = today ? !today.market.weekend && !today.market.holidayToday : true;
  const morning = !!today && tradingDay && today.market.nyMinutes < OPEN_MIN;
  const order = morning ? ["checkin" as SectionId, ...prefs.order.filter((id) => id !== "checkin")] : prefs.order;
  const blocks: Block[] = order
    .filter((id) => on(id) && (id !== "desk" || staff) && (id !== "checkin" || tradingDay))
    .map((id) => ({ id, node: render(id) }))
    .filter((b) => b.node != null);
  const rows = toRows(blocks);

  return (
    <Page>
      {/* Item 1.3 — phone: ONE «Следующий шаг» first (plan → contract → close → «Задача дня»), P&L and the limit below. */}
      {dailyOn && <NextStepCard enabled={dailyOn} journalOpenDate={journalOpenDate} className="md:hidden" />}
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
        canChooseScope={canChooseScope}
        userName={userName}
        dayLine={<DayLine enabled={dailyOn} journalOpenDate={journalOpenDate} quests={<QuestStrip enabled={dailyOn} />} phoneSplit />}
        customize={
          authed ? <CustomizePopover staff={staff} order={prefs.order} hidden={prefs.hidden} onChange={(patch) => update(patch)} onReset={reset} /> : null
        }
      />
      {rows.map((row) =>
        row.cells.length === 1 ? (
          <div key={row.key} className="min-w-0">
            {row.cells[0].block.node}
          </div>
        ) : (
          <div key={row.key} className="grid grid-cols-1 items-stretch gap-[var(--grid-gap)] lg:grid-cols-12">
            {row.cells.map((c) => (
              <div key={c.block.id} className={`min-w-0 ${SPAN[c.span]}`}>
                {c.block.node}
              </div>
            ))}
          </div>
        ),
      )}
    </Page>
  );
}
