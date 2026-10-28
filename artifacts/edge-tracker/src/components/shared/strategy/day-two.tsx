/**
 * «Второй день» lines of the morning brief (api lib/catalyst dayTwoHints, stored with the brief digest): yesterday's
 * tickers with a strong catalyst that moved big, each linked to the matching playbook setup when there is one.
 * Codes + params from the server, words from i18n — the line reads the same in every language.
 */
import { Link } from "wouter";
import { CalendarClock } from "lucide-react";
import { toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/lib/format";
import { strategyI18n } from "@/i18n/ns/strategy";
import type { DayTwoHint } from "./model";

export function DayTwoLines({ hints, className }: { hints: readonly DayTwoHint[] | null | undefined; className?: string }) {
  const { t } = strategyI18n.useT();
  if (!hints?.length) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        {t("dayTwo.title")}
      </p>
      <ul className="flex flex-col gap-1">
        {hints.map((h) => (
          <li key={h.ticker} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-foreground">
            <span>
              {h.source === "analyst"
                ? t(`dayTwo.lineAnalyst.${h.direction}`, { ticker: h.ticker })
                : t(`dayTwo.line.${h.direction}`, { ticker: h.ticker, move: fmtPct(h.movePct, 1) })}
            </span>
            {h.setupId != null && h.setupName ? (
              <Link href={`/playbook?id=${h.setupId}`} className={cn("rounded-lg border border-border px-2 py-0.5 text-xs hover:bg-[var(--glass-hover-bg)]", toneText(h.direction === "bull" ? "up" : "down"))}>
                {t("dayTwo.watch", { setup: h.setupName })}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">{t("dayTwo.watchAny")}</span>
            )}
            <span className="text-xs text-muted-foreground">· {t(`dayTwo.source.${h.source}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
