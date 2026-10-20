/**
 * The themes heat-table: one dense row per theme (rank, name, the user's visible columns of Премаркет | От открытия |
 * За день | После закрытия), sorted by the active column. From xl the sorted list is split into two halves side by side
 * (ranks 1–20 | 21–39) so every theme fits on one screen; below xl one list; on phones the theme plus ≤ 2 of the
 * visible columns (the active one and «За день»). The user's own themes carry a small «моя» marker. A row is a button:
 * click / Enter opens the theme's sheet. `toolbar` renders above the header (phone picker, «Вид», «+ Моя тема»).
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Panel } from "@/components/ds";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { HeatCell, SortHeader } from "./heat";
import { columnMax, hasValues, phoneColumns, sortThemes, splitHalves, type BoardTheme, type ThemeMetric, type ThemeSort } from "./model";

/** rank · name · N values; the counts come from CSS variables (--np on phones, --n from sm). Hidden cells take no track. */
const GRID = "grid grid-cols-[1.25rem_minmax(0,1fr)_repeat(var(--np),4.5rem)] items-center gap-x-1.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_repeat(var(--n),4.75rem)]";

type Ctx = {
  sort: ThemeSort;
  columns: readonly ThemeMetric[];
  maxes: Partial<Record<ThemeMetric, number>>;
  available: Partial<Record<ThemeMetric, boolean>>;
  phone: readonly ThemeMetric[];
  onSort: (col: ThemeMetric) => void;
  onOpen: (key: string) => void;
};

function HeatList({ rows, start, ctx, className }: { rows: readonly BoardTheme[]; start: number; ctx: Ctx; className?: string }) {
  const { t } = themesI18n.useT();
  const narrow = (c: ThemeMetric, show: string) => !ctx.phone.includes(c) && `hidden ${show}`;
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn(GRID, "border-b border-[var(--glass-border)] pb-1")}>
        <span className="text-2xs text-muted-foreground">{t("cols.rank")}</span>
        <span className="text-2xs text-muted-foreground">{t("cols.theme")}</span>
        {ctx.columns.map((c) => (
          <SortHeader key={c} col={c} sort={ctx.sort} available={!!ctx.available[c]} onSort={ctx.onSort} className={cn(narrow(c, "sm:inline-flex"), "w-full")} />
        ))}
      </div>
      <ul className="flex flex-col pt-0.5">
        {rows.map((th, i) => (
          <li key={th.key}>
            <button
              type="button"
              onClick={() => ctx.onOpen(th.key)}
              aria-label={t("rowAria", { rank: start + i, name: th.name, value: fmtPct(th[ctx.sort.col]) })}
              className={cn(GRID, "h-6.5 w-full rounded-md px-0.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            >
              <span className="text-right text-2xs tabular-nums text-muted-foreground">{start + i}</span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-xs sm:text-sm" title={th.name}>{th.name}</span>
                {th.mine && <span className="shrink-0 rounded bg-primary/12 px-1 text-2xs leading-4 text-accent-soft" title={t("mineTitle")}>{t("mine")}</span>}
              </span>
              {ctx.columns.map((c) => (
                <HeatCell key={c} value={th[c]} max={ctx.maxes[c] ?? 0} className={cn(narrow(c, "sm:block"), c === ctx.sort.col && "ring-1 ring-inset ring-[var(--glass-border)]")} />
              ))}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeatTable({
  rows, columns, sort, onSort, onOpen, toolbar,
}: {
  rows: readonly BoardTheme[];
  columns: readonly ThemeMetric[];
  sort: ThemeSort;
  onSort: (col: ThemeMetric) => void;
  onOpen: (key: string) => void;
  toolbar?: ReactNode;
}) {
  const ctx = useMemo<Ctx>(() => ({
    sort,
    columns,
    onSort,
    onOpen,
    phone: phoneColumns(sort.col, columns),
    maxes: Object.fromEntries(columns.map((c) => [c, columnMax(rows, c)])),
    available: Object.fromEntries(columns.map((c) => [c, hasValues(rows, c)])),
  }), [rows, columns, sort, onSort, onOpen]);
  const sorted = useMemo(() => sortThemes(rows, sort), [rows, sort]);
  const [left, right] = splitHalves(sorted);
  const vars = { "--n": columns.length, "--np": ctx.phone.length } as CSSProperties;
  return (
    <Panel padded bodyClassName="p-2 sm:p-3" style={vars}>
      {toolbar && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">{toolbar}</div>}
      <HeatList rows={sorted} start={1} ctx={ctx} className="xl:hidden" />
      <div className="hidden gap-x-6 xl:grid xl:grid-cols-2">
        <HeatList rows={left} start={1} ctx={ctx} />
        <HeatList rows={right} start={left.length + 1} ctx={ctx} />
      </div>
    </Panel>
  );
}
