import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardPen,
  Compass,
  FileEdit,
  HeartPulse,
  Lightbulb,
  Moon,
  ShieldAlert,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Panel, Pill, UpdatedAgo, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { links } from "@/lib/links";
import { prevWeekday } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import { shortDate } from "./fmt";
import { fmtUsd, pluralRu } from "@/lib/format";
import type { DashboardToday, EodStatus, EventsToday, MiniTrade, RecentTrade, RiskDesk, RiskMe } from "./use-dashboard";
import { commonI18n } from "@/i18n/ns/common";

/** One actionable line. Lower `rank` = more urgent; the first item becomes «Следующий шаг». */
type Item = {
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

const TONE_ICON: Record<Tone, string> = {
  up: "bg-up/15 text-up",
  down: "bg-down/15 text-down",
  accent: "bg-primary/15 text-primary",
  warn: "bg-warn/15 text-warn",
  purple: "bg-purple/15 text-purple",
  neutral: "bg-[var(--glass-hover-bg)] text-muted-foreground",
};

const CLOSE_MIN = 16 * 60;
const VISIBLE_ROWS = 5;
const INPUT_WAIT_MS = 2500;

function dayReportHref(date: string, trader?: string | null) {
  const q = new URLSearchParams({ date });
  if (trader) q.set("trader", trader);
  return `/day-report?${q.toString()}`;
}

function tradeChips(items: MiniTrade[], max = 3) {
  return items.slice(0, max).map((t) => ({ key: t.id, label: t.ticker, href: links.trade(t.id), title: `${t.ticker} · ${t.date}` }));
}

function splitTickers(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;/]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}

