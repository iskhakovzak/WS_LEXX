/**
 * History of limit breaches for one trader: alerts the desk recorded live (risk_alert_log) merged with a
 * retrospective pass over daily net P&L against the trader's CURRENT limits (days / weeks / drawdown).
 */
import * as React from "react";
import { Link } from "wouter";
import { AlertTriangle, OctagonX, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { Skeleton } from "@/components/ui/skeleton";
import type { RiskAlertRecord, RiskLimits } from "./use-risk";
import { useRiskAlerts, useRiskHistory } from "./use-risk";
import { breachHistory } from "./risk-math";
import { fmtPct, fmtUsd } from "./primitives";

export type BreachRow = {
  key: string;
  date: string;
  kind: "daily" | "weekly" | "drawdown" | "near";
  level: "breach" | "warn";
  used: number | null;
  limit: number | null;
  pct: number | null;
  /** true = the desk recorded it live; false = found retrospectively against current limits. */
  logged: boolean;
  message?: string;
};

const KIND_LABEL: Record<BreachRow["kind"], string> = {
  daily: "Дневной лимит",
  weekly: "Недельный лимит",
  drawdown: "Макс. просадка",
  near: "Близко к стопу",
};

const BREACH_DAYS = 250;

function fromLog(a: RiskAlertRecord): BreachRow {
  const kind: BreachRow["kind"] = a.kind === "stop" ? "daily" : a.kind === "weekly" ? "weekly" : a.kind === "drawdown" ? "drawdown" : "near";
  return {
    key: `log-${a.id}`,
    date: a.date,
    kind,
    level: a.level,
    used: a.used,
    limit: a.limit,
    pct: a.used != null && a.limit ? Math.round((a.used / a.limit) * 1000) / 10 : null,
    logged: true,
    message: a.message,
  };
}

/** Merged, newest-first breach list + loading state. Retro rows that duplicate a logged alert (same day & kind) are dropped. */
export function useBreaches(trader: string | null, limits: RiskLimits | null | undefined, enabled = true) {
  const hist = useRiskHistory(enabled ? trader : null, BREACH_DAYS);
  const log = useRiskAlerts(trader, 180, enabled && !!trader);
  const rows = React.useMemo(() => {
    const logged = (log.data?.alerts ?? []).map(fromLog);
    const L = limits ?? hist.data?.limits ?? null;
    const retro = hist.data?.unit === "usd"
      ? breachHistory(hist.data.points.map((p) => ({ date: p.date, pnl: p.pnl, drawdown: p.drawdown })), L)
      : [];
    const seen = new Set(logged.map((r) => `${r.date}|${r.kind === "near" ? "warn" : r.kind}`));
    const merged: BreachRow[] = [...logged];
    for (const b of retro) {
      if (seen.has(`${b.date}|${b.kind}`) || (b.level === "warn" && seen.has(`${b.date}|warn`))) continue;
      merged.push({ key: `retro-${b.kind}-${b.date}-${b.level}`, date: b.date, kind: b.kind, level: b.level, used: b.used, limit: b.limit, pct: b.pct, logged: false });
    }
    return merged.sort((a, b) => b.date.localeCompare(a.date) || (a.level === b.level ? 0 : a.level === "breach" ? -1 : 1));
  }, [log.data, hist.data, limits]);
  const hasLimits = !!(limits ?? hist.data?.limits);
  return { rows, hasLimits, isLoading: hist.isLoading || log.isLoading, days: BREACH_DAYS };
}

export function BreachSummary({ rows }: { rows: BreachRow[] }) {
  const breaches = rows.filter((r) => r.level === "breach");
  const n = (k: BreachRow["kind"]) => breaches.filter((r) => r.kind === k).length;
  const parts = [
    n("daily") ? `${n("daily")} × дневной` : null,
    n("weekly") ? `${n("weekly")} × недельный` : null,
    n("drawdown") ? `${n("drawdown")} × просадка` : null,
  ].filter(Boolean);
  const warns = rows.length - breaches.length;
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {parts.length ? <span className="font-medium text-down">Стопы: {parts.join(", ")}</span> : <span className="text-up">Стопов не было</span>}
      {warns > 0 && <span> · {warns} раз близко к лимиту</span>}
    </p>
  );
}

export function BreachList({ rows, trader, max, className }: { rows: BreachRow[]; trader: string; max?: number; className?: string }) {
  const shown = max != null ? rows.slice(0, max) : rows;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <ul className="flex flex-col gap-1.5">
        {shown.map((r) => {
          const breach = r.level === "breach";
          const Icon = breach ? OctagonX : AlertTriangle;
          return (
            <li key={r.key} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm", breach ? "bg-down/10" : "bg-warn/10")}>
              <Icon className={cn("h-4 w-4 shrink-0", breach ? "text-down" : "text-warn")} aria-hidden="true" />
              <Link href={links.journalDay(r.date, trader)} className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground hover:text-primary" title="Журнал за этот день">
                {r.date.slice(8, 10)}.{r.date.slice(5, 7)}.{r.date.slice(2, 4)}
              </Link>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{KIND_LABEL[r.kind]}</span>
                <span className="text-muted-foreground"> · {breach ? "превышен" : "≥ 70%"}</span>
                {r.logged && <span className="ml-1.5 text-xs text-muted-foreground" title={r.message}>зафиксировано</span>}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {r.used != null ? `−${fmtUsd(r.used)}` : "—"}{r.limit != null ? ` / ${fmtUsd(r.limit)}` : ""}
              </span>
              {r.pct != null && <span className={cn("w-11 shrink-0 text-right text-xs font-semibold tabular-nums", breach ? "text-down" : "text-warn")}>{fmtPct(r.pct)}</span>}
            </li>
          );
        })}
      </ul>
      {max != null && rows.length > max && <p className="text-xs text-muted-foreground">и ещё {rows.length - max}</p>}
    </div>
  );
}

/** Full block: summary + list, or a short reason why there is nothing. */
export function BreachHistory({ trader, limits, max }: { trader: string; limits: RiskLimits | null | undefined; max?: number }) {
  const b = useBreaches(trader, limits);
  if (b.isLoading) return <Skeleton className="h-24 rounded-xl" />;
  if (!b.rows.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-up" aria-hidden="true" />
        {b.hasLimits ? `За ${b.days} дней лимиты не нарушались.` : "Лимиты не заданы — нарушения не считаются."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <BreachSummary rows={b.rows} />
      <BreachList rows={b.rows} trader={trader} max={max} />
      <p className="text-xs text-muted-foreground">За {b.days} дней. Прошлые дни сверены с текущими лимитами; «зафиксировано» — сработало в моменте.</p>
    </div>
  );
}
