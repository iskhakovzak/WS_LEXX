import { ChevronDown, TriangleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDeskDate, fmtUsd } from "@/lib/format";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { Why } from "./api";

/** Half of the effect or more on the best day (api lib/whatIfWhy ONE_DAY_SHARE). */
export const ONE_DAY_SHARE = 0.5;

/** The «Почему» headline of a card: the share of the best day, flagged when one day carries half of the effect or more. */
export function whyHeadline(w: Why): { key: "oneDay" | "spread" | "none"; pct: number; lucky: boolean } {
  if (w.topDayShare == null || w.total <= 0) return { key: "none", pct: 0, lucky: false };
  const pct = Math.round(w.topDayShare * 100);
  return { key: w.topDayShare >= ONE_DAY_SHARE ? "oneDay" : "spread", pct, lucky: w.topDayShare >= ONE_DAY_SHARE };
}

/**
 * «Почему» under a suggestion card: one line that reads as a sentence (how much of the effect is the best day — a rule
 * carried by one lucky day is flagged), opening the 3 days and the 3 trades that moved the number most in a popover
 * over the card, so the card (and its row of the grid) keeps its height. Each day opens its report.
 */
export function WhyFold({ why, onDay }: { why: Why; onDay?: (day: string) => void }) {
  const { t } = whatIfI18n.useT();
  const h = whyHeadline(why);
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  if (!why.topTrades.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full items-start gap-1.5 rounded-lg py-0.5 text-left text-xs leading-snug transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            h.lucky ? "text-[hsl(var(--warn))] hover:text-[hsl(var(--warn))]" : "text-muted-foreground",
          )}
          title={h.lucky ? t("why.luckyHint") : undefined}
        >
          {h.lucky && <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {/* One flowing sentence: «Почему: лучший день — 46% эффекта». */}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{t("why.toggle")}</span>
            {h.key !== "none" && <>: {t(`why.${h.key}`, { pct: h.pct })}</>}
          </span>
          <ChevronDown className="mt-px h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--dur-1)] group-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-3 text-xs">
        <div className="flex flex-col gap-3 tabular-nums">
          <div className="min-w-0">
            <p className="mb-0.5 font-medium text-foreground">{t("why.days")}</p>
            <ul className="flex flex-col gap-0.5">
              {why.topDays.map((d) => (
                <li key={d.day} className="flex items-center justify-between gap-2">
                  {onDay ? (
                    <button type="button" onClick={() => onDay(d.day)} className="truncate text-left text-primary underline-offset-2 hover:underline">{fmtDeskDate(d.day, "dayMonth")}</button>
                  ) : <span className="truncate">{fmtDeskDate(d.day, "dayMonth")}</span>}
                  <span className={d.delta >= 0 ? "text-up" : "text-down"}>{usd(d.delta)}</span>
                </li>
              ))}
            </ul>
            {why.withoutTopDay != null && <p className="mt-1 text-muted-foreground">{t("why.withoutTop", { amount: usd(why.withoutTopDay) })}</p>}
          </div>
          <div className="min-w-0">
            <p className="mb-0.5 font-medium text-foreground">{t("why.trades")}</p>
            <ul className="flex flex-col gap-0.5">
              {why.topTrades.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2" title={t(x.kind === "removed" ? "why.removedHint" : "why.changedHint", { net: usd(x.net) })}>
                  <span className="min-w-0 truncate"><span className="font-medium">{x.ticker}</span> <span className="text-muted-foreground">{fmtDeskDate(x.day, "dayMonth")}</span></span>
                  <span className={x.contribution >= 0 ? "text-up" : "text-down"}>{usd(x.contribution)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
