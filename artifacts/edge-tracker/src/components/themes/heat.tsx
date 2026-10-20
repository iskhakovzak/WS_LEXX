/**
 * Heat-table pieces shared by the theme table and the members sheet: a tinted % cell and a sortable column header.
 * Cell tint: the up / down token at an opacity scaled to |value| / column max, plus a 2 px diverging mini-bar along the
 * bottom (from the centre: right for up, left for down). Unknown = a muted «—».
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { toneOf, toneText } from "@/components/ds";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { cellIntensity, type ThemeMetric, type ThemeSort } from "./model";

export function HeatCell({ value, max, className }: { value: number | null; max: number; className?: string }) {
  if (value == null) return <span className={cn("block text-right text-xs tabular-nums text-muted-foreground/60", className)}>—</span>;
  const k = cellIntensity(value, max);
  const token = value > 0 ? "--up" : "--down";
  return (
    <span
      className={cn("relative block overflow-hidden rounded-[4px] px-1.5 text-right text-xs font-medium leading-5 tabular-nums", toneText(toneOf(value)), className)}
      style={{ backgroundColor: k > 0 ? `hsl(var(${token}) / ${(0.06 + 0.34 * k).toFixed(3)})` : undefined }}
    >
      {fmtPct(value)}
      {k > 0 && (
        <span
          aria-hidden="true"
          className={cn("absolute bottom-0 h-[2px] opacity-70", value > 0 ? "left-1/2 bg-up" : "right-1/2 bg-down")}
          style={{ width: `${(k * 50).toFixed(1)}%` }}
        />
      )}
    </span>
  );
}

/** Column header: label, arrow when active; dimmed with «appears at …» as its tooltip when the column has no values. */
export function SortHeader({
  col, sort, available, onSort, className,
}: { col: ThemeMetric; sort: ThemeSort; available: boolean; onSort: (col: ThemeMetric) => void; className?: string }) {
  const { t } = themesI18n.useT();
  const active = sort.col === col;
  const Arrow = sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      aria-pressed={active}
      aria-label={t("sortBy", { col: t(`cols.${col}`) })}
      title={available ? t(`hints.${col}`) : t(`unavailable.${col}`)}
      className={cn(
        "inline-flex min-h-6 items-center justify-end gap-0.5 rounded px-1 text-right text-2xs font-medium leading-tight hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-foreground" : "text-muted-foreground",
        !available && !active && "opacity-50",
        className,
      )}
    >
      <span className="min-w-0">{t(`cols.${col}`)}</span>
      {active && <Arrow className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  );
}
