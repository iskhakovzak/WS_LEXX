import {
  AlertTriangle,
  Bell,
  CalendarClock,
  ClipboardPen,
  FileEdit,
  Lightbulb,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/components/ds";
import { links } from "@/lib/links";
import { shortDate } from "./fmt";
import { fmtWeekday } from "@/lib/format";
import type { DashboardToday, EventsToday, MiniTrade, RecentTrade } from "./use-dashboard";
import type { commonI18n } from "@/i18n/ns/common";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { personName } from "@/i18n";

/** Pure pieces of «Что важно сейчас» (attention-panel.tsx): the item shape, date/ticker helpers, item builders. */

type DashT = ReturnType<typeof dashboardI18n.useT>["t"];
type CommonT = ReturnType<typeof commonI18n.useT>["t"];

/** One actionable line. Lower `rank` = more urgent; the first item becomes «Следующий шаг». */
export type Item = {
  key: string;
  rank: number;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  detail?: string;
  href?: string;
  onClick?: () => void;
  cta: string;
  secondary?: { label: string; href: string };
  chips?: { key: string | number; label: string; href: string; title?: string }[];
};

/** Calendar days after which an unclosed day / last trade is history for «Следующий шаг». */
export const STALE_DAYS = 30;

/** `day` is more than STALE_DAYS calendar days before `today` (both YYYY-MM-DD). */
export function staleDay(day: string, today: string): boolean {
  const ms = Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(ms) && ms > STALE_DAYS * 86_400_000;
}

/** Distinct tickers of the preview, newest first (OWNER-21: «SOXL, AAPL, JPM, JPM, AAPL»). */
export function uniqueTickers(items: { ticker?: string | null }[]): string[] {
  return [...new Set(items.map((i) => (i.ticker ?? "").trim().toUpperCase()).filter(Boolean))];
}

/** «18 нарушений правил за сутки» on a trading day; «… за пт, 16 окт» on a weekend / holiday (OWNER-21). */
export function violationsTitle(v: { count: number; window?: { from: string; to: string } }, tradingDay: boolean): string {
  if (!tradingDay && v.window?.from) return dashboardI18n.t("attention.violationsOn", { count: v.count, date: fmtWeekdayDate(v.window.from) });
  return dashboardI18n.t("attention.violations", { count: v.count });
}

function fmtWeekdayDate(ymd: string): string {
  return `${fmtWeekday(ymd, "short")}, ${shortDate(ymd)}`;
}

export function dayReportHref(date: string, trader?: string | null) {
  const q = new URLSearchParams({ date });
  if (trader) q.set("trader", trader);
  return `/day-report?${q.toString()}`;
}

export function tradeChips(items: MiniTrade[], max = 3) {
  return items.slice(0, max).map((t) => ({ key: t.id, label: t.ticker, href: links.trade(t.id), title: `${t.ticker} · ${t.date}` }));
}

export function splitTickers(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;/]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}

/** «События сегодня»: catalysts for my tickers (watchlist, recent trades, positions) + the macro calendar. */
export function eventsItem(
  {
    data,
    recent,
    events,
    marketEvents,
    afterClose,
  }: {
    data: DashboardToday;
    recent: RecentTrade[] | undefined;
    events: EventsToday | null | undefined;
    marketEvents: { name: string; type?: string | null; importance?: string | null }[];
    afterClose: boolean;
  },
  t: DashT,
): Item | null {
  const mine = new Set<string>([
    ...(data.myTickers ?? []),
    ...(recent ?? []).map((t) => t.ticker.toUpperCase()),
    ...(data.positions ?? []).map((p) => p.ticker.toUpperCase()),
  ]);
  const tickerEvents = (events?.events ?? []).filter((e) => e.holding || e.tradesToday > 0 || splitTickers(e.ticker).some((t) => mine.has(t)));
  const macroEvents = (events?.events ?? []).filter((e) => !e.ticker);
  const myEarnings = (events?.earnings ?? []).filter((e) => mine.has(e.ticker.toUpperCase()));
  const eventLabels = [
    ...marketEvents.map((e) => e.name),
    ...macroEvents.map((e) => e.headline ?? e.eventType ?? t("attention.eventFallback")),
  ];
  const tickerChips = [
    ...tickerEvents.flatMap((e) => splitTickers(e.ticker).filter((tk) => mine.has(tk)).map((tk) => ({ t: tk, title: `${tk}: ${e.headline ?? e.eventType ?? t("attention.eventFallback")}` }))),
    ...myEarnings.map((e) => ({ t: e.ticker.toUpperCase(), title: t("attention.earnings", { ticker: e.ticker, session: e.session ?? "" }).trim() })),
  ].filter((c, i, arr) => arr.findIndex((x) => x.t === c.t) === i);
  // After the close today's catalysts are history — the block is about what's ahead.
  if (!afterClose && (tickerChips.length > 0 || eventLabels.length > 0)) {
    const high = marketEvents.some((e) => e.importance === "high") || tickerEvents.some((e) => e.holding);
    return {
      key: "events",
      rank: high ? 2 : 5,
      icon: CalendarClock,
      tone: high ? "warn" : "purple",
      title:
        tickerChips.length > 0
          ? t("attention.myEvents", { tickers: `${tickerChips.slice(0, 4).map((c) => c.t).join(", ")}${tickerChips.length > 4 ? ` +${tickerChips.length - 4}` : ""}` })
          : t("attention.todayEvents", { events: eventLabels.slice(0, 2).join(" · ") }),
      detail: tickerChips.length > 0
        ? (eventLabels.length > 0 ? t("attention.market", { events: eventLabels.slice(0, 2).join(" · ") }) : tickerChips[0].title)
        : eventLabels.length > 2 ? t("attention.andMore", { count: eventLabels.length - 2 }) : t("attention.marketCalendar"),
      href: tickerChips.length === 1 ? links.events(tickerChips[0].t) : links.events(),
      cta: t("attention.events"),
    };
  }
  return null;
}

