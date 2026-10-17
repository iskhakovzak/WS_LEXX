import * as React from "react";
import { cn } from "@/lib/utils";
import type { Limits, Tier } from "./use-scaling";
import { TIER_FIELDS, fmtTierField } from "./format";

/**
 * Limits side by side: what the trader has now (actual risk limits, falling back to the tier preset)
 * vs. what the next tier gives. Differences are highlighted.
 */
export function TierCompare({
  current,
  limits,
  next,
  className,
}: {
  current: Tier | null;
  limits: Limits | null;
  next: Tier | null;
  className?: string;
}) {
  const now = (key: keyof Tier) => (limits && key in limits ? (limits as unknown as Record<string, unknown>)[key] : current ? current[key] : null);
  return (
    <table className={cn("w-full text-sm tabular-nums", className)}>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="py-1.5 font-medium">Лимит</th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium">{current ? current.name : "Сейчас"}</th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium text-primary">{next ? next.name : "Следующий тир"}</th>
        </tr>
      </thead>
      <tbody>
        {TIER_FIELDS.map((f) => {
          const a = fmtTierField(f.kind, now(f.key));
          const b = next ? fmtTierField(f.kind, next[f.key]) : "—";
          const changed = next && a !== b;
          return (
            <tr key={f.key} className="border-t border-border/50">
              <td className="py-1.5 pr-2 text-muted-foreground">{f.label}</td>
              <td className="whitespace-nowrap py-1.5 pl-3 text-right text-foreground">{a}</td>
              <td className={cn("whitespace-nowrap py-1.5 pl-3 text-right", changed ? "font-semibold text-primary" : "text-muted-foreground")}>{b}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
