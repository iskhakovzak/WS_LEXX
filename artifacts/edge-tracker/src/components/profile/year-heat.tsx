/**
 * «Год торговли» — 53 weeks × 5 weekdays, each traded day tinted by its net (shared heat ramp: profit / loss hue,
 * intensity by |net| against the year's max). On narrow screens the strip scrolls sideways, opened at the latest week,
 * with the edge of earlier weeks peeking out.
 */
import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Panel } from "@/components/ds";
import { heatFill, HEAT_FLAT } from "@/components/shared/charts";
import { fmtDate, fmtUsd, fmtWeekday } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { profileI18n } from "@/i18n/ns/profile";
import type { ProfileResponse } from "./api";
import { heatGrid, monthShort } from "./model";

const CELL = 13;
const GAP = 3;

export function YearHeat({ calendar, today, className }: { calendar: ProfileResponse["calendar"]; today: string; className?: string }) {
  const { t } = profileI18n.useT();
  const grid = React.useMemo(() => heatGrid(calendar, today), [calendar, today]);
  const scroller = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [grid]);
  const width = grid.weeks.length * (CELL + GAP);

  return (
    <Panel title={t("heat.title")} description={t("heat.description")} icon={CalendarDays} className={className}>
      {!calendar.length ? (
        <p className="text-sm text-muted-foreground">{t("heat.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="grid shrink-0 pt-5 text-2xs text-muted-foreground" style={{ gridTemplateRows: `repeat(5, ${CELL}px)`, rowGap: GAP }} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((d) => <span key={d} className="leading-[13px]">{d % 2 === 0 ? fmtWeekday(d + 1, "short") : ""}</span>)}
            </div>
            <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pb-1 [scrollbar-width:thin]" role="img" aria-label={t("heat.title")}>
              <div style={{ width }} className="relative">
                <div className="relative h-5 text-2xs text-muted-foreground" aria-hidden="true">
                  {grid.months.filter((m, i) => i > 0 || grid.months.length === 1 || (grid.months[1]?.col ?? 99) > 2).map((m) => (
                    <span key={`${m.col}-${m.month}`} className="absolute top-0" style={{ left: m.col * (CELL + GAP) }}>{monthShort(m.month)}</span>
                  ))}
                </div>
                <div className="grid grid-flow-col" style={{ gridTemplateRows: `repeat(5, ${CELL}px)`, gridAutoColumns: `${CELL}px`, gap: GAP }}>
                  {grid.weeks.flatMap((w) => w.cells.map((c) => {
                    const traded = c.net !== null;
                    const fill = traded ? (c.net === 0 ? HEAT_FLAT : heatFill(c.net, grid.max)) : undefined;
                    const tip = traded
                      ? t("heat.cell", { date: fmtDate(c.day, "medium"), net: fmtUsd(c.net, { signed: true }), trades: commonI18n.t("units.trades", { count: c.trades }) })
                      : fmtDate(c.day, "medium");
                    return (
                      <span
                        key={c.day}
                        title={c.future ? undefined : tip}
                        className={c.future ? "rounded-[3px]" : traded ? "rounded-[3px]" : "rounded-[3px] bg-muted/50"}
                        style={{ background: fill, opacity: c.future ? 0 : 1 }}
                      />
                    );
                  }))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 text-2xs text-muted-foreground" aria-hidden="true">
            <span>{t("heat.less")}</span>
            {[-1, -0.5, 0.5, 1].map((k) => <span key={k} className="h-3 w-3 rounded-[3px]" style={{ background: heatFill(k * Math.max(1, grid.max), Math.max(1, grid.max)) }} />)}
            <span>{t("heat.more")}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
