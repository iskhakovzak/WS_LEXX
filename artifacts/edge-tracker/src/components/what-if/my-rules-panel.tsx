import { Info, ListChecks } from "lucide-react";
import { EmptyLink, EmptyState, Panel, Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDeskDate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { MyRulesResponse, RuleInAction } from "./api";

/** The rules page (the trader's rules catalogue). */
const RULES_HREF = "/rules";

/**
 * «Мои правила в деле»: the trader's own rules (and rule trials) on the real trades since each was adopted — what the
 * breaks since then cost, and the estimate of what the rule saved (its leak per day before vs since × days since;
 * needs ≥ N trading days on both sides). Rules without an honest what-if twin are listed as «не моделируется».
 */
export function MyRulesPanel({ data, isLoading }: { data: MyRulesResponse | null | undefined; isLoading: boolean }) {
  const { t } = whatIfI18n.useT();
  if (data === null) return null; // an older API without the route
  return (
    <Panel title={t("myRules.title")} icon={ListChecks} description={t("myRules.hint")}>
      {isLoading || !data ? (
        <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : data.team ? (
        <p className="text-sm text-muted-foreground">{t("myRules.team")}</p>
      ) : !data.rules.length ? (
        <EmptyState compact icon={ListChecks} title={t("myRules.emptyTitle")} description={t("myRules.empty")} action={<EmptyLink href={RULES_HREF}>{t("myRules.emptyAction")}</EmptyLink>} />
      ) : (
        <ul className="flex flex-col divide-y divide-border/50">
          {data.rules.map((r) => <RuleRow key={r.id} r={r} minDays={data.minSideDays ?? 10} />)}
        </ul>
      )}
    </Panel>
  );
}

function RuleRow({ r, minDays }: { r: RuleInAction; minDays: number }) {
  const { t } = whatIfI18n.useT();
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  const plain = (v: number) => fmtUsd(Math.abs(v), { decimals: "auto" });
  return (
    <li className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{r.name}</span>
          {r.source === "trial" && <Pill tone="accent">{t("myRules.trial")}</Pill>}
          {r.estimate && <Pill tone="neutral">{t("myRules.estimate")}</Pill>}
        </p>
        <p className="text-xs text-muted-foreground">
          {r.since ? t("myRules.since", { date: fmtDeskDate(r.since, "medium") }) : t("myRules.noSince")}
          {r.label && r.label !== r.name ? ` · ${r.label}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-start gap-0.5 text-xs tabular-nums sm:items-end">
        {r.status === "notModelled" ? (
          <span className="text-muted-foreground">{t("myRules.notModelled")}</span>
        ) : r.after ? (
          <>
            <span className={cn(r.after.cost > 0 ? "text-down" : "text-muted-foreground")}>
              {r.after.broke === 0
                ? t("myRules.kept")
                : r.after.cost >= 0
                  ? t("myRules.cost", { amount: plain(r.after.cost), trades: commonI18n.t("units.trades", { count: r.after.broke }) })
                  : t("myRules.costNeg", { amount: plain(r.after.cost), trades: commonI18n.t("units.trades", { count: r.after.broke }) })}
            </span>
            {r.status === "ok" && r.saved != null ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className={cn("inline-flex items-center gap-1 font-medium underline decoration-dotted underline-offset-2", r.saved >= 0 ? "text-up" : "text-down")}>
                    {r.saved >= 0 ? t("myRules.saved", { amount: plain(r.saved) }) : t("myRules.lost", { amount: plain(r.saved) })}
                    <Info className="h-3 w-3" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  {t("myRules.savedHint", { before: usd(r.before?.perDay ?? 0), days: commonI18n.t("units.tradingDays", { count: r.after.days }) })}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-muted-foreground">{t("myRules.early", { days: minDays })}</span>
            )}
          </>
        ) : null}
      </div>
    </li>
  );
}
