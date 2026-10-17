/**
 * Small presentational atoms for the Big 7 context screen (signed numbers, RS bar, level chip).
 */
import { toneOf, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtSigned, type MergedCatalyst } from "./lib";
import { tradingDaysUntil, TODAY } from "./lib";
import type { LevelPoint } from "./context";

export const fmtPx = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtRvol = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(n >= 10 ? 0 : 1)}×`);

/** Signed, coloured, tabular number. `dim` keeps it neutral below |threshold|. */
export function Signed({ value, digits = 2, suffix = "%", threshold = 0, className }: {
  value: number | null | undefined; digits?: number; suffix?: string; threshold?: number; className?: string;
}) {
  const v = value != null && Number.isFinite(value) ? value : null;
  const tone = v == null || Math.abs(v) < threshold ? "neutral" : toneOf(v);
  return (
    <span className={cn("tabular-nums", v == null ? "text-muted-foreground" : toneText(tone), className)}>
      {fmtSigned(v, digits, suffix)}
    </span>
  );
}

/** Diverging bar for relative strength vs the benchmark (±`max` percentage points fills half). */
export function RsBar({ value, max = 2, className }: { value: number | null | undefined; max?: number; className?: string }) {
  const v = value != null && Number.isFinite(value) ? value : null;
  const w = v == null ? 0 : Math.min(50, (Math.abs(v) / max) * 50);
  return (
    <span className={cn("relative block h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]", className)} aria-hidden="true">
      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
      {v != null && (
        <span
          className={cn("absolute inset-y-0 rounded-full", v >= 0 ? "bg-up" : "bg-down")}
          style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
        />
      )}
    </span>
  );
}

/** «PDH +0.42%» — nearest level with its distance from the price. */
export function LevelChip({ level, dir }: { level: LevelPoint | null; dir: "up" | "down" }) {
  if (!level) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums" title={`${level.label} ${fmtPx(level.price)}`}>
      <span className={cn("text-xs", dir === "up" ? "text-up" : "text-down")} aria-hidden="true">{dir === "up" ? "↑" : "↓"}</span>
      <span className="text-foreground">{level.label}</span>
      <span className="text-xs text-muted-foreground">{fmtSigned(level.distPct, 2)}</span>
    </span>
  );
}

/** Next earnings for a ticker within `horizon` trading days (auto calendar + manual catalysts). */
export function nextEarnings(symbol: string, merged: MergedCatalyst[], horizon = 5): { date: string; days: number; when: string | null } | null {
  const e = merged.find((c) => c.ticker === symbol && c.type === "earnings" && c.date >= TODAY);
  if (!e) return null;
  const days = tradingDaysUntil(e.date);
  if (days > horizon) return null;
  const d = e.description ?? "";
  const when = d.startsWith("до открытия") ? "BMO" : d.startsWith("после закрытия") ? "AMC" : null;
  return { date: e.date, days, when };
}

export function earningsLabel(e: { days: number; when: string | null }): string {
  const day = e.days <= 0 ? "сегодня" : e.days === 1 ? "завтра" : `${e.days}д`;
  return `Отчёт ${day}${e.when ? ` ${e.when}` : ""}`;
}