/** Notifications, rule violations and review queues (curator, unreviewed trades, ideas, drafts). */
export function queueItems(
  a: DashboardToday["attention"],
  unread: { unread: number; critical: number; warn: number } | undefined,
  tradingDay: boolean,
  t: DashT,
  tc: CommonT,
): Item[] {
  const items: Item[] = [];
  if (unread && unread.unread > 0) {
    items.push({
      key: "notifications",
      rank: unread.critical > 0 ? 1 : 7,
      icon: Bell,
      tone: unread.critical > 0 ? "down" : unread.warn > 0 ? "warn" : "neutral",
      title: t("attention.unread", { count: unread.unread }),
      detail: unread.critical > 0 ? t("attention.critical", { count: unread.critical }) : unread.warn > 0 ? t("attention.warn", { count: unread.warn }) : undefined,
      href: "/notifications",
      cta: t("attention.open"),
    });
  }
  if (a.violations.count > 0) {
    items.push({
      key: "violations",
      rank: 3,
      icon: AlertTriangle,
      tone: "down",
      title: violationsTitle(a.violations, tradingDay),
      detail: [a.violations.items[0]?.message, (a.violations.tickers ?? uniqueTickers(a.violations.items)).slice(0, 5).join(", ")].filter(Boolean).join(" · "),
      href: "/error-tracker",
      cta: t("attention.details"),
    });
  }
  if (a.curatorQueue && a.curatorQueue.count > 0) {
    const q = a.curatorQueue;
    items.push({
      key: "curator",
      rank: 5,
      icon: UserCheck,
      tone: "purple",
      title: t("attention.curatorQueue", { count: q.count }),
      detail: q.items.map((x) => `${x.ticker}${x.trader ? ` (${personName(x.trader)})` : ""}`).slice(0, 3).join(", "),
      href: links.trades({ ids: q.items.map((x) => x.id) }),
      cta: t("attention.reviewIt"),
    });
  }
  if (a.unreviewed.count > 0) {
    items.push({
      key: "unreviewed",
      rank: 8,
      icon: ClipboardPen,
      tone: "neutral",
      title: t("attention.unreviewed", { trades: tc("units.trades", { count: a.unreviewed.count }) }),
      detail: a.unreviewed.items.map((x) => x.ticker).slice(0, 5).join(", "),
      href: a.unreviewed.items[0] ? links.trade(a.unreviewed.items[0].id) : links.trades(),
      cta: t("attention.reviewTrades"),
      chips: tradeChips(a.unreviewed.items),
    });
  }
  if (a.ideasToReview.count > 0) {
    items.push({
      key: "ideas",
      rank: 9,
      icon: Lightbulb,
      tone: "accent",
      title: t("attention.ideas", { count: a.ideasToReview.count }),
      detail: a.ideasToReview.items.map((i) => i.ticker).slice(0, 5).join(", "),
      href: a.ideasToReview.items[0] ? links.idea(a.ideasToReview.items[0].id) : "/trade-ideas",
      cta: t("attention.rate"),
    });
  }
  if (a.draftIdeas.count > 0) {
    items.push({
      key: "drafts",
      rank: 10,
      icon: FileEdit,
      tone: "neutral",
      title: t("attention.drafts", { count: a.draftIdeas.count }),
      detail: t("attention.draftsHint"),
      href: "/trade-ideas?status=draft&mine=1",
      cta: t("attention.toIdeas"),
    });
  }
  return items;
}
