// «Катализаторы» → week: five trading-day columns with the macro calendar, the trader's tickers that report,
// day notes and — for past days — the trader's result. Fixed column height: no layout shift while data loads.
import { ChevronLeft, ChevronRight, Landmark, Lock, StickyNote } from "lucide-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/trading-date";
import { catLabel, fmtUsd, isClosedRow, isShortDayRow } from "./catalyst-math";
import type { CatalystData } from "./use-catalysts";
import { fmtDay, fmtRange, fmtWeekday, macroTime } from "./event-meta";

const MAX_TICKERS = 4;

export function WeekGrid({
  weekStart,
  onWeekChange,
  selected,
  onSelect,
  data,
}: {
  weekStart: string;
  onWeekChange: (ymd: string) => void;
  selected: string;
  onSelect: (ymd: string) => void;
  data: CatalystData;
}) {
  const days = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
  const { today, rows, book, notes, earningsByDate } = data;
  const loading = data.holidays.isLoading || data.trades.isLoading;
  const thisWeek = days.includes(today) || (today > days[4] && today <= addDays(weekStart, 6));

  return (
    <section aria-label="Неделя" className="glass-panel rounded-2xl p-[var(--panel-p)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{fmtRange(days[0], days[4])}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Предыдущая неделя" onClick={() => onWeekChange(addDays(weekStart, -7))}>
            <ChevronLeft className="!size-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={thisWeek} onClick={() => onWeekChange(today)}>Эта неделя</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Следующая неделя" onClick={() => onWeekChange(addDays(weekStart, 7))}>
            <ChevronRight className="!size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {days.map((d) => {
          const dayRows = rows.filter((r) => r.date.slice(0, 10) === d);
          const closed = dayRows.find(isClosedRow);
          const short = dayRows.find(isShortDayRow);
          const macro = dayRows.filter((r) => r.type.toLowerCase() !== "holiday" && !/FOMC begins/i.test(r.description ?? ""));
          const cats = data.cats.get(d);
          // Reports on their calendar date (AMC moves the next open — shown in the day brief).
          const reporters = earningsByDate.get(d) ?? [];
          const result = book.get(d);
          const past = d < today;
          const isToday = d === today;
          const dayNotes = notes.get(d) ?? [];
          const isSel = d === selected;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelect(d)}
              aria-pressed={isSel}
              aria-label={`${fmtWeekday(d, "long")}, ${fmtDay(d, { day: "numeric", month: "long" })}`}
              className={cn(
                "flex min-h-[196px] min-w-0 flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors duration-[var(--dur-1)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSel ? "border-primary/60 bg-primary/5" : "border-[var(--glass-border)] hover:bg-[var(--glass-hover-bg)]",
                closed && "opacity-70",
              )}
            >
              <span className="flex items-baseline justify-between gap-1">
                <span className={cn("text-sm font-semibold", isToday ? "text-primary" : "text-foreground")}>{fmtWeekday(d)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{fmtDay(d)}</span>
              </span>

              {loading ? (
                <span className="flex flex-col gap-1.5">
                  <Skeleton className="h-5 w-3/4 rounded-full" />
                  <Skeleton className="h-5 w-1/2 rounded-full" />
                </span>
              ) : closed ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Закрыто · {closed.name}</span>
              ) : (
                <span className="flex flex-col gap-1">
                  {short && <Pill tone="warn">Короткий день · 13:00</Pill>}
                  {macro.map((r) => (
                    <span key={`${r.type}-${r.name}`} className="flex min-w-0 items-center gap-1.5 text-xs">
                      <Landmark className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate font-medium text-foreground" title={r.name}>{shortMacro(r.type, r.name)}</span>
                      {macroTime(r.description) && <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{macroTime(r.description)!.replace(" ET", "")}</span>}
                    </span>
                  ))}
                  {!macro.length && !short && !cats && <span className="text-xs text-muted-foreground">без макро</span>}
                </span>
              )}

              {!closed && reporters.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {reporters.slice(0, MAX_TICKERS).map((e) => (
                    <span key={e.ticker} className="rounded-md bg-[var(--glass-bg)] px-1.5 py-0.5 text-xs font-medium text-foreground" title={`${e.ticker} · ${e.company}`}>
                      {e.ticker}<span className="ml-1 text-muted-foreground">{e.callType === "AMC" ? "после закр." : e.callType === "BMO" ? "до откр." : ""}</span>
                    </span>
                  ))}
                  {reporters.length > MAX_TICKERS && <span className="px-1 py-0.5 text-xs text-muted-foreground">ещё {reporters.length - MAX_TICKERS}</span>}
                </span>
              )}

              <span className="mt-auto flex flex-col gap-1">
                {dayNotes.length > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StickyNote className="h-3 w-3" aria-hidden="true" /> заметок: {dayNotes.length}
                  </span>
                )}
                {past && !closed && (
                  result ? (
                    <span className="flex items-baseline justify-between gap-1 border-t border-[var(--glass-border)] pt-1.5 text-xs">
                      <span className="text-muted-foreground">{result.n} сд.</span>
                      <span className={cn("font-semibold tabular-nums", toneText(toneOf(result.net)))}>{fmtUsd(result.net)}</span>
                    </span>
                  ) : (
                    <span className="border-t border-[var(--glass-border)] pt-1.5 text-xs text-muted-foreground">без сделок</span>
                  )
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Отчёты — по вашим тикерам (вотчлист и самые торгуемые), на 2 недели вперёд. Выберите день, чтобы увидеть детали.
      </p>
    </section>
  );
}

function shortMacro(type: string, name: string) {
  const t = type.toLowerCase();
  if (t === "fomc") return "FOMC · решение";
  if (t === "quad_witching") return "Квартальная экспирация";
  if (t === "opex") return "Экспирация";
  if (t === "month_end") return "Конец месяца";
  if (t === "cpi" || t === "ppi" || t === "nfp") return catLabel(t);
  return name;
}
