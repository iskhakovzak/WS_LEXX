import React from "react";
import { useTodayHolidays, type HolidayEvent } from "@/lib/market-intel";
import { Pill, type Tone } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CalendarDays, AlertTriangle, Zap } from "lucide-react";

const TYPE_META: Record<string, { label: string; tone: Tone; hint?: string }> = {
  fomc: { label: "FOMC", tone: "down", hint: "Решение ФРС — резкие движения в 14:00 ET, режьте размер до выхода" },
  cpi: { label: "CPI", tone: "warn", hint: "Инфляция в 8:30 ET — гэпы на открытии, широкие спреды в премаркете" },
  ppi: { label: "PPI", tone: "warn", hint: "Цены производителей в 8:30 ET" },
  nfp: { label: "NFP", tone: "purple", hint: "Рынок труда в 8:30 ET — волатильный премаркет" },
  opex: { label: "OPEX", tone: "accent", hint: "Экспирация опционов — пиннинг к страйкам, всплеск объёма на закрытии" },
  quad_witching: { label: "QUAD", tone: "purple", hint: "Квадрупл-витчинг — огромный MOC-имбаланс" },
  holiday: { label: "Праздник", tone: "warn", hint: "Короткий или закрытый день — низкая ликвидность" },
  month_end: { label: "Конец мес.", tone: "accent", hint: "Ребалансировка фондов на закрытии" },
};

function metaFor(type: string | null | undefined): { label: string; tone: Tone; hint?: string } {
  const t = type ?? "";
  return TYPE_META[t] || { label: t ? t.replace(/_/g, " ").toUpperCase() : "Событие", tone: "neutral" };
}

function parseLocal(d: string): Date {
  // "YYYY-MM-DD" is parsed as UTC midnight by Date(); build a local date so the day doesn't shift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
}

function shortDate(d: string) {
  const date = parseLocal(d);
  if (Number.isNaN(date.getTime())) return d ?? "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", weekday: "short" });
}

function daysUntil(d: string): number | null {
  const date = parseLocal(d);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

function relLabel(n: number | null) {
  if (n == null) return "";
  if (n <= 0) return "сегодня";
  if (n === 1) return "завтра";
  return `через ${n} дн.`;
}

export function DateHolidayBadge({ events }: { events: HolidayEvent[] }) {
  if (!events || events.length === 0) return null;
  const top = events[0];
  const m = metaFor(top.type);
  const title = events.map((e) => `${e.name}${e.description ? " — " + e.description : ""}`).join("\n");
  return (
    <span title={title} aria-label={events.map((e) => e.name).join(", ")} className="ml-1 inline-flex align-middle">
      <Pill tone={m.tone} className="px-1.5 py-0 text-2xs leading-4">
        {m.label}
        {events.length > 1 ? ` +${events.length - 1}` : ""}
      </Pill>
    </span>
  );
}

export function TodayEventBanner({ className }: { className?: string } = {}) {
  const { data } = useTodayHolidays();
  const events = data?.today ?? [];
  const high = events.filter((e) => e.importance === "high");

  if (events.length === 0) return null;
  const isHigh = high.length > 0;
  const hints = events.map((e) => metaFor(e.type).hint).filter((h): h is string => !!h);

  return (
    <section
      aria-label="События сегодня"
      className={cn(
        "glass-panel flex items-start gap-3 rounded-2xl p-3 sm:p-4",
        isHigh ? "ring-1 ring-down/40" : "ring-1 ring-[hsl(var(--chart-3)/0.4)]",
        className,
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
          isHigh ? "bg-down/15 text-down" : "bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))]",
        )}
      >
        {isHigh ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <Zap className="h-4 w-4" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            {isHigh ? "Сегодня важные макро-события" : "События сегодня"}
          </h2>
          <span className="text-xs tabular-nums text-muted-foreground">{events.length}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {events.map((e) => {
            const m = metaFor(e.type);
            return (
              <Pill key={e.id} tone={m.tone} dot={e.importance === "high"}>
                <span title={e.description || ""}>{m.label} · {e.name}</span>
              </Pill>
            );
          })}
        </div>
        {(hints.length > 0 || events.some((e) => e.description)) && (
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {hints.slice(0, 2).map((h) => <li key={h}>{h}</li>)}
            {hints.length === 0 && events.filter((e) => e.description).slice(0, 3).map((e) => (
              <li key={e.id}><span className="text-foreground/90">{e.name}:</span> {e.description}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function UpcomingEventsList({ limit = 6, className }: { limit?: number; className?: string }) {
  const { data, isLoading, isError } = useTodayHolidays();
  const upcoming = (data?.upcoming ?? []).slice(0, limit);

  return (
    <section className={cn("glass-panel rounded-2xl", className)} aria-labelledby="upcoming-events-title">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 sm:px-5">
        <h2 id="upcoming-events-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Макро-календарь
        </h2>
        <span className="text-xs text-muted-foreground">14 дней</span>
      </div>
      <div className="px-4 pb-4 pt-2 sm:px-5">
        {isLoading && (
          <div className="flex flex-col gap-2" role="status" aria-label="Загрузка">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-xl" />)}
          </div>
        )}
        {!isLoading && isError && <p className="py-3 text-sm text-muted-foreground">Календарь недоступен</p>}
        {!isLoading && !isError && upcoming.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">Ближайшие 2 недели без крупных событий</p>
        )}
        <ul className="flex flex-col">
          {upcoming.map((e: HolidayEvent) => {
            const m = metaFor(e.type);
            const n = daysUntil(e.date);
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] py-2 last:border-b-0"
                title={e.description || m.hint || ""}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Pill tone={m.tone} dot={e.importance === "high"} className="shrink-0">{m.label}</Pill>
                  <span className="truncate text-sm text-foreground">{e.name}</span>
                </div>
                <div className="flex shrink-0 flex-col items-end leading-tight">
                  <span className={cn("text-xs tabular-nums", n != null && n <= 1 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {relLabel(n)}
                  </span>
                  <span className="text-2xs tabular-nums text-muted-foreground">{shortDate(e.date)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
