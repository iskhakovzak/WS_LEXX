/**
 * «Пульс недели» — the running week of the office against last week and the 4-week mean, its five days as small
 * diverging bars (click a day → the day panel), best / worst day. Computed from the focus year's daily points
 * (pulse.ts), in the page's unit (% of capital or $), so it shows exactly what the viewer may see.
 */
import * as React from "react";
import { Activity } from "lucide-react";
import { Panel, toneOf } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtWeekday } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { officeRecsI18n } from "@/i18n/ns/officeRecs";
import { fmtDay, fmtV } from "./api";
import { addDaysYmd, weeklyPulse } from "./pulse";
import type { Ctx } from "./overview";

const TONE_TEXT = { up: "text-up", down: "text-down", warn: "text-warn", neutral: "text-muted-foreground", accent: "text-primary", purple: "text-primary" } as const;

export function WeeklyPulseCard({ ctx, today, onPickDay, className }: { ctx: Ctx; today: string; onPickDay: (d: string) => void; className?: string }) {
  const { t } = officeRecsI18n.useT();
  const { focus, unit } = ctx;
  const pulse = React.useMemo(() => (focus.year === Number(today.slice(0, 4)) ? weeklyPulse(focus.days, today) : weeklyPulse(focus.days, `${focus.year}-12-31`)), [focus, today]);
  if (!pulse) {
    return <Panel title={t("pulse.title")} icon={Activity} fill className={className}><p className="text-sm text-muted-foreground">{t("pulse.empty")}</p></Panel>;
  }
  const { week, prev, avg4 } = pulse;
  const days = Array.from({ length: 5 }, (_, i) => addDaysYmd(week.from, i));
  const byDate = new Map(focus.days.map((d) => [d.date, d]));
  const max = Math.max(1e-9, ...days.map((d) => Math.abs(byDate.get(d)?.v ?? 0)));
  const delta = (v: number | null) => (v == null ? null : week.net - v);
  const dl = delta(prev.days ? prev.net : null);
  const da = delta(avg4);
  const tone = (v: number | null) => TONE_TEXT[toneOf(v)];
  return (
    <Panel
      title={t("pulse.title")}
      description={pulse.which === "last" ? t("pulse.lastLabel") : t("pulse.weekOf", { date: fmtDay(week.from) })}
      icon={Activity}
      fill
      className={className}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cn("whitespace-nowrap text-2xl font-semibold tabular-nums", tone(week.net))}>{fmtV(week.net, unit)}</span>
          <span className="flex flex-col text-xs leading-tight">
            {dl != null && <span className={tone(dl)}>{t("pulse.vsLast", { value: fmtV(dl, unit) })}</span>}
            {da != null && <span className={tone(da)}>{t("pulse.vsAvg", { weeks: pulse.avg4Weeks, value: fmtV(da, unit) })}</span>}
          </span>
        </div>
        {/* The week's five days: diverging bars around a zero hairline; a day without trades is an empty slot. */}
        <div className="group/days relative grid h-20 grid-cols-5 gap-1.5" role="list" aria-label={t("pulse.title")}>
          <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-foreground/25" aria-hidden="true" />
          {days.map((d, i) => {
            const p = byDate.get(d);
            const v = p?.v ?? 0;
            const h = (Math.abs(v) / max) * 50;
            const label = fmtWeekday(i + 1, "short");
            return (
              <button
                key={d}
                type="button"
                role="listitem"
                disabled={!p}
                onClick={() => p && onPickDay(d)}
                title={p ? `${fmtDay(d)} · ${fmtV(v, unit)} · ${commonI18n.t("units.trades", { count: p.trades })}` : fmtDay(d)}
                aria-label={p ? `${fmtDay(d)}: ${fmtV(v, unit)}` : fmtDay(d)}
                className="relative rounded-md transition-opacity duration-[var(--dur-1)] enabled:hover:bg-[var(--glass-hover-bg)] disabled:cursor-default group-has-[button:hover]/days:[&:not(:hover)]:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {p && v !== 0 && (
                  <span
                    className={cn("absolute inset-x-1.5", v > 0 ? "rounded-t-[5px] rounded-b-[1px]" : "rounded-b-[5px] rounded-t-[1px]")}
                    style={{
                      ...(v > 0 ? { bottom: "50%" } : { top: "50%" }),
                      height: `${Math.max(3, h)}%`,
                      backgroundImage: `linear-gradient(${v > 0 ? "to top" : "to bottom"}, hsl(var(--${v > 0 ? "up" : "down"}) / 0.5), hsl(var(--${v > 0 ? "up" : "down"}) / 0.95))`,
                    }}
                    aria-hidden="true"
                  />
                )}
                <span className="absolute inset-x-0 -bottom-4 text-center text-2xs capitalize text-muted-foreground">{label}</span>
              </button>
            );
          })}
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="tile p-2"><dt className="text-muted-foreground">{t("pulse.days")}</dt><dd className="text-sm font-semibold tabular-nums">{week.days}</dd></div>
          <div className="tile p-2"><dt className="text-muted-foreground">{t("pulse.green")}</dt><dd className="text-sm font-semibold tabular-nums">{week.green}/{week.days}</dd></div>
          <div className="tile p-2"><dt className="text-muted-foreground">{t("pulse.trades")}</dt><dd className="text-sm font-semibold tabular-nums">{week.trades}</dd></div>
        </dl>
        {week.best && week.worst && week.days > 1 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => onPickDay(week.best!.date)}>
              {t("pulse.best")}: <b className={tone(week.best.v)}>{fmtV(week.best.v, unit)}</b> · {fmtDay(week.best.date)}
            </button>
            <button type="button" className="hover:text-foreground" onClick={() => onPickDay(week.worst!.date)}>
              {t("pulse.worst")}: <b className={tone(week.worst.v)}>{fmtV(week.worst.v, unit)}</b> · {fmtDay(week.worst.date)}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
