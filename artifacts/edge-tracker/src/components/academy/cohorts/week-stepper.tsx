/**
 * The cohort calendar's week switcher, in the look and keys of the app's day switcher (components/shared/day-stepper):
 * a glass pill ‹ range › and «Сегодня» only while away from the current week. Keys `[` / `]` move a week, `T` returns
 * (physical keys, so the Russian layout works too). DayStepper itself walks days, not week offsets, hence this mirror.
 */
import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTypingTarget } from "@/lib/utils";
import { academyCohortsI18n } from "@/i18n/ns/academyCohorts";
import { commonI18n } from "@/i18n/ns/common";

export function WeekStepper({ offset, onChange, label }: { offset: number; onChange: (next: number) => void; label: React.ReactNode }) {
  const { t } = academyCohortsI18n.useT();
  const { t: ct } = commonI18n.useT();
  const latest = React.useRef({ offset, onChange });
  latest.current = { offset, onChange };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const s = latest.current;
      if (e.code === "BracketLeft") { e.preventDefault(); s.onChange(s.offset - 1); }
      else if (e.code === "BracketRight") { e.preventDefault(); s.onChange(s.offset + 1); }
      else if (e.code === "KeyT" && !e.shiftKey && s.offset !== 0) { e.preventDefault(); s.onChange(0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label={t("cohortsPage.schedule.weekNav")} className="glass-field inline-flex h-9 items-center gap-0.5 rounded-full p-0.5 pointer-coarse:h-11">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full pointer-coarse:h-10 pointer-coarse:w-10" title={t("cohortsPage.schedule.prevWeekKey")} aria-label={t("cohortsPage.schedule.prevWeek")} onClick={() => onChange(offset - 1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="inline-flex h-8 items-center gap-1.5 px-2 text-sm font-medium tabular-nums [&_svg]:size-4">
          <CalendarDays aria-hidden="true" />
          {label}
        </span>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full pointer-coarse:h-10 pointer-coarse:w-10" title={t("cohortsPage.schedule.nextWeekKey")} aria-label={t("cohortsPage.schedule.nextWeek")} onClick={() => onChange(offset + 1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
      {offset !== 0 && (
        <Button variant="outline" size="sm" className="h-9" onClick={() => onChange(0)} title={ct("dayStepper.todayKey")}>
          {ct("dayStepper.today")}
        </Button>
      )}
    </div>
  );
}
