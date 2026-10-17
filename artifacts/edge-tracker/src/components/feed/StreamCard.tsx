import { useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, Award, BookOpen, CalendarRange, ChevronDown, Flame, GraduationCap, Lightbulb, Map as MapIcon,
  MessageSquareText, MessagesSquare, ShieldAlert, ShieldCheck, TrendingDown, TrendingUp, Trophy, Users, Zap,
  type LucideIcon,
} from "lucide-react";
import { Pill, Truncate, toneOf, tonePill, toneText, type Tone } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtTime, fmtValue, isNewItem, type FeedKind, type StreamItem } from "./stream-api";
import { formatDayLong, pluralRu, relativeDayLabel } from "./feed-utils";

const KIND_ICON: Record<FeedKind, LucideIcon> = {
  day_result: TrendingUp,
  streak: Flame,
  best_day: Trophy,
  best_week: Trophy,
  exam: GraduationCap,
  promotion: Award,
  clean_streak: ShieldCheck,
  violations: ShieldAlert,
  risk_breach: AlertTriangle,
  review: MessageSquareText,
  idea: Lightbulb,
  playbook: BookOpen,
  thread: MessagesSquare,
  game_plan: MapIcon,
  event: Zap,
  weekly_summary: CalendarRange,
};

function iconFor(it: Pick<StreamItem, "kind" | "tone">): LucideIcon {
  if (it.kind === "day_result" && it.tone === "down") return TrendingDown;
  return KIND_ICON[it.kind] ?? Zap;
}

