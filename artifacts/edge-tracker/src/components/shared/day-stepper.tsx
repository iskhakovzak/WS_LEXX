/**
 * The ONE day switcher of the app (design audit wave 3): every screen that shows one day (/game-plan, /journal,
 * /day-report, /dailyfeed, /offerings, /author-notes, /desk-day…) uses it, so the day moves the same way everywhere.
 *
 *   [ ‹ ]  [ 📅 пн, 27 окт. ]  [ › ]   [ Сегодня ]
 *
 * - ‹ › step session days (weekends and NYSE holidays skipped, `step="calendar"` for pages about calendar days).
 * - The date opens a calendar; days after `max` are disabled.
 * - «Сегодня» (or the page's own home: «Последний день», «Следующая сессия») shows only when away from it.
 * - Keys: `[` previous, `]` next, `T` home (physical keys, so they work on the Russian layout too). Pages that had ←/→
 *   keep them with `arrows`.
 * The page owns the date (and its URL param); this component only reads `value` and calls `onChange`.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { http } from "@/lib/api/http";
import { fmtDate } from "@/lib/format";
import { addDays, isSessionDay, nyDate, stepSessionDay } from "@/lib/trading-date";
import { cn, isTypingTarget } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";

type HolidayEvent = { date: string; type: string; earlyClose?: boolean };

/** NYSE closed days (full holidays, not the 13:00 early closes) around the year of `date`. Cached for hours. */
export function useClosedDays(date: string): ReadonlySet<string> | undefined {
  const year = Number(date.slice(0, 4)) || new Date().getFullYear();
  return useQuery({
    queryKey: ["market-closed-days", year],
    queryFn: async ({ signal }) => {
      const j = await http.get<{ events?: HolidayEvent[] }>("/api/holidays", { query: { from: `${year - 1}-12-01`, to: `${year + 1}-01-31`, types: "holiday" }, signal });
      return new Set((j.events ?? []).filter((e) => String(e.type).toLowerCase() === "holiday" && e.earlyClose !== true).map((e) => String(e.date).slice(0, 10)));
    },
    staleTime: 6 * 60 * 60_000,
    retry: false,
  }).data;
}

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (ymd: string) => new Date(`${ymd}T12:00:00`);

export function DayStepper({
  value,
  onChange,
  max,
  min,
  step = "session",
  home,
  homeLabel,
  homeTitle,
  label,
  arrows = false,
  hotkeys = true,
  className,
  children,
}: {
  /** YYYY-MM-DD. */
  value: string;
  onChange: (date: string) => void;
  /** The latest day (default: none; pass today to keep the future out). */
  max?: string;
  min?: string;
  /** «session» skips weekends and market holidays; «calendar» walks every day. */
  step?: "session" | "calendar";
  /** Where «Сегодня» / T goes (default: NY today). */
  home?: string;
  /** The home button's text (default «Сегодня»). */
  homeLabel?: string;
  homeTitle?: string;
  /** The date's text (default «пн, 27 окт.»). */
  label?: React.ReactNode;
  /** Also bind ← / → (pages that always had them). */
  arrows?: boolean;
  /** Off while the page shows an editor that owns the keyboard. */
  hotkeys?: boolean;
  className?: string;
  /** Quiet extras after the switcher (a «неторговый день» pill, a link). */
  children?: React.ReactNode;
}) {
  const t = commonI18n.t;
  const [calOpen, setCalOpen] = React.useState(false);
  const closed = useClosedDays(value);
  const target = home ?? nyDate();
  const clamp = React.useCallback((d: string) => (max && d > max ? max : min && d < min ? min : d), [max, min]);
  const move = React.useCallback(
    (dir: 1 | -1) => clamp(step === "calendar" ? addDays(value, dir) : stepSessionDay(value, dir, closed)),
    [clamp, step, value, closed],
  );
  const prev = move(-1);
  const next = move(1);
  const canPrev = prev !== value;
  const canNext = next !== value && !(max && value >= max);

  const latest = React.useRef({ onChange, prev, next, target, canPrev, canNext, value });
  latest.current = { onChange, prev, next, target, canPrev, canNext, value };
  React.useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const s = latest.current;
      const back = e.code === "BracketLeft" || (arrows && e.key === "ArrowLeft" && !e.shiftKey);
      const fwd = e.code === "BracketRight" || (arrows && e.key === "ArrowRight" && !e.shiftKey);
      if (back && s.canPrev) { e.preventDefault(); s.onChange(s.prev); }
      else if (fwd && s.canNext) { e.preventDefault(); s.onChange(s.next); }
      else if (e.code === "KeyT" && !e.shiftKey && s.value !== s.target) { e.preventDefault(); s.onChange(s.target); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, arrows]);

  const offDay = step === "session" && !isSessionDay(value, closed);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <nav aria-label={t("dayStepper.nav")} className="glass-field inline-flex h-9 items-center gap-0.5 rounded-full p-0.5 pointer-coarse:h-11">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full pointer-coarse:h-10 pointer-coarse:w-10" title={t("dayStepper.prevKey")} aria-label={t("dayStepper.prev")} disabled={!canPrev} onClick={() => onChange(prev)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 min-w-[8.5rem] rounded-full px-2.5 tabular-nums pointer-coarse:h-10", offDay && "text-muted-foreground")}
              aria-label={t("dayStepper.pick", { date: fmtDate(value, "weekdayDayMonthLong") })}
            >
              <CalendarDays aria-hidden="true" />
              {label ?? fmtDate(value, "weekdayDayMonth")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="center">
            <Calendar
              mode="single"
              selected={dateOf(value)}
              defaultMonth={dateOf(value)}
              weekStartsOn={1}
              disabled={(d: Date) => { const y = ymdOf(d); return (!!max && y > max) || (!!min && y < min); }}
              onSelect={(d: Date | undefined) => {
                if (!d) return;
                onChange(ymdOf(d));
                setCalOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full pointer-coarse:h-10 pointer-coarse:w-10" title={t("dayStepper.nextKey")} aria-label={t("dayStepper.next")} disabled={!canNext} onClick={() => onChange(next)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
      {value !== target && (
        <Button variant="outline" size="sm" className="h-9" onClick={() => onChange(target)} title={homeTitle ?? t("dayStepper.todayKey")}>
          {homeLabel ?? t("dayStepper.today")}
        </Button>
      )}
      {children}
    </div>
  );
}
