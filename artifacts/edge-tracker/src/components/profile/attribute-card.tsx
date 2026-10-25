/**
 * «Характеристика» — the scouting card: radar on the left, the eight attributes as rows on the right (score bar with
 * the desk-median tick, the numbers behind it, the sample). Low-sample rows say «мало данных» and show a hatched bar.
 */
import { Radar as RadarIcon } from "lucide-react";
import { Panel } from "@/components/ds";
import { cn } from "@/lib/utils";
import { profileI18n } from "@/i18n/ns/profile";
import type { Attribute } from "./api";
import { attrExplain, attrName, attrValueText, attrWhat, orderedAttributes, sampleText } from "./model";
import { AttributeRadar } from "./radar";

/** Diagonal hatch over a low-sample bar (never a solid, confident fill). */
const HATCH = "repeating-linear-gradient(135deg, hsl(var(--primary) / 0.55) 0 3px, transparent 3px 7px)";

function scoreTone(a: Attribute): string {
  if (a.low || a.score === null) return "text-muted-foreground";
  if (a.score >= 70) return "text-up";
  if (a.score < 40) return "text-down";
  return "text-foreground";
}

function AttributeRow({ a }: { a: Attribute }) {
  const { t } = profileI18n.useT();
  const width = a.score === null ? 0 : a.score;
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="text-sm font-semibold text-foreground">{attrName(a.key)}</span>
          <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{attrWhat(a.key)}</span>
        </span>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", scoreTone(a))}>{attrValueText(a)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted/60" aria-hidden="true">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", a.low ? "bg-primary/25" : "bg-primary")}
          style={{ width: `${width}%`, backgroundImage: a.low ? HATCH : undefined }}
        />
        {a.deskMedian !== null && (
          <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-muted-foreground/80" style={{ left: `calc(${a.deskMedian}% - 1px)` }} />
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {attrExplain(a)}
        <span className="whitespace-nowrap">
          {" · "}{sampleText(a)}
          {a.deskMedian !== null && <>{" · "}{t("card.desk", { value: a.deskMedian })}</>}
        </span>
      </p>
    </li>
  );
}

export function AttributeCard({ attrs, windowDays, className }: { attrs: readonly Attribute[]; windowDays: number; className?: string }) {
  const { t } = profileI18n.useT();
  const list = orderedAttributes(attrs);
  return (
    <Panel title={t("card.title")} description={t("card.description", { days: windowDays })} icon={RadarIcon} className={className}>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <figure className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-2">
          <AttributeRadar attrs={list} className="h-auto w-full" />
          <figcaption className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />{t("card.personLegend")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-muted-foreground bg-muted-foreground/20" aria-hidden="true" />{t("card.deskLegend")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-primary" aria-hidden="true" />{t("card.lowLegend")}</span>
          </figcaption>
        </figure>
        <ul className="flex flex-col divide-y divide-[var(--glass-border)]">
          {list.map((a) => <AttributeRow key={a.key} a={a} />)}
        </ul>
      </div>
    </Panel>
  );
}
