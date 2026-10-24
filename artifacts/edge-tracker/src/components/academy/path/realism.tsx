/**
 * Readiness realism on «Путь трейдера» (roadmap R1): the main bottleneck (the one failing criterion to work on —
 * «never met in N windows» sends it to the curator), the net pace instead of an ETA date, and days on the stage. Task
 * framing: what to work on next, never a verdict on the trader.
 */
import { Gauge, TriangleAlert } from "lucide-react";
import { Pill } from "@/components/ds";
import { fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { academyPathI18n } from "@/i18n/ns/academyPath";
import type { BindingConstraint, Pace, StageSignal } from "./api";

const usd = (v: number) => fmtUsd(v, { decimals: "trim" });

export function BindingLine({ b, className }: { b: BindingConstraint | null | undefined; className?: string }) {
  const { t } = academyPathI18n.useT();
  if (!b) return null;
  return (
    <div className={cn("flex flex-col gap-1 text-sm", className)}>
      <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
        {b.kind === "infeasible_style" && <TriangleAlert className="h-4 w-4 shrink-0 text-[hsl(var(--warn))]" aria-hidden="true" />}
        {t("realism.binding", { label: b.label })}
        <Pill tone={b.kind === "infeasible_style" ? "warn" : "neutral"}>{t(`realism.bindingKind.${b.kind}`)}</Pill>
      </p>
      <p className="text-xs text-muted-foreground">
        {b.kind === "infeasible_style" && b.neverMetWindows != null
          ? t("realism.neverMet", { count: b.neverMetWindows })
          : b.daysToClose != null ? t("realism.daysToClose", { count: b.daysToClose }) : t("realism.notImproving")}
        {` · ${b.display} → ${b.targetDisplay}`}
      </p>
      {b.advice && <p className="text-xs text-muted-foreground">{b.advice}</p>}
    </div>
  );
}

/** Need vs now per day; the bar fills now ÷ need, the interval is printed (no ETA, no pass probability). */
export function PaceBar({ pace, className }: { pace: Pace | null | undefined; className?: string }) {
  const { t } = academyPathI18n.useT();
  if (!pace || !(pace.needPerDay > 0)) return null;
  const share = Math.max(0, Math.min(1, pace.nowPerDay / pace.needPerDay));
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t("realism.pace", { need: usd(pace.needPerDay), target: usd(pace.target), days: pace.windowDays, now: usd(pace.nowPerDay) })}</span>
        {pace.lo80 != null && pace.hi80 != null && <span className="tabular-nums">{t("realism.paceRange", { lo: usd(pace.lo80), hi: usd(pace.hi80) })}</span>}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={t("realism.paceAria")}>
        <div className={cn("h-full rounded-full", share >= 1 ? "bg-up" : "bg-primary")} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

export function StageDays({ days, signal }: { days: number | null | undefined; signal: StageSignal | null | undefined }) {
  const { t } = academyPathI18n.useT();
  if (days == null) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {t("realism.stageDays", { count: days })}
      {signal && <Pill tone={signal === "info" ? "neutral" : "warn"}>{t(`realism.stageSignal.${signal}`)}</Pill>}
    </span>
  );
}
