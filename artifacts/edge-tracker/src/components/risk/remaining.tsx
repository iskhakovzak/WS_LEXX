
import { cn } from "@/lib/utils";
import { useReducedMotion } from "framer-motion";
import type { RiskLimits, RiskMetrics } from "./use-risk";
import { usageColor, usageText } from "./primitives";
import { fmtUsd } from "@/lib/format";

type Item = { key: string; label: string; used: number; limit: number | null; pnl: number | null; pnlLabel: string };

function items(m: RiskMetrics, L: RiskLimits | null): Item[] {
  return [
    { key: "day", label: "До дневного стопа", used: Math.max(0, -(m.today.pnlNet ?? 0)), limit: L?.dailyLossLimit ?? null, pnl: m.today.pnlNet, pnlLabel: "сегодня" },
    { key: "week", label: "До недельного стопа", used: Math.max(0, -(m.week.pnlNet ?? 0)), limit: L?.weeklyLossLimit ?? null, pnl: m.week.pnlNet, pnlLabel: "неделя" },
    { key: "dd", label: "До лимита просадки", used: Math.max(0, m.drawdown.currentUsd), limit: L?.maxDrawdown ?? null, pnl: m.drawdown.currentUsd ? -m.drawdown.currentUsd : 0, pnlLabel: "от пика" },
  ];
}

function Cell({ it, big }: { it: Item; big: boolean }) {
  const reduce = useReducedMotion();
  if (it.limit == null || it.limit <= 0) {
    return (
      <div className="flex flex-col gap-1 rounded-xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--field-border)]">
        <span className="text-xs text-muted-foreground">{it.label}</span>
        <span className="text-sm text-muted-foreground">лимит не задан</span>
        <span className="text-xs text-muted-foreground tabular-nums">{it.pnlLabel}: {fmtUsd(it.pnl, { signed: true, decimals: 0 })}</span>
      </div>
    );
  }
  const pct = (it.used / it.limit) * 100;
  const remaining = Math.max(0, it.limit - it.used);
  const remainingPct = Math.max(0, 100 - pct);
  const over = pct >= 100;
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl p-3 ring-1 ring-inset", over ? "bg-down/10 ring-down/40" : pct >= 70 ? "bg-warn/10 ring-warn/30" : "bg-[var(--glass-bg)] ring-[var(--field-border)]")}>
      <span className="text-xs text-muted-foreground">{it.label}</span>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className={cn("font-semibold", big ? "text-2xl" : "text-lg", over ? "text-down" : usageText(pct))}>
          {over ? "стоп" : fmtUsd(remaining, { decimals: 0 })}
        </span>
        <span className="text-xs text-muted-foreground">{over ? `превышен на ${fmtUsd(it.used - it.limit, { decimals: 0 })}` : `${Math.round(remainingPct)}% лимита`}</span>
      </div>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${it.label}: использовано ${Math.round(pct)}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(pct))}
      >
        <div
          className={cn("h-full rounded-full", !reduce && "transition-[width] duration-[var(--dur-4)]")}
          style={{ width: `${Math.min(100, Math.max(it.used > 0 ? 2 : 0, pct))}%`, background: usageColor(pct) }}
        />
        <span className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: "70%" }} aria-hidden="true" />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {it.pnlLabel}: {fmtUsd(it.pnl, { signed: true, decimals: 0 })} · лимит {fmtUsd(it.limit, { decimals: 0 })}
      </span>
    </div>
  );
}

export function StopRemaining({ m, limits, big = false, className }: { m: RiskMetrics; limits: RiskLimits | null; big?: boolean; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", className)}>
      {items(m, limits).map((it) => <Cell key={it.key} it={it} big={big} />)}
    </div>
  );
}
