import * as React from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tier } from "./use-scaling";
import { fmtUsd } from "./format";

/**
 * Horizontal tier ladder: every step shows name + buying power; the current tier is solid accent,
 * passed tiers are ticked, the target (proposed) tier gets a dashed ring.
 */
export function TierLadder({
  tiers,
  current,
  target,
  compact = false,
  className,
  onSelect,
}: {
  tiers: Tier[];
  current: string | null;
  target?: string | null;
  compact?: boolean;
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const idx = current ? tiers.findIndex((t) => t.key === current) : -1;
  if (!tiers.length) return <p className="text-sm text-muted-foreground">Лестница тиров пуста — задайте её в настройках.</p>;
  return (
    <ol className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)} aria-label="Лестница тиров">
      {tiers.map((t, i) => {
        const isCurrent = t.key === current;
        const passed = idx >= 0 && i < idx;
        const isTarget = !!target && t.key === target;
        const Comp = onSelect ? "button" : "div";
        return (
          <li key={t.key} className="flex items-center gap-1.5">
            <Comp
              type={onSelect ? "button" : undefined}
              onClick={onSelect ? () => onSelect(t.key) : undefined}
              aria-current={isCurrent ? "step" : undefined}
              title={t.description ?? undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border text-xs font-medium transition-colors",
                compact ? "min-h-7 px-2.5" : "min-h-8 px-3",
                isCurrent
                  ? "border-transparent bg-primary-solid text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]"
                  : passed
                    ? "border-[var(--glass-border)] bg-up/15 text-up"
                    : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
                isTarget && !isCurrent && "border-dashed border-primary text-foreground",
                onSelect && "lift cursor-pointer",
              )}
            >
              {passed && <Check className="h-3 w-3" aria-hidden="true" />}
              <span>{t.name}</span>
              {!compact && t.accountSize != null && (
                <span className={cn("tabular-nums", isCurrent ? "opacity-90" : "opacity-70")}>{fmtUsd(t.accountSize, { compact: true })}</span>
              )}
            </Comp>
            {i < tiers.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
