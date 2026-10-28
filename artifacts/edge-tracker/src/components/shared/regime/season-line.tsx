/**
 * The season calendar next to the desk regime (api GET /market-regime/today → season): a quiet day leads with its
 * limit factor and the day goal («не торговать — нормально»), then a prime earnings week and the event days (quad
 * witching, S&P / MSCI rebalances). Semantic chips beside the limit they change, never a banner (owner UX law 3).
 */
import { CalendarClock } from "lucide-react";
import { Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import type { SeasonDay } from "./api";

export function SeasonLine({ season, className }: { season: SeasonDay | undefined; className?: string }) {
  const { t } = marketRegimeI18n.useT();
  if (!season || (!season.quiet && !season.prime && !season.events.length)) return null;
  return (
    <div aria-label={t("season.aria")} className={cn("flex min-w-0 flex-col gap-1", className)}>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        {season.quiet && (
          <Pill tone="warn" title={t(season.trim ? "season.trimmed" : "season.hintOnly")}>
            {t("season.quiet", { factor: fmtNum(season.factor, 2) })} · {t(season.offSeason ? "season.quietOff" : "season.quietHoliday")}
          </Pill>
        )}
        {season.prime && <Pill tone="accent">{t("season.prime")}</Pill>}
        {season.events.map((e) => <Pill key={e} tone="neutral">{t(`season.event.${e}`)}</Pill>)}
      </p>
      {season.quiet && <p className="text-sm font-medium text-foreground">{t("season.quietGoal")}</p>}
    </div>
  );
}