function ItemLink({ item, className, children }: { item: Item; className?: string; children: React.ReactNode }) {
  if (item.href) {
    return (
      <Link href={item.href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={item.onClick} className={cn("text-left", className)}>
      {children}
    </button>
  );
}

function NextStep({ item }: { item: Item }) {
  const Icon = item.icon;
  return (
    <div className="tile flex flex-col gap-3 p-3">
      <div className="flex items-start gap-3">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TONE_ICON[item.tone])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="micro-label">Следующий шаг</div>
          <div className="text-sm font-semibold leading-5">{item.title}</div>
          {item.detail && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.detail}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {item.href ? (
          <Button asChild size="sm">
            <Link href={item.href}>
              {item.cta}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button size="sm" onClick={item.onClick}>
            {item.cta}
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
        {item.secondary && (
          <Button asChild size="sm" variant="ghost">
            <Link href={item.secondary.href}>{item.secondary.label}</Link>
          </Button>
        )}
        {item.chips?.map((c) => (
          <Link key={c.key} href={c.href} title={c.title} className="chip inline-flex min-h-7 items-center px-2.5 text-xs font-medium tabular-nums">
            {c.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Row({ item }: { item: Item }) {
  const Icon = item.icon;
  return (
    <li>
      <ItemLink
        item={item}
        className="group flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", TONE_ICON[item.tone])}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.title}</span>
          {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground group-hover:text-foreground">
          <span className="hidden xl:inline">{item.cta}</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </ItemLink>
    </li>
  );
}

/**
 * «Что важно сейчас»: one prioritised list instead of a wall of tiles. Only things that need action are shown;
 * the most urgent becomes «Следующий шаг» with a button. Resolved items disappear.
 */
export function AttentionPanel({
  data,
  risk,
  desk,
  eod,
  lastDayEod,
  lastDay,
  recent,
  events,
  marketEvents,
  unread,
  isLoading,
  updatedAt,
  onCheckin,
  fill,
}: {
  data: DashboardToday | undefined;
  risk: RiskMe | null | undefined;
  desk: RiskDesk | null | undefined;
  eod: EodStatus | null | undefined;
  /** /api/eod/status for `lastDay` and the viewer. */
  lastDayEod: EodStatus | null | undefined;
  /** Most recent own trading day that can be closed (see dashboard.tsx). */
  lastDay: string | null;
  recent: RecentTrade[] | undefined;
  events: EventsToday | null | undefined;
  /** Macro calendar for today (OPEX, CPI, holidays…). */
  marketEvents: { name: string; type?: string | null; importance?: string | null }[];
  unread: { unread: number; critical: number; warn: number } | undefined;
  /** True until every input above has answered (the task count would otherwise jump as they arrive). */
  isLoading: boolean;
  updatedAt?: number;
  onCheckin: () => void;
  fill?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // A slow / retrying secondary input must not hold the panel back for long: after INPUT_WAIT_MS render what we have.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!isLoading || !data) return;
    const t = window.setTimeout(() => setWaited(true), INPUT_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [isLoading, data]);

  if (!data ? isLoading : isLoading && !waited) {
    return (
      <Panel title="Что важно сейчас" icon={Compass} fill={fill}>
        <div className="flex flex-col gap-3" role="status" aria-label="Загрузка">
          <Skeleton className="h-[104px] w-full rounded-xl" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2">
              <Skeleton className="h-7 w-7 rounded-lg" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-2/3 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    );
  }
  if (!data) return null;

  const a = data.attention;
  const team = data.scope === "team";
  const me = data.viewer.name;
  const today = data.date;
  const afterClose = data.market.nyMinutes >= CLOSE_MIN || data.market.weekend;
  const tradingDay = !data.market.weekend && !data.market.holidayToday;
  const items: Item[] = [];

  // ── Risk ────────────────────────────────────────────────────────────────
  if (!team && risk) {
    const breach = risk.halted || risk.alerts.some((x) => x.level === "breach");
    if (risk.halted || risk.alerts.length > 0) {
      const first = risk.alerts[0];
      items.push({
        key: "risk",
        rank: breach ? 0 : 3,
        icon: ShieldAlert,
        tone: breach ? "down" : "warn",
        title: risk.halted ? risk.stop.label : `Близко к лимиту: ${first?.label ?? "риск"}`,
        detail: risk.halted ? risk.stop.message : first ? `${first.pct != null ? `${Math.round(first.pct)}% лимита` : ""}${first.detail ? ` · ${first.detail}` : ""}` : undefined,
        href: links.risk(risk.trader),
        cta: "Риск-деск",
      });
    }
  }
  if (team && desk && desk.banner.length > 0) {
    const halted = desk.banner.filter((b) => b.halted);
    items.push({
      key: "risk-desk",
      rank: halted.length > 0 ? 0 : 3,
      icon: ShieldAlert,
      tone: halted.length > 0 ? "down" : "warn",
      title: halted.length > 0 ? `Стоп по риску: ${halted.map((b) => b.trader).join(", ")}` : `Близко к лимиту: ${desk.banner.map((b) => b.trader).join(", ")}`,
      detail: desk.banner[0]?.message,
      href: links.risk(desk.banner[0]?.trader),
      cta: "Риск-деск",
    });
  }

  // ── Day review (own: the last trading day that isn't closed; team: who hasn't closed today) ──
  if (!team && lastDay && lastDayEod) {
    const row = lastDayEod.traders.find((x) => x.trader === me);
    if (row && row.status === "open" && row.trades > 0) {
      const isToday = lastDay === today;
      const isYesterday = lastDay === prevWeekday(today);
      const dayNet = data.week.days.find((d) => d.date === lastDay)?.pnl ?? null;
      const missing = row.missing.length;
      items.push({
        key: "eod",
        rank: 1,
        icon: ClipboardCheck,
        tone: "warn",
        title: isToday ? "Закрыть сегодняшний день" : isYesterday ? "Заполнить разбор вчерашнего дня" : `Заполнить разбор дня ${shortDate(lastDay)}`,
        detail: [
          `${commonI18n.t("units.trades", { count: row.trades })}`,
          dayNet != null ? `${fmtUsd(dayNet, { signed: true })} нетто` : null,
          missing > 0 ? `${missing} без сетапа или оценки` : "итог дня не записан",
        ]
          .filter(Boolean)
          .join(" · "),
        href: links.journalDay(lastDay, me),
        cta: "Заполнить разбор",
        secondary: { label: "Авторазбор дня", href: dayReportHref(lastDay, me) },
      });
    }
  } else if (team && eod && afterClose) {
    const open = eod.traders.filter((x) => x.status === "open" && x.trades > 0);
    if (open.length > 0) {
      items.push({
        key: "eod-team",
        rank: 2,
        icon: ClipboardCheck,
        tone: "warn",
        title: `${open.length} ${pluralRu(open.length, "трейдер не закрыл", "трейдера не закрыли", "трейдеров не закрыли")} день`,
        detail: open.map((x) => x.trader).slice(0, 5).join(", "),
        href: links.journalDay(today),
        cta: "К журналу",
      });
    }
  }

  // ── Plan / check-in ─────────────────────────────────────────────────────
  if (data.gamePlan?.exists && !data.gamePlan.myReadAt) {
    const p = data.gamePlan;
    items.push({
      key: "plan",
      rank: 2,
      icon: BookOpenCheck,
      tone: "accent",
      title: "Прочитать план на день",
      detail: `${p.bias ? `${p.bias} · ` : ""}${p.inPlayCount} ${pluralRu(p.inPlayCount, "тикер в фокусе", "тикера в фокусе", "тикеров в фокусе")}`,
      href: links.gamePlan(today),
      cta: "Открыть план",
    });
  }
  if (!a.checkin.done && tradingDay && !afterClose) {
    items.push({
      key: "checkin",
      rank: 4,
      icon: HeartPulse,
      tone: "warn",
      title: "Утренний чек-ин",
      detail: "Сон, фокус, тильт — 30 секунд",
      onClick: onCheckin,
      cta: "Заполнить",
    });
  }

  // ── Events today for my tickers + macro ──────────────────────────────────
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
    ...macroEvents.map((e) => e.headline ?? e.eventType ?? "событие"),
  ];
  const tickerChips = [
    ...tickerEvents.flatMap((e) => splitTickers(e.ticker).filter((t) => mine.has(t)).map((t) => ({ t, title: `${t}: ${e.headline ?? e.eventType ?? "событие"}` }))),
    ...myEarnings.map((e) => ({ t: e.ticker.toUpperCase(), title: `${e.ticker}: отчёт ${e.session ?? ""}`.trim() })),
  ].filter((c, i, arr) => arr.findIndex((x) => x.t === c.t) === i);
  // After the close today's catalysts are history — the block is about what's ahead.
  if (!afterClose && (tickerChips.length > 0 || eventLabels.length > 0)) {
    const high = marketEvents.some((e) => e.importance === "high") || tickerEvents.some((e) => e.holding);
    items.push({
      key: "events",
      rank: high ? 2 : 5,
      icon: CalendarClock,
      tone: high ? "warn" : "purple",
      title:
        tickerChips.length > 0
          ? `События сегодня по моим тикерам: ${tickerChips.slice(0, 4).map((c) => c.t).join(", ")}${tickerChips.length > 4 ? ` +${tickerChips.length - 4}` : ""}`
          : `Сегодня: ${eventLabels.slice(0, 2).join(" · ")}`,
      detail: tickerChips.length > 0 ? (eventLabels.length > 0 ? `Рынок: ${eventLabels.slice(0, 2).join(" · ")}` : tickerChips[0].title) : eventLabels.length > 2 ? `и ещё ${eventLabels.length - 2}` : "Календарь рынка",
      href: tickerChips.length === 1 ? links.events(tickerChips[0].t) : links.events(),
      cta: "События",
    });
  }

  // ── Positions ───────────────────────────────────────────────────────────
  const carried = (data.positions ?? []).filter((p) => p.horizon !== "intraday");
  if (a.openTrades.count > 0) {
    items.push({
      key: "open",
      rank: carried.length > 0 && afterClose ? 2 : 6,
      icon: Moon,
      tone: carried.length > 0 ? "purple" : "accent",
      title: carried.length > 0 ? `${carried.length} ${pluralRu(carried.length, "позиция", "позиции", "позиций")} на ночь / свинг` : `${a.openTrades.count} ${pluralRu(a.openTrades.count, "открытая сделка", "открытые сделки", "открытых сделок")}`,
      detail: a.openTrades.items.map((t) => t.ticker).slice(0, 5).join(", "),
      href: links.trades(),
      cta: "К сделкам",
    });
  }

  // ── Notifications, rules, review queues ─────────────────────────────────
  if (unread && unread.unread > 0) {
    items.push({
      key: "notifications",
      rank: unread.critical > 0 ? 1 : 7,
      icon: Bell,
      tone: unread.critical > 0 ? "down" : unread.warn > 0 ? "warn" : "neutral",
      title: `${unread.unread} ${pluralRu(unread.unread, "непрочитанное уведомление", "непрочитанных уведомления", "непрочитанных уведомлений")}`,
      detail: unread.critical > 0 ? `${unread.critical} критичных` : unread.warn > 0 ? `${unread.warn} с предупреждением` : undefined,
      href: "/notifications",
      cta: "Открыть",
    });
  }
  if (a.violations.count > 0) {
    items.push({
      key: "violations",
      rank: 3,
      icon: AlertTriangle,
      tone: "down",
      title: `${a.violations.count} ${pluralRu(a.violations.count, "нарушение правил", "нарушения правил", "нарушений правил")} за сутки`,
      detail: a.violations.items[0]?.message,
      href: "/error-tracker",
      cta: "Подробнее",
    });
  }
  if (a.curatorQueue && a.curatorQueue.count > 0) {
    const q = a.curatorQueue;
    items.push({
      key: "curator",
      rank: 5,
      icon: UserCheck,
      tone: "purple",
      title: `${q.count} ${pluralRu(q.count, "вывод ждёт", "вывода ждут", "выводов ждут")} вашего ревью`,
      detail: q.items.map((t) => `${t.ticker}${t.trader ? ` (${t.trader})` : ""}`).slice(0, 3).join(", "),
      href: links.trades({ ids: q.items.map((t) => t.id) }),
      cta: "Рецензировать",
    });
  }
  if (a.unreviewed.count > 0) {
    items.push({
      key: "unreviewed",
      rank: 8,
      icon: ClipboardPen,
      tone: "neutral",
      title: `${commonI18n.t("units.trades", { count: a.unreviewed.count })} без выводов за 30 дней`,
      detail: a.unreviewed.items.map((t) => t.ticker).slice(0, 5).join(", "),
      href: a.unreviewed.items[0] ? links.trade(a.unreviewed.items[0].id) : links.trades(),
      cta: "Разобрать",
      chips: tradeChips(a.unreviewed.items),
    });
  }
  if (a.ideasToReview.count > 0) {
    items.push({
      key: "ideas",
      rank: 9,
      icon: Lightbulb,
      tone: "accent",
      title: `${a.ideasToReview.count} ${pluralRu(a.ideasToReview.count, "идея команды", "идеи команды", "идей команды")} без вашей оценки`,
      detail: a.ideasToReview.items.map((i) => i.ticker).slice(0, 5).join(", "),
      href: a.ideasToReview.items[0] ? links.idea(a.ideasToReview.items[0].id) : "/trade-ideas",
      cta: "Оценить",
    });
  }
  if (a.draftIdeas.count > 0) {
    items.push({
      key: "drafts",
      rank: 10,
      icon: FileEdit,
      tone: "neutral",
      title: `${a.draftIdeas.count} ${pluralRu(a.draftIdeas.count, "черновик идеи", "черновика идей", "черновиков идей")}`,
      detail: "Опубликуйте или удалите",
      href: "/trade-ideas?status=draft&mine=1",
      cta: "К идеям",
    });
  }

  items.sort((x, y) => x.rank - y.rank);
  // Nothing urgent → the next step is still useful: look at the last day's breakdown.
  const lastTradeDate = !team ? (recent?.[0]?.closeDate?.slice(0, 10) ?? null) : null;
  const fallback: Item | null =
    items.length === 0 && lastTradeDate
      ? {
          key: "report",
          rank: 99,
          icon: ClipboardCheck,
          tone: "up",
          title: `Посмотреть разбор дня ${shortDate(lastTradeDate)}`,
          detail: "Сильные стороны, утечки и план на следующий день",
          href: dayReportHref(lastTradeDate, me),
          cta: "Открыть разбор",
        }
      : null;
  const [next, ...rest] = fallback ? [fallback] : items;
  const shown = expanded ? rest : rest.slice(0, VISIBLE_ROWS);
  const hiddenCount = rest.length - shown.length;
  const pending = items.length;

  return (
    <Panel
      title="Что важно сейчас"
      icon={Compass}
      fill={fill}
      actions={
        pending > 0 ? (
          <Pill tone="warn">
            {pending} {pluralRu(pending, "задача", "задачи", "задач")}
          </Pill>
        ) : (
          <Pill tone="up" dot>
            Всё в порядке
          </Pill>
        )
      }
      footer={updatedAt ? <UpdatedAgo at={updatedAt} /> : undefined}
    >
      {!next ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-up" aria-hidden="true" />
          <p className="text-sm font-medium">Срочных дел нет</p>
          <p className="max-w-[28ch] text-xs text-muted-foreground">Риск в норме, разбор закрыт, новых уведомлений нет.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <NextStep item={next} />
          {shown.length > 0 && (
            <ul className="flex flex-col" aria-label="Остальные задачи">
              {shown.map((i) => (
                <Row key={i.key} item={i} />
              ))}
            </ul>
          )}
          {(hiddenCount > 0 || expanded) && rest.length > VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 self-start rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
              {expanded ? "Свернуть" : `Ещё ${hiddenCount}`}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