function IconTile({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  return (
    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tonePill(tone))} aria-hidden="true">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function NewDot({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
      <span className="sr-only">новое</span>
    </span>
  );
}

/** Row body shared by single items and rows inside an expanded group. */
function RowBody({ item, isNew, showTime = true }: { item: StreamItem; isNew: boolean; showTime?: boolean }) {
  const value = fmtValue(item.value, item.valueFmt);
  const valueTone: Tone = item.valueFmt === "usd" ? toneOf(item.value) : item.tone === "neutral" ? "neutral" : item.tone;
  return (
    <>
      <IconTile icon={iconFor(item)} tone={item.tone} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Truncate className="text-sm font-medium text-foreground">{item.title}</Truncate>
          <NewDot on={isNew} />
        </div>
        {item.subtitle && <Truncate className="mt-0.5 text-xs text-muted-foreground">{item.subtitle}</Truncate>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {value && <span className={cn("text-sm font-semibold tabular-nums", toneText(valueTone))}>{value}</span>}
        {showTime && <span className="text-xs tabular-nums text-muted-foreground" title="время Нью-Йорка">{fmtTime(item.at)}</span>}
      </div>
    </>
  );
}

/** Kinds whose `at` is synthetic (end of day / Friday close) — their clock time means nothing to the reader. */
const NO_TIME: ReadonlySet<FeedKind> = new Set<FeedKind>(["day_result", "streak", "best_day", "best_week", "weekly_summary", "clean_streak", "violations"]);

const ROW = "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left";
const ROW_LINK = "transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One compact card that links to its source (day report, weekly review, idea, playbook…). */
export function StreamRow({ item, baseline }: { item: StreamItem; baseline: string | null }) {
  const isNew = isNewItem(item, baseline);
  if (item.href) {
    return (
      <Link href={item.href} className={cn(ROW, ROW_LINK)} data-feed-item={item.id}>
        <RowBody item={item} isNew={isNew} showTime={!NO_TIME.has(item.kind)} />
      </Link>
    );
  }
  return (
    <div className={ROW} data-feed-item={item.id}>
      <RowBody item={item} isNew={isNew} showTime={!NO_TIME.has(item.kind)} />
    </div>
  );
}

/* ─────────────── groups («3 новых идеи») ─────────────── */

type GroupSummary = { icon: LucideIcon; tone: Tone; title: string; subtitle: string | null; value: number | null; valueFmt: StreamItem["valueFmt"] };

function uniq<T>(xs: (T | null | undefined)[]): T[] {
  return Array.from(new Set(xs.filter((x): x is T => x != null)));
}

function listShort(xs: string[], max = 4): string {
  return xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max}` : xs.join(", ");
}

function summarize(group: string, items: StreamItem[]): GroupSummary {
  const n = items.length;
  const prefix = group.split(":")[0];
  const tickers = uniq(items.map((i) => i.ticker));
  if (prefix === "desk-day" || prefix === "desk-week") {
    const priced = items.filter((i) => i.value != null);
    const sum = priced.length ? Math.round(priced.reduce((s, i) => s + (i.value ?? 0), 0) * 100) / 100 : null;
    const green = priced.filter((i) => (i.value ?? 0) > 0).length;
    const top = [...priced].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    return {
      icon: prefix === "desk-day" ? Users : CalendarRange,
      tone: toneOf(sum) === "neutral" ? "accent" : toneOf(sum),
      title: `${prefix === "desk-day" ? "Итоги деска" : "Деск за неделю"}: ${n} ${pluralRu(n, "трейдер", "трейдера", "трейдеров")}`,
      subtitle: [priced.length ? `${green} из ${priced.length} в плюсе` : null, top?.trader && top.value != null && top.value > 0 ? `лучший ${top.trader} ${fmtValue(top.value, "usd")}` : null]
        .filter(Boolean).join(" · ") || null,
      value: sum,
      valueFmt: sum == null ? null : "usd",
    };
  }
  if (prefix === "ideas") {
    return { icon: Lightbulb, tone: "accent", title: `${n} ${pluralRu(n, "новая идея", "новые идеи", "новых идей")}`, subtitle: tickers.length ? listShort(tickers) : null, value: null, valueFmt: null };
  }
  if (prefix === "playbook") {
    const authors = uniq(items.map((i) => i.actor ?? i.trader));
    return {
      icon: BookOpen, tone: "neutral",
      title: `${n} ${pluralRu(n, "обновление", "обновления", "обновлений")} плейбука`,
      subtitle: [tickers.length ? listShort(tickers) : null, authors.length ? listShort(authors, 2) : null].filter(Boolean).join(" · ") || null,
      value: null, valueFmt: null,
    };
  }
  if (prefix === "threads") {
    return { icon: MessagesSquare, tone: "neutral", title: `${n} ${pluralRu(n, "новое обсуждение", "новых обсуждения", "новых обсуждений")}`, subtitle: tickers.length ? listShort(tickers) : null, value: null, valueFmt: null };
  }
  if (prefix === "events") {
    return { icon: Zap, tone: "neutral", title: `${n} ${pluralRu(n, "событие", "события", "событий")} рынка`, subtitle: tickers.length ? listShort(tickers, 6) : null, value: null, valueFmt: null };
  }
  if (prefix === "reviews") {
    const who = uniq(items.map((i) => i.actor));
    return { icon: MessageSquareText, tone: "accent", title: `${n} ${pluralRu(n, "разбор", "разбора", "разборов")} от куратора`, subtitle: who.length ? listShort(who, 2) : null, value: null, valueFmt: null };
  }
  const first = items[0];
  return { icon: iconFor(first), tone: first.tone, title: `${first.title} и ещё ${n - 1}`, subtitle: first.subtitle, value: null, valueFmt: null };
}

const GROUP_CAP = 6;

/** Collapsed card for similar items of one day; expands in place, long lists cap at 6 with «ещё». */
export function StreamGroup({ group, items, baseline }: { group: string; items: StreamItem[]; baseline: string | null }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const s = summarize(group, items);
  const newCount = items.filter((i) => isNewItem(i, baseline)).length;
  const value = fmtValue(s.value, s.valueFmt);
  const shown = all ? items : items.slice(0, GROUP_CAP);
  const panelId = `feed-group-${group.replace(/[^a-z0-9-]/gi, "-")}`;
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId} className={cn(ROW, ROW_LINK)}>
        <IconTile icon={s.icon} tone={s.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Truncate className="text-sm font-medium text-foreground">{s.title}</Truncate>
            {newCount > 0 && <Pill tone="accent">{newCount} {pluralRu(newCount, "новое", "новых", "новых")}</Pill>}
          </div>
          {s.subtitle && <Truncate className="mt-0.5 text-xs text-muted-foreground">{s.subtitle}</Truncate>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {value && <span className={cn("text-sm font-semibold tabular-nums", toneText(toneOf(s.value)))}>{value}</span>}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </div>
      </button>
      {open && (
        <div id={panelId} className="ml-[1.375rem] border-l border-[var(--glass-border)] pl-3">
          {shown.map((it) => <StreamRow key={it.id} item={it} baseline={baseline} />)}
          {items.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="chip ml-2 mt-1 inline-flex min-h-8 items-center px-3 text-xs font-medium">
              Ещё {items.length - shown.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── day header ─────────────── */

export function StreamDayHeader({ day, today, myNet, newCount, count }: {
  day: string;
  today: string;
  myNet: number | null;
  newCount: number;
  count: number;
}) {
  const rel = relativeDayLabel(day, today);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{formatDayLong(day)}</h2>
      {rel && <Pill tone={day === today ? "accent" : "neutral"}>{rel}</Pill>}
      {myNet != null && (
        <span className={cn("text-sm font-semibold tabular-nums", toneText(toneOf(myNet)))} title="Мой результат за день, нетто">
          {fmtValue(myNet, "usd")}
        </span>
      )}
      <span className="text-xs tabular-nums text-muted-foreground">
        {count} {pluralRu(count, "событие", "события", "событий")}
        {newCount > 0 && <span className="text-primary"> · {newCount} {pluralRu(newCount, "новое", "новых", "новых")}</span>}
      </span>
    </div>
  );
}
