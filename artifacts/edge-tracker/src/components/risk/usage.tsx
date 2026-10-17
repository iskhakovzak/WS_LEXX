
import { AlertOctagon, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RiskAlert } from "./use-risk";
import { fmtPct, fmtUsd } from "@/lib/format";

const isCount = (kind: string) => kind === "positions" || kind === "overnight_not_allowed" || kind === "swing_not_allowed";

export function alertValue(a: RiskAlert): string {
  if (a.kind === "overnight_not_allowed" || a.kind === "swing_not_allowed") return `${a.used} поз.${a.detail ? ` · ${a.detail}` : ""}`;
  const f = (v: number) => (isCount(a.kind) ? String(v) : fmtUsd(v, { decimals: 0, compact: 10_000 }));
  return `${f(a.used)}${a.limit != null ? ` / ${f(a.limit)}` : ""}${a.detail ? ` · ${a.detail}` : ""}`;
}

/** Compact list of warn/breach alerts for one trader. */
export function AlertList({ alerts, className }: { alerts: RiskAlert[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {alerts.map((a, i) => {
        const breach = a.level === "breach";
        const Icon = breach ? AlertOctagon : AlertTriangle;
        return (
          <li
            key={`${a.kind}-${i}`}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
              breach ? "bg-down/10" : "bg-warn/10",
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", breach ? "text-down" : "text-warn")} aria-hidden="true" />
            <span className="font-medium">{a.label}</span>
            <span className="sr-only">{breach ? "нарушение" : "внимание"}</span>
            <span className="ml-auto truncate text-right text-xs text-muted-foreground tabular-nums">{alertValue(a)}</span>
            {a.pct != null && (
              <span className={cn("shrink-0 text-xs font-semibold tabular-nums", breach ? "text-down" : "text-warn")}>{fmtPct(a.pct, { decimals: 0, signed: false })}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
