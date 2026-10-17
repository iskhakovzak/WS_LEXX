import * as React from "react";
import { ArrowUpRight, History, ListChecks, Target, TrendingUp } from "lucide-react";
import { EmptyState, Panel, Pill, ProgressRing } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { cn } from "@/lib/utils";
import { useEvaluation, useHistory, useProposals } from "./use-scaling";
import { TierLadder } from "./ladder";
import { RuleList } from "./rule-list";
import { MetricsGrid } from "./metrics-grid";
import { TierCompare } from "./tier-compare";
import { HistoryTimeline } from "./history-timeline";
import { ProposalCard } from "./proposal-card";
import { ACTION_META } from "./format";
import { fmtUsd } from "@/lib/format";

/** Trader's personal plan: where I am, what is missing until the next tier, what I get there, my history. */
export function MyView({ trader, onUpdatedAt }: { trader: string; onUpdatedAt?: (ts: number) => void }) {
  const ev = useEvaluation(trader);
  const history = useHistory(trader);
  const proposals = useProposals("all", trader);
  React.useEffect(() => { if (ev.dataUpdatedAt) onUpdatedAt?.(ev.dataUpdatedAt); }, [ev.dataUpdatedAt, onUpdatedAt]);

  if (ev.isError) return <Panel><QueryError error={ev.error} onRetry={() => ev.refetch()} title="Не удалось загрузить ваш план" /></Panel>;
  if (ev.isLoading || !ev.data) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  const data = ev.data;
  const me = data.traders.find((t) => t.trader === trader) ?? data.traders[0];
  if (!me) {
    return <Panel><EmptyState icon={Target} title="Вы пока не в плане масштабирования" description="Куратор назначит стартовый тир — после этого здесь появятся условия роста." /></Panel>;
  }
  const a = ACTION_META[me.recommendation.action];
  const promote = me.rules.filter((r) => r.kind === "promote");
  const demote = me.rules.filter((r) => r.kind === "demote");
  const w20 = me.windows.find((w) => w.windowDays === 20) ?? me.windows[0];
  const pct = me.progress == null ? 0 : Math.round(me.progress * 100);
  const pendingList = (proposals.data?.proposals ?? []).filter((p) => p.status === "pending");
  const decided = (proposals.data?.proposals ?? []).filter((p) => p.status !== "pending").slice(0, 3);

  return (
    <div className="grid gap-4 lg:grid-cols-3 sm:gap-5">
      {/* Hero: current tier + progress ring */}
      <Panel className="lg:col-span-2" bodyClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Ваш тир</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-semibold tracking-tight text-foreground">{me.tier?.name ?? "Без тира"}</span>
              <Pill tone={a.tone} dot>{a.label}</Pill>
              {me.recommendation.warning && <Pill tone="warn">нужен разбор с куратором</Pill>}
            </div>
            {me.tier?.description && <p className="text-xs text-muted-foreground">{me.tier.description}</p>}
          </div>
          <div className="flex items-center gap-3">
            <ProgressRing value={pct} size={72} stroke={6} tone={pct >= 100 ? "up" : "accent"} ariaLabel="Прогресс до следующего тира" label={<span className="text-sm">{pct}%</span>} />
            <div className="text-sm">
              <div className="font-medium text-foreground">{me.nextTier ? `До тира «${me.nextTier.name}»` : "Вы на верхнем тире"}</div>
              <div className="text-xs text-muted-foreground">{me.promotePassed} из {me.promoteTotal} условий</div>
              {me.nextTier?.accountSize != null && (
                <div className="text-xs text-muted-foreground">BP станет {fmtUsd(me.nextTier.accountSize, { compact: true })}</div>
              )}
            </div>
          </div>
        </div>
        <TierLadder tiers={data.tiers} current={me.tierKey} target={me.recommendation.toTier?.key} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Buying power" value={fmtUsd(me.limits?.accountSize ?? me.tier?.accountSize ?? null, { compact: true })} />
          <Kpi label="Дневной лимит" value={fmtUsd(me.limits?.dailyLossLimit ?? me.tier?.dailyLossLimit ?? null, { decimals: 0 })} />
          <Kpi label="Макс. позиция" value={fmtUsd(me.limits?.maxPositionUsd ?? me.tier?.maxPositionUsd ?? null, { compact: true })} />
          <Kpi label="Овернайт / свинг" value={`${(me.limits?.allowOvernight ?? me.tier?.allowOvernight) ? "да" : "нет"} / ${(me.limits?.allowSwing ?? me.tier?.allowSwing) ? "да" : "нет"}`} />
        </div>
        {pendingList.map((p) => <ProposalCard key={p.id} proposal={p} tiers={data.tiers} canDecide={false} />)}
      </Panel>

      {/* What the next tier gives */}
      <Panel title={me.nextTier ? `Что даёт «${me.nextTier.name}»` : "Ваши лимиты"} icon={ArrowUpRight}>
        <TierCompare current={me.tier} limits={me.limits} next={me.nextTier} />
      </Panel>

      {/* Checklist */}
      <Panel className="lg:col-span-2" title="До следующего тира" description={me.missing.length ? `Не хватает: ${me.missing.length} из ${me.promoteTotal}` : me.nextTier ? "Все условия выполнены — ждите решения куратора" : "Правила верхнего тира"} icon={ListChecks}>
        <div className="flex flex-col gap-4">
          <RuleList rules={[...promote].sort((x, y) => (x.status === "pass" ? 1 : 0) - (y.status === "pass" ? 1 : 0))} metrics={data.meta.metrics} emptyText="Для вашего тира нет условий повышения" />
          {demote.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="micro-label">Что ведёт к понижению</h3>
              <RuleList rules={demote} metrics={data.meta.metrics} />
            </section>
          )}
        </div>
      </Panel>

      {/* History */}
      <Panel title="История" icon={History}>
        <div className="flex flex-col gap-4">
          {decided.length > 0 && (
            <div className="flex flex-col gap-2">
              {decided.map((p) => <ProposalCard key={p.id} proposal={p} tiers={data.tiers} canDecide={false} />)}
            </div>
          )}
          <HistoryTimeline entries={history.data?.history ?? []} tiers={data.tiers} loading={history.isLoading} limit={8} />
        </div>
      </Panel>

      <Panel className="lg:col-span-3" title="Метрики окна" description="Те же цифры, по которым считаются правила" icon={TrendingUp}>
        <MetricsGrid window={w20} metrics={data.meta.metrics} />
      </Panel>
    </div>
  );
}

function Kpi({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass-panel flex flex-col gap-0.5 rounded-xl px-3 py-2", className)}>
      <span className="truncate text-2xs text-muted-foreground">{label}</span>
      <span className="truncate text-base font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
