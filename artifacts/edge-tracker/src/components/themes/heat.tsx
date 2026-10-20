/**
 * Heat-table pieces shared by every table of the page: a tinted % cell, plain RVOL / float cells, a sortable column
 * header, and the narrow «rail» a column collapses to while it has no values (an abbreviated label, «appears at …» as
 * its tooltip). Cell tint: the up / down token at an opacity scaled to |value| / column max, plus a 2 px diverging
 * mini-bar along the bottom (from the centre: right for up, left for down). Unknown = a muted «—».
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { toneOf, toneText } from "@/components/ds";
import { fmtCompact, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { cellIntensity, isSigned, type BoardColumn, type ColSort } from "./model";

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

/** Any board column: signed moves tinted; RVOL as «2.1×»; float compact («45.2M»). */
export function ValueCell({ col, value, max, className }: { col: BoardColumn; value: number | null; max: number; className?: string }) {
  if (isSigned(col)) return <HeatCell value={value} max={max} className={className} />;
  const text = value == null ? "—" : col === "rvol" ? `${fmtNum(value, 1)}×` : fmtCompact(value);
  const hot = col === "rvol" && value != null && value >= 2;
  return <span className={cn("block px-1.5 text-right text-xs tabular-nums", value == null ? "text-muted-foreground/60" : hot ? "font-medium text-warn" : "text-foreground", className)}>{text}</span>;
}

/** A collapsed (empty) column's cell: a thin muted line. */
export function RailCell({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("mx-auto block h-3 w-px bg-border", className)} />;
}

/**
 * Column header: label, arrow when active. `rail`: the column has no values now — abbreviated, dimmed, «appears at …»
 * as tooltip (still clickable).
 */
export function SortHeader<C extends BoardColumn>({
  col, sort, rail = false, onSort, className,
}: { col: C; sort: ColSort<C>; rail?: boolean; onSort: (col: C) => void; className?: string }) {
  const { t } = themesI18n.useT();
  const k: BoardColumn = col; // template keys need the union, not the generic
  const active = sort.col === col;
  const Arrow = sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      aria-pressed={active}
      aria-label={t("sortBy", { col: t(`cols.${k}`) })}
      title={rail ? t(`unavailable.${k}`) : t(`hints.${k}`)}
      className={cn(
        "inline-flex min-h-6 items-center gap-0.5 rounded px-1 text-2xs font-medium leading-tight hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        rail ? "justify-center px-0 opacity-60" : "justify-end text-right",
        active ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <span className="min-w-0 truncate">{rail ? t(`rail.${k}`) : t(`cols.${k}`)}</span>
      {active && !rail && <Arrow className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  );
}

/** grid-template-columns for the value tracks: a full track per column, a narrow rail per empty one. */
export function valueTracks(cols: readonly string[], empty: readonly string[], full: string): string {
  return cols.map((c) => (empty.includes(c) ? "1.75rem" : full)).join(" ") || "0";
}
