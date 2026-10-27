/**
 * The week switcher of /weekly-review: the same look and keys as the app's day switcher (components/shared/day-stepper),
 * one step = one Mon–Fri week.
 *
 *   [ ‹ ]  [ 📅 13–17 окт. ]  [ › ]   [ К текущей ]
 *
 * - The label opens a calendar; picking any day opens its week. Weeks after `max` are disabled.
 * - «К текущей» shows only when away from the current week.
 * - Keys: `[` previous, `]` next, `T` current week (physical keys, so they work on the Russian layout too).
 */
import * as React from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, isTypingTarget } from "@/lib/utils";
import { weeklyI18n } from "@/i18n/ns/weeklyReview";
import { shiftWeek, weekKeyOf, weekLabel, weekStartOf } from "./api";

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (ymd: string) => new Date(`${ymd}T12:00:00`);

export function WeekStepper({
  value,
  onChange,
  max,
  home,
  hotkeys = true,
  className,
  children,
}: {
  /** ISO week key (YYYY-Www). */
  value: string;
  onChange: (week: string) => void;
  /** The latest week (inclusive). */
  max: string;
  /** Where «К текущей» / T goes. */
  home: string;
  hotkeys?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const { t } = weeklyI18n.useT();
  const [calOpen, setCalOpen] = React.useState(false);
  const prev = shiftWeek(value, -1);
  const next = shiftWeek(value, 1);
  const canNext = value < max;
  const start = weekStartOf(value);

  const latest = React.useRef({ onChange, prev, next, home, canNext, value });
  latest.current = { onChange, prev, next, home, canNext, value };
  React.useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const s = latest.current;
      if (e.code === "BracketLeft") { e.preventDefault(); s.onChange(s.prev); }
      else if (e.code === "BracketRight" && s.canNext) { e.preventDefault(); s.onChange(s.next); }
      else if (e.code === "KeyT" && !e.shiftKey && s.value !== s.home) { e.preventDefault(); s.onChange(s.home); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys]);

  const maxStart = weekStartOf(max);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <nav aria-label={t("page.weekNav")} className="glass-field inline-flex h-9 items-center gap-0.5 rounded-full p-0.5 pointer-coarse:h-11">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full pointer-coarse:h-10 pointer-coarse:w-10" title={t("page.prevWeekKey")} aria-label={t("page.prevWeek")} onClick={() => onChange(prev)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 min-w-[8.5rem] rounded-full px-2.5 tabular-nums pointer-coarse:h-10" aria-label={t("page.pickWeek", { week: weekLabel(value) })}>
              <CalendarRange aria-hidden="true" />
              {weekLabel(value)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="center">
            <Calendar
              mode="single"
              selected={start ? dateOf(start) : undefined}
              defaultMonth={start ? dateOf(start) : undefined}
              weekStartsOn={1}
              disabled={(d: Date) => !!maxStart && weekKeyOf(ymdOf(d)) > max}
              onSelect={(d: Date | undefined) => {
                if (!d) return;
                onChange(weekKeyOf(ymdOf(d)));
                setCalOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full pointer-coarse:h-10 pointer-coarse:w-10" title={t("page.nextWeekKey")} aria-label={t("page.nextWeek")} disabled={!canNext} onClick={() => onChange(next)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
      {value !== home && (
        <Button variant="outline" size="sm" className="h-9" onClick={() => onChange(home)} title={t("page.toCurrentKey")}>
          {t("page.toCurrent")}
        </Button>
      )}
      {children}
    </div>
  );
}
