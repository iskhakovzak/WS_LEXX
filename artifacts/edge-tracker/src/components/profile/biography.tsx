/**
 * «Автобиография» — the career as a strip of monthly net bars (eras) and a vertical timeline of plain sentences built
 * from dated facts (lib/profile/timeline on the server). Long stories open with the beginning and the latest chapter;
 * «Вся история» unfolds the middle. Curator steps are marked as visible to staff only.
 */
import * as React from "react";
import { BookOpenText, ChevronDown, ChevronUp } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { CHART } from "@/components/shared/charts";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { profileI18n } from "@/i18n/ns/profile";
import type { Era, TimelineEvent } from "./api";
import { eraTip, eventText, isHighlightEvent, isStaffOnlyEvent, monthShort, recentEras } from "./model";

const HEAD = 3;
const TAIL = 7;

function EraStrip({ eras }: { eras: Era[] }) {
  const { t } = profileI18n.useT();
  const shown = recentEras(eras);
  const max = Math.max(1, ...shown.map((e) => Math.abs(e.net)));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-xs font-semibold text-muted-foreground">{t("bio.eras")}</figcaption>
      <ul className="flex h-28 items-stretch gap-1" aria-label={t("bio.erasAria")}>
        {shown.map((e) => {
          const h = Math.max(3, (Math.abs(e.net) / max) * 44);
          const up = e.net >= 0;
          return (
            <li key={e.month} className="flex min-w-0 flex-1 flex-col items-center" title={eraTip(e)}>
              <span className="sr-only">{eraTip(e)}</span>
              <span className="flex h-12 w-full items-end justify-center" aria-hidden="true">
                {up && <span className="w-full max-w-6 rounded-t-[4px]" style={{ height: h, background: CHART.up }} />}
              </span>
              <span className="h-px w-full bg-border" aria-hidden="true" />
              <span className="flex h-12 w-full items-start justify-center" aria-hidden="true">
                {!up && <span className="w-full max-w-6 rounded-b-[4px]" style={{ height: h, background: CHART.down }} />}
              </span>
              <span className="mt-0.5 text-2xs text-muted-foreground" aria-hidden="true">{monthShort(Number(e.month.slice(5, 7)) - 1)}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

function EventRow({ e, showYear }: { e: TimelineEvent; showYear: boolean }) {
  const { t } = profileI18n.useT();
  const staff = isStaffOnlyEvent(e);
  return (
    <li className="relative grid grid-cols-[5.5rem_1fr] gap-3 py-2 sm:grid-cols-[7rem_1fr]">
      <span className="pt-0.5 text-right text-xs tabular-nums text-muted-foreground">
        {showYear && <span className="block font-semibold text-foreground">{e.day.slice(0, 4)}</span>}
        {fmtDate(e.day, "dayMonth")}
      </span>
      <span className="relative pl-5">
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[hsl(var(--card))]",
            isHighlightEvent(e) ? "bg-primary" : staff ? "border border-dashed border-muted-foreground bg-transparent" : "bg-muted-foreground/70",
          )}
        />
        <span className={cn("text-sm", isHighlightEvent(e) ? "font-medium text-foreground" : "text-foreground/90")}>{eventText(e)}</span>
        {staff && <span className="ml-2 text-2xs text-muted-foreground">{t("bio.staffOnly")}</span>}
      </span>
    </li>
  );
}

export function Biography({ eras, events, className }: { eras: Era[]; events: TimelineEvent[]; className?: string }) {
  const { t } = profileI18n.useT();
  const [all, setAll] = React.useState(false);
  const long = events.length > HEAD + TAIL + 1;
  const head = long && !all ? events.slice(0, HEAD) : events;
  const tail = long && !all ? events.slice(events.length - TAIL) : [];
  const yearOf = (e: TimelineEvent) => e.day.slice(0, 4);
  const rows = (list: TimelineEvent[], prev: TimelineEvent | undefined) =>
    list.map((e, i) => <EventRow key={`${e.kind}-${e.day}-${i}`} e={e} showYear={yearOf(e) !== yearOf((i ? list[i - 1] : prev) ?? { ...e, day: "0000" })} />);

  return (
    <Panel title={t("bio.title")} description={t("bio.description")} icon={BookOpenText} className={className}>
      {!events.length ? (
        <p className="text-sm text-muted-foreground">{t("bio.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          {eras.length > 0 ? <EraStrip eras={eras} /> : <span />}
          <div className="relative">
            <span className="absolute bottom-3 left-[calc(5.5rem+0.75rem+4px)] top-3 w-px bg-border sm:left-[calc(7rem+0.75rem+4px)]" aria-hidden="true" />
            <ol className="relative flex flex-col">
              {rows(head, undefined)}
            </ol>
            {long && (
              <div className="my-1 flex justify-center">
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setAll((v) => !v)} aria-expanded={all}>
                  {all ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                  {all ? t("bio.showLess") : t("bio.showAll", { count: events.length })}
                </Button>
              </div>
            )}
            {tail.length > 0 && <ol className="relative flex flex-col">{rows(tail, head[head.length - 1])}</ol>}
          </div>
        </div>
      )}
    </Panel>
  );
}
