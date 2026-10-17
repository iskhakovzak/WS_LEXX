import * as React from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Pill, ProgressRing, Segmented } from "@/components/ds";
import type { Evaluation, TraderEval } from "./use-scaling";
import { useHistory, useProposals } from "./use-scaling";
import { TierLadder } from "./ladder";
import { RuleList } from "./rule-list";
import { MetricsGrid } from "./metrics-grid";
import { TierCompare } from "./tier-compare";
import { HistoryTimeline } from "./history-timeline";
import { ProposalCard } from "./proposal-card";
import { ProposeButton, TierPopover } from "./curator-actions";
import { ACTION_META } from "./format";

type Tab = "rules" | "metrics" | "limits" | "history";

/** Curator drill-down for one trader: rules, metrics, limits of the next tier, history + proposals. */
export function TraderSheet({
  row,
  evaluation,
  open,
  onOpenChange,
}: {
  row: TraderEval | null;
  evaluation: Evaluation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [tab, setTab] = React.useState<Tab>("rules");
  React.useEffect(() => { if (open) setTab("rules"); }, [open, row?.trader]);
  const history = useHistory(row?.trader ?? null, open && !!row);
  const proposals = useProposals("all", row?.trader ?? null, open && !!row);
  const promote = row?.rules.filter((r) => r.kind === "promote") ?? [];
  const demote = row?.rules.filter((r) => r.kind === "demote") ?? [];
  const w20 = row?.windows.find((w) => w.windowDays === 20) ?? row?.windows[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {row && (
          <div className="flex flex-col gap-5">
            <SheetHeader className="pr-10 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-xl">{row.trader}</SheetTitle>
                <Pill tone="purple">{row.tier?.name ?? "Без тира"}</Pill>
                <Pill tone={ACTION_META[row.recommendation.action].tone} dot>{ACTION_META[row.recommendation.action].label}</Pill>
                {row.recommendation.warning && <Pill tone="warn">нужен разбор</Pill>}
              </div>
              <SheetDescription asChild>
                <div className="flex flex-col gap-2">
                  <TierLadder tiers={evaluation.tiers} current={row.tierKey} target={row.recommendation.toTier?.key} compact />
                  <ul className="text-xs text-muted-foreground">
                    {row.recommendation.reasons.map((r, i) => <li key={i}>• {r}</li>)}
                  </ul>
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ProgressRing value={row.progress == null ? 0 : row.progress * 100} size={48} tone={row.progress === 1 ? "up" : "accent"} ariaLabel="Прогресс до следующего тира" />
                <div className="text-sm">
                  <div className="font-medium text-foreground">
                    {row.nextTier ? `До тира «${row.nextTier.name}»` : "Верхний тир"}
                  </div>
                  <div className="text-xs text-muted-foreground">{row.promotePassed} из {row.promoteTotal} условий выполнено</div>
                </div>
              </div>
              {evaluation.canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <TierPopover row={row} tiers={evaluation.tiers} mode={row.tierKey ? "propose" : "assign"} />
                  <ProposeButton row={row} />
                </div>
              )}
            </div>

            {row.pendingProposal && <ProposalCard proposal={row.pendingProposal} tiers={evaluation.tiers} canDecide={evaluation.canEdit} />}

            <Segmented
              ariaLabel="Раздел карточки трейдера"
              value={tab}
              onChange={setTab}
              size="sm"
              options={[
                { value: "rules", label: "Правила", count: row.rules.length },
                { value: "metrics", label: "Метрики" },
                { value: "limits", label: "Лимиты" },
                { value: "history", label: "История" },
              ]}
            />

            {tab === "rules" && (
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-2">
                  <h3 className="micro-label">Повышение</h3>
                  <RuleList rules={promote} metrics={evaluation.meta.metrics} emptyText="Нет правил повышения для этого тира" />
                </section>
                <section className="flex flex-col gap-2">
                  <h3 className="micro-label">Понижение</h3>
                  <RuleList rules={demote} metrics={evaluation.meta.metrics} emptyText="Нет правил понижения для этого тира" />
                </section>
              </div>
            )}
            {tab === "metrics" && <MetricsGrid window={w20} metrics={evaluation.meta.metrics} />}
            {tab === "limits" && <TierCompare current={row.tier} limits={row.limits} next={row.nextTier} />}
            {tab === "history" && (
              <div className="flex flex-col gap-4">
                {proposals.data?.proposals.filter((p) => p.status !== "pending").length ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="micro-label">Решения</h3>
                    {proposals.data.proposals.filter((p) => p.status !== "pending").slice(0, 5).map((p) => (
                      <ProposalCard key={p.id} proposal={p} tiers={evaluation.tiers} canDecide={false} />
                    ))}
                  </section>
                ) : null}
                <section className="flex flex-col gap-2">
                  <h3 className="micro-label">Изменения тира</h3>
                  <HistoryTimeline entries={history.data?.history ?? []} tiers={evaluation.tiers} loading={history.isLoading} />
                </section>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
