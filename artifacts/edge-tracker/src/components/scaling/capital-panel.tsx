/**
 * «Распределение риска» on the scaling desk: the capital allocation engine's per-trader raise / keep / cut of the daily
 * loss limit and BP, the desk view (risk before → after, from → to, expected $ with the 80 % interval), «Пересчитать»,
 * «Одобрить все» and the applied changes with «Откатить». Proposals themselves sit in the scaling queue above.
 */
import * as React from "react";
import { Check, RefreshCw, Scale } from "lucide-react";
import { DataTable, EmptyState, Panel, StatCard, StatGrid } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { capitalI18n } from "@/i18n/ns/capital";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import { personName } from "@/i18n";
import { useApproveAllCapital, useCapitalPlan, useRecomputeCapital, type CapitalDesk, type CapitalPlan } from "./capital-api";
import { CapitalHistory, CapitalRowView } from "./capital-parts";

const usd = (v: number) => fmtUsd(v, { decimals: 0 });
const signedUsd = (v: number) => fmtUsd(v, { decimals: 0, signed: true });

function DeskStats({ desk }: { desk: CapitalDesk }) {
  const { t } = capitalI18n.useT();
  const wk = desk.expectedPerWeek;
  return (
    <StatGrid>
      <StatCard label={t("stats.risk")} value={usd(desk.riskAfter)} hint={t("stats.riskHint", { before: usd(desk.riskBefore), after: usd(desk.riskAfter) })} />
      <StatCard label={t("stats.raise")} value={desk.raised.count} tone={desk.raised.count ? "up" : "neutral"} hint={t("stats.raiseHint", { usd: usd(desk.raised.usd), count: desk.raised.count })} />
      <StatCard label={t("stats.cut")} value={desk.cut.count} tone={desk.cut.count ? "down" : "neutral"} hint={t("stats.cutHint", { usd: usd(desk.cut.usd), count: desk.cut.count })} />
      <StatCard label={t("stats.expected")} value={signedUsd(wk.mean)} tone={wk.lo > 0 ? "up" : wk.hi < 0 ? "down" : "neutral"} hint={t("stats.expectedHint", { lo: signedUsd(wk.lo), hi: signedUsd(wk.hi) })} />
    </StatGrid>
  );
}

function Flows({ desk }: { desk: CapitalDesk }) {
  const { t } = capitalI18n.useT();
  const line = (xs: { trader: string; delta: number }[]) =>
    xs.length ? xs.slice(0, 6).map((x) => `${personName(x.trader)} ${signedUsd(x.delta)}`).join(", ") + (xs.length > 6 ? " …" : "") : t("flowEmpty");
  return (
    <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
      <dt className="text-muted-foreground">{t("flowFrom")}</dt><dd className="text-down">{line(desk.from)}</dd>
      <dt className="text-muted-foreground">{t("flowTo")}</dt><dd className="text-up">{line(desk.to)}</dd>
    </dl>
  );
}

function Header({ plan }: { plan: CapitalPlan }) {
  const { t } = capitalI18n.useT();
  const regime = plan.regime ? marketRegimeI18n.tryT(`regimes.${plan.regime.key}.name`) ?? plan.regime.key : null;
  return (
    <p className="text-xs text-muted-foreground">
      {regime ? t(plan.regime?.source === "week" ? "regimeWeek" : "regime", { regime }) : t("noRegime")}
      {" · "}
      <span className={cn(plan.settings.autoApply && "text-[hsl(var(--chart-3))]")}>{plan.settings.autoApply ? t("autoOn") : t("autoOff")}</span>
      {plan.desk.deskCapApplied && <> · {t("deskCap", { pct: plan.settings.maxDeskGrowthPct })}</>}
    </p>
  );
}

export function CapitalPanel({ canDecide, onOpenTrader }: { canDecide: boolean; onOpenTrader?: (trader: string) => void }) {
  const { t } = capitalI18n.useT();
  const { toast } = useToast();
  const plan = useCapitalPlan();
  const recompute = useRecomputeCapital();
  const approveAll = useApproveAllCapital();
  const [showKeep, setShowKeep] = React.useState(false);
  const data = plan.data;
  const rows = data?.rows ?? [];
  const moving = rows.filter((r) => r.direction !== "keep");
  const keep = rows.length - moving.length;
  const pendingIds = rows.flatMap((r) => (r.pendingId != null ? [r.pendingId] : []));
  const shown = showKeep ? rows : moving;

  const runRecompute = async () => {
    try {
      const r = await recompute.mutateAsync();
      toast({ title: r.created || r.updated || r.withdrawn ? t("recomputed", { created: r.created, updated: r.updated, withdrawn: r.withdrawn }) : t("recomputeNone") });
    } catch (e) {
      toast({ title: t("recomputeFailed"), description: (e as Error).message, variant: "destructive" });
    }
  };
  const runApproveAll = async () => {
    try {
      const r = await approveAll.mutateAsync(pendingIds);
      toast({ title: t("approvedAll", { count: r.approved.length }), description: r.skipped.length ? t("skipped", { count: r.skipped.length }) : undefined });
    } catch (e) {
      toast({ title: t("approveFailed"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const actions = canDecide ? (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={runRecompute} disabled={recompute.isPending}>
        <RefreshCw className={cn("h-3.5 w-3.5", recompute.isPending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        {recompute.isPending ? t("recomputing") : t("recompute")}
      </Button>
      {pendingIds.length > 0 && (
        <Button size="sm" onClick={runApproveAll} disabled={approveAll.isPending} title={t("approveAllTitle")}>
          <PendingIcon pending={approveAll.isPending} icon={Check} className="h-3.5 w-3.5" /> {t("approveAll", { count: pendingIds.length })}
        </Button>
      )}
    </div>
  ) : undefined;

  return (
    <Panel title={t("title")} description={t("description")} icon={Scale} actions={actions}>
      {plan.isError ? (
        <QueryError error={plan.error} onRetry={() => plan.refetch()} title={t("loadFailed")} />
      ) : plan.isLoading || !data ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={Scale} title={t("empty")} />
      ) : (
        <div className="flex flex-col gap-4">
          <Header plan={data} />
          <DeskStats desk={data.desk} />
          <p className="text-2xs text-muted-foreground">{t("expectedNote")}</p>
          <Flows desk={data.desk} />
          {shown.length > 0 && (
            <DataTable maxHeight="50vh" ariaLabel={t("title")}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("col.trader")}</th>
                    <th scope="col">{t("col.decision")}</th>
                    <th scope="col">{t("col.limit")}</th>
                    <th scope="col">{t("col.bp")}</th>
                    <th scope="col" className="text-right">{t("col.edge")}</th>
                    <th scope="col" className="text-right">{t("col.discipline")}</th>
                    <th scope="col">{t("col.why")}</th>
                  </tr>
                </thead>
                <tbody>{shown.map((r) => <CapitalRowView key={r.trader} row={r} onOpenTrader={onOpenTrader} />)}</tbody>
              </table>
            </DataTable>
          )}
          {keep > 0 && (
            <button type="button" className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowKeep((v) => !v)}>
              {showKeep ? t("hideKeep") : t("showKeep", { count: keep })}
            </button>
          )}
          <section aria-label={t("historyTitle")} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t("historyTitle")}</h3>
            <CapitalHistory items={data.history} canDecide={canDecide} />
          </section>
        </div>
      )}
    </Panel>
  );
}
