/**
 * The themes heat-table: one dense row per theme (rank, name, Премаркет | От открытия | За день | После закрытия),
 * sorted by the active column. From xl the sorted list is split into two halves side by side (ranks 1–20 | 21–39) so
 * every theme fits on one screen; below xl one list; on phones the theme plus two columns (the active one and
 * «За день»). A row is a button: click / Enter opens the theme's members sheet.
 */
import { useMemo } from "react";
import { Panel } from "@/components/ds";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { HeatCell, SortHeader } from "./heat";
import {
  METRICS, columnMax, hasValues, phoneColumns, sortThemes, splitHalves, type ThemeMetric, type ThemeOut, type ThemeSort,
} from "./model";

/** rank · name · 4 values (phones: 2 values, the other cells are display:none and take no grid track). */
const GRID = "grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-1.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_repeat(4,4.75rem)]";

type Ctx = {
  sort: ThemeSort;
  maxes: Record<ThemeMetric, number>;
  available: Record<ThemeMetric, boolean>;
  phone: readonly ThemeMetric[];
  onSort: (col: ThemeMetric) => void;
  onOpen: (id: number) => void;
};

const phoneOnly = (ctx: Ctx, c: ThemeMetric) => !ctx.phone.includes(c) && "hidden sm:block";

function HeatList({ rows, start, ctx, className }: { rows: readonly ThemeOut[]; start: number; ctx: Ctx; className?: string }) {
  const { t } = themesI18n.useT();
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn(GRID, "border-b border-[var(--glass-border)] pb-1")}>
        <span className="text-2xs text-muted-foreground">{t("cols.rank")}</span>
        <span className="text-2xs text-muted-foreground">{t("cols.theme")}</span>
        {METRICS.map((c) => (
          <SortHeader key={c} col={c} sort={ctx.sort} available={ctx.available[c]} onSort={ctx.onSort} className={cn(!ctx.phone.includes(c) && "hidden sm:inline-flex", "w-full")} />
        ))}
      </div>
      <ul className="flex flex-col pt-0.5">
        {rows.map((th, i) => (
          <li key={th.id}>
            <button
              type="button"
              onClick={() => ctx.onOpen(th.id)}
              aria-label={t("rowAria", { rank: start + i, name: th.name, value: fmtPct(th[ctx.sort.col]) })}
              className={cn(GRID, "h-6.5 w-full rounded-md px-0.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            >
              <span className="text-right text-2xs tabular-nums text-muted-foreground">{start + i}</span>
              <span className="truncate text-xs sm:text-sm" title={th.name}>{th.name}</span>
              {METRICS.map((c) => (
                <HeatCell key={c} value={th[c]} max={ctx.maxes[c]} className={cn(phoneOnly(ctx, c), c === ctx.sort.col && "ring-1 ring-inset ring-[var(--glass-border)]")} />
              ))}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeatTable({
  themes, sort, onSort, onOpen,
}: { themes: readonly ThemeOut[]; sort: ThemeSort; onSort: (col: ThemeMetric) => void; onOpen: (id: number) => void }) {
  const ctx = useMemo<Ctx>(() => ({
    sort,
    onSort,
    onOpen,
    phone: phoneColumns(sort.col),
    maxes: Object.fromEntries(METRICS.map((c) => [c, columnMax(themes, c)])) as Record<ThemeMetric, number>,
    available: Object.fromEntries(METRICS.map((c) => [c, hasValues(themes, c)])) as Record<ThemeMetric, boolean>,
  }), [themes, sort, onSort, onOpen]);
  const rows = useMemo(() => sortThemes(themes, sort), [themes, sort]);
  const [left, right] = splitHalves(rows);
  return (
    <Panel padded bodyClassName="p-2 sm:p-3">
      <HeatList rows={rows} start={1} ctx={ctx} className="xl:hidden" />
      <div className="hidden gap-x-6 xl:grid xl:grid-cols-2">
        <HeatList rows={left} start={1} ctx={ctx} />
        <HeatList rows={right} start={left.length + 1} ctx={ctx} />
      </div>
    </Panel>
  );
}
