import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
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
 * «Почему» under a suggestion card: one line (how much of the effect is the best day — a rule carried by one lucky day
 * is flagged), opening the 3 days and the 3 trades that moved the number most. Each day opens its report.
 */
export function WhyFold({ why, onDay }: { why: Why; onDay?: (day: string) => void }) {
  const { t } = whatIfI18n.useT();
  const [open, setOpen] = useState(false);
  const h = whyHeadline(why);
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  if (!why.topTrades.length) return null;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn("inline-flex items-center gap-1 self-start rounded-full text-left underline-offset-2 hover:underline", h.lucky ? "text-[hsl(var(--warn))]" : "text-muted-foreground")}
        title={h.lucky ? t("why.luckyHint") : undefined}
      >
        {h.lucky && <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />}
        <span className="font-medium">{t("why.toggle")}</span>
        {h.key !== "none" && <span>· {t(`why.${h.key}`, { pct: h.pct })}</span>}
        <ChevronDown className={cn("h-3 w-3 transition-transform duration-[var(--dur-1)] motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-2 rounded-xl bg-[var(--glass-bg)] p-2 tabular-nums sm:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-0.5 font-medium text-foreground">{t("why.days")}</p>
            <ul className="flex flex-col gap-0.5">
              {why.topDays.map((d) => (
                <li key={d.day} className="flex items-center justify-between gap-2">
                  {onDay ? (
                    <button type="button" onClick={() => onDay(d.day)} className="truncate text-left text-primary underline-offset-2 hover:underline">{fmtDeskDate(d.day, "medium")}</button>
                  ) : <span className="truncate">{fmtDeskDate(d.day, "medium")}</span>}
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
                  <span className="min-w-0 truncate"><span className="font-medium">{x.ticker}</span> <span className="text-muted-foreground">{fmtDeskDate(x.day, "short")}</span></span>
                  <span className={x.contribution >= 0 ? "text-up" : "text-down"}>{usd(x.contribution)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
