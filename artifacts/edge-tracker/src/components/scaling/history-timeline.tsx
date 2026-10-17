
import { ArrowDownRight, ArrowUpRight, Flag, History } from "lucide-react";
import { EmptyState, Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { HistoryEntry, Tier } from "./use-scaling";
import { tierName } from "./format";
import { fmtDate } from "@/lib/format";

const META = {
  promote: { icon: ArrowUpRight, cls: "bg-up/15 text-up", label: "Повышение" },
  demote: { icon: ArrowDownRight, cls: "bg-down/15 text-down", label: "Понижение" },
  assign: { icon: Flag, cls: "bg-primary/15 text-primary", label: "Назначение" },
} as const;

export function HistoryTimeline({
  entries,
  tiers,
  loading,
  showTrader = false,
  limit,
  className,
}: {
  entries: HistoryEntry[];
  tiers: Tier[];
  loading?: boolean;
  showTrader?: boolean;
  limit?: number;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
      </div>
    );
  }
  const list = limit ? entries.slice(0, limit) : entries;
  if (!list.length) {
    return <EmptyState icon={History} title="Истории пока нет" description="Здесь появятся повышения, понижения и назначения тира." className="py-8" />;
  }
  return (
    <ol className={cn("relative flex flex-col gap-3 border-l border-[var(--glass-border)] pl-5", className)}>
      {list.map((h) => {
        const m = META[h.action as keyof typeof META] ?? META.assign;
        const Icon = m.icon;
        return (
          <li key={h.id} className="relative">
            <span className={cn("absolute -left-[31px] top-0.5 grid h-6 w-6 place-items-center rounded-full", m.cls)} aria-hidden="true">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              {showTrader && <span className="font-semibold text-foreground">{h.trader}</span>}
              <span className="text-foreground">{m.label}:</span>
              <span className="text-muted-foreground">{tierName(tiers, h.fromTier)}</span>
              <span className="text-muted-foreground" aria-hidden="true">→</span>
              <Pill tone="purple">{tierName(tiers, h.toTier)}</Pill>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
              <span>{fmtDate(h.createdAt, "dateTime")}</span>
              <span>{h.actor}</span>
              {h.proposalId != null && <span>предложение #{h.proposalId}</span>}
            </div>
            {h.comment && <p className="mt-1 text-xs text-muted-foreground/90">{h.comment}</p>}
          </li>
        );
      })}
    </ol>
  );
}
