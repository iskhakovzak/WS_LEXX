/**
 * The dense heat-table every board uses: rank, name, the visible value columns, sorted by the active one. From xl the
 * sorted list splits into two halves side by side (ranks 1–20 | 21–39) so a full board fits one screen; below xl one
 * list; on phones the name plus ≤ 2 columns (the active one and «За день»). A column with no values right now collapses
 * to a narrow rail (its header says when it appears). Rows are rendered by the caller (`renderRow`: a button that opens
 * a sheet, or a menu trigger) — every row carries `data-row`, and ↑ / ↓ move the focus through them in rank order.
 */
import { useMemo, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Panel } from "@/components/ds";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { RailCell, SortHeader, ValueCell, valueTracks } from "./heat";
import { columnMax, emptyColumns, phoneColumns, sortRows, splitHalves, type BoardColumn, type ColSort } from "./model";

/** rank · name · value tracks; the value tracks come from CSS variables (--pvt on phones, --vt from sm). */
export const ROW_GRID = "grid grid-cols-[1.25rem_minmax(0,1fr)_var(--pvt)] items-center gap-x-1.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_var(--vt)]";
export const ROW_CLASS = "h-6.5 w-full rounded-md px-0.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type GridSpec<R, C extends BoardColumn> = {
  rows: readonly R[];
  columns: readonly C[];
  sort: ColSort<C>;
  onSort: (col: C) => void;
  keyOf: (r: R) => string;
  labelOf: (r: R) => string;
  get: (r: R, c: C) => number | null;
  /** The name cell (name + markers). */
  name: (r: R) => ReactNode;
  /** Wraps a row's cells: must render ONE focusable element with `data-row` and the given className. */
  renderRow: (r: R, rank: number, cells: ReactNode, className: string) => ReactNode;
  /** Header label of the name column. */
  nameLabel: string;
};

/** Move the focus to the previous / next row (↑ / ↓) — rows in DOM order are rank order. */
function onRowKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")).filter((el) => el.offsetParent !== null);
  if (!rows.length) return;
  e.preventDefault();
  const i = rows.indexOf(document.activeElement as HTMLElement);
  const next = i < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
  rows[next]!.focus();
}

function List<R, C extends BoardColumn>({ spec, rows, start, empty, phone, maxes, className }: {
  spec: GridSpec<R, C>; rows: readonly R[]; start: number; empty: readonly C[]; phone: readonly C[]; maxes: Map<C, number>; className?: string;
}) {
  const { t } = themesI18n.useT();
  const narrow = (c: C, show: string) => !phone.includes(c) && `hidden ${show}`;
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn(ROW_GRID, "border-b border-[var(--glass-border)] pb-1")}>
        <span className="text-2xs text-muted-foreground">{t("cols.rank")}</span>
        <span className="text-2xs text-muted-foreground">{spec.nameLabel}</span>
        {spec.columns.map((c) => (
          <SortHeader key={c} col={c} sort={spec.sort} rail={empty.includes(c)} onSort={spec.onSort} className={cn(narrow(c, "sm:inline-flex"), "w-full")} />
        ))}
      </div>
      <ul className="flex flex-col pt-0.5">
        {rows.map((r, i) => {
          const cells = (
            <>
              <span className="text-right text-2xs tabular-nums text-muted-foreground">{start + i}</span>
              <span className="flex min-w-0 items-center gap-1">{spec.name(r)}</span>
              {spec.columns.map((c) => (empty.includes(c)
                ? <RailCell key={c} className={cn(narrow(c, "sm:block"))} />
                : <ValueCell key={c} col={c} value={spec.get(r, c)} max={maxes.get(c) ?? 0} className={cn(narrow(c, "sm:block"), c === spec.sort.col && "ring-1 ring-inset ring-[var(--glass-border)]")} />))}
            </>
          );
          return <li key={spec.keyOf(r)}>{spec.renderRow(r, start + i, cells, cn(ROW_GRID, ROW_CLASS))}</li>;
        })}
      </ul>
    </div>
  );
}

export function HeatTable<R, C extends BoardColumn>({ spec, toolbar, footer }: { spec: GridSpec<R, C>; toolbar?: ReactNode; footer?: ReactNode }) {
  const { rows, columns, sort } = spec;
  const valued = useMemo(() => rows.map((r) => Object.fromEntries(columns.map((c) => [c, spec.get(r, c)])) as Record<C, number | null>), [rows, columns, spec]);
  // The active column never collapses (the user picked it, or it is the default with values).
  const empty = useMemo(() => emptyColumns(valued, columns).filter((c) => c !== sort.col), [valued, columns, sort.col]);
  const phone = useMemo(() => phoneColumns(sort.col, columns.filter((c) => !empty.includes(c))), [sort.col, columns, empty]);
  const maxes = useMemo(() => new Map(columns.map((c) => [c, columnMax(valued, c)])), [valued, columns]);
  const sorted = useMemo(() => sortRows(rows, sort, spec.get, spec.labelOf), [rows, sort, spec]);
  const [left, right] = splitHalves(sorted);
  const vars = {
    "--vt": valueTracks(columns, empty, "4.75rem"),
    "--pvt": valueTracks(phone, [], "4.5rem"),
  } as CSSProperties;
  return (
    <Panel padded bodyClassName="p-2 sm:p-3" style={vars}>
      {toolbar && <div className="mb-1.5 flex flex-wrap items-center gap-2">{toolbar}</div>}
      <div onKeyDown={onRowKeys}>
        <List spec={spec} rows={sorted} start={1} empty={empty} phone={phone} maxes={maxes} className="xl:hidden" />
        <div className="hidden gap-x-6 xl:grid xl:grid-cols-2">
          <List spec={spec} rows={left} start={1} empty={empty} phone={phone} maxes={maxes} />
          <List spec={spec} rows={right} start={left.length + 1} empty={empty} phone={phone} maxes={maxes} />
        </div>
      </div>
      {footer}
    </Panel>
  );
}
