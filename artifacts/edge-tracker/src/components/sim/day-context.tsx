/**
 * «Контекст дня» (owner 2026-10-25): what a trader reads before a gap day — the gap and its direction, the catalyst
 * (report / news, when it came out, the headline with the company masked until the reveal; server lib/sim/catalyst.ts
 * decides what may be shown), the market cap bucket, the float and the premarket volume. One compact card for the
 * game side column, the brief card and «Найди вход». After the reveal the full headline, its time and the link.
 */
import { ArrowDownRight, ArrowUpRight, ExternalLink, FileText, Newspaper } from "lucide-react";
import { Pill } from "@/components/ds";
import { fmtCompact, fmtDeskDateTime, fmtPct, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import type { TrainerCatalyst, TrainerDayContext } from "@/lib/trainer/types";

type T = ReturnType<typeof simI18n.useT>["t"];

/** Pure: the one line a catalyst shows (masked headline, analyst action or a generic line from its type). */
export function catalystLine(c: TrainerCatalyst, t: T): string {
  const a = c.analyst;
  if (a) {
    if (a.action === "targets") return t("day.analyst.targets", { count: a.firms ?? 0 });
    const k = a.action === "up" ? "up" : a.action === "down" ? "down" : a.action === "init" ? "init" : null;
    const head = k ? t(`day.analyst.${k}`) : t("day.kind.news");
    const grades = a.from && a.to ? t("day.analyst.grades", { from: a.from, to: a.to }) : a.to ? t("day.analyst.to", { to: a.to }) : null;
    return [head, a.firm, grades].filter(Boolean).join(" · ");
  }
  if (c.full?.headline) return c.full.headline;
  if (c.headline) return c.headline;
  if (c.kind === "earnings") return t("day.generic.earnings");
  if (c.timing === "session") return t("day.generic.session");
  return t(c.source === "event" || c.source === "big7" ? "day.generic.event" : "day.generic.news");
}

/** Pure: «$1.2B · смолл-кэп», or the bucket alone when the server holds the figure back (mega cap, before the reveal). */
export function capLine(cap: NonNullable<TrainerDayContext["cap"]>, t: T): string {
  const bucket = t(`day.capBucket.${cap.bucket}`);
  return cap.usd != null ? `${fmtUsd(cap.usd, { compact: true })} · ${bucket}` : bucket;
}

export function DayContextCard({ day, revealed, compact = false, className }: { day: TrainerDayContext; revealed: boolean; compact?: boolean; className?: string }) {
  const { t } = simI18n.useT();
  const gap = day.gapPct;
  const up = gap != null && gap > 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const shown = compact ? day.catalysts.slice(0, 2) : day.catalysts.slice(0, 4);
  return (
    <section className={cn("tile flex flex-col gap-2 rounded-xl p-3", className)} aria-label={t("day.title")} data-testid="sim-day-context">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold">{t("day.title")}</p>
        {gap != null && (
          <span className={cn("flex items-center gap-0.5 text-base font-semibold tabular-nums leading-none", up ? "text-up" : "text-down")} title={t(day.gapAt === "open" ? "day.gapOpen" : "day.gapPre")}>
            <Arrow className="h-4 w-4" aria-hidden="true" />
            {t("day.gap")} {fmtPct(gap, { decimals: 1 })}
            <span className="sr-only">{t(up ? "day.gapUp" : "day.gapDown")}</span>
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {shown.map((c, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={c.kind === "earnings" ? "accent" : "neutral"}>
                  {c.kind === "earnings" ? <FileText aria-hidden="true" /> : <Newspaper aria-hidden="true" />}
                  {t(`day.kind.${c.kind}`)}
                </Pill>
                {c.timing && <span className="text-2xs text-muted-foreground">{t(`day.timing.${c.timing}`)}</span>}
              </div>
              <p className={cn("text-xs leading-snug", compact && "line-clamp-2")}>{catalystLine(c, t)}</p>
              {(c.publisher || c.full?.at || c.full?.url) && (
                <p className="flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                  {c.publisher && !c.analyst && <span>{t("day.source", { name: c.publisher })}</span>}
                  {c.full?.at && c.full.at.length > 10 && <span className="tabular-nums">{fmtDeskDateTime(c.full.at)}</span>}
                  {c.full?.url && (
                    <a href={c.full.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
                      {t("day.link")}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </p>
              )}
            </li>
          ))}
          {!revealed && shown.some((c) => c.headline != null) && <li className="text-2xs text-muted-foreground">{t("day.masked")}</li>}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="col-span-2 min-w-0">
          <dt className="text-2xs text-muted-foreground">{t("day.cap")}</dt>
          <dd className="truncate tabular-nums" title={day.cap ? `${t(day.cap.basis === "day" ? "day.capDay" : "day.capNow")}${day.cap.usd == null ? ` · ${t("day.capHidden")}` : ""}` : undefined}>
            {day.cap ? capLine(day.cap, t) : t("day.none")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-muted-foreground">{t("day.float")}</dt>
          <dd className="truncate tabular-nums" title={t("day.floatHint")}>{day.floatShares != null ? fmtCompact(day.floatShares) : t("day.none")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs text-muted-foreground">{t("day.pmVolume")}</dt>
          <dd className="truncate tabular-nums">{day.pmVolume != null ? fmtCompact(day.pmVolume) : t("day.none")}</dd>
        </div>
      </dl>
      {!compact && <p className="text-2xs text-muted-foreground">{t("day.rule", { min: day.minGapPct })}</p>}
    </section>
  );
}
