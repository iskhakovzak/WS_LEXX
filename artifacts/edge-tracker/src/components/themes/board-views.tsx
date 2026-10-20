/**
 * The table of the active tab: «Общие темы» and themes boards (rows = themes, a row opens the theme sheet) and tickers
 * boards (rows = tickers, a row opens its actions menu). Each has the phone column picker and the breadth strip on top.
 */
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PanelSkeleton, Segmented } from "@/components/ds";
import { fmtPct, fmtPrice } from "@/lib/format";
import { themesI18n } from "@/i18n/ns/themes";
import { BreadthStrip } from "./breadth-strip";
import { HeatTable, type GridSpec } from "./heat-table";
import { TickerMenu } from "./ticker-actions";
import { breadth, breadthColumn, hasValues, type BoardColumn, type BoardTheme, type ColSort, type TickerRow } from "./model";

/** Phone picker of the active column + the breadth strip. */
function Toolbar<R, C extends BoardColumn>({ rows, columns, sort, onPick, get, extra }: {
  rows: readonly R[]; columns: readonly C[]; sort: ColSort<C>; onPick: (c: C) => void; get: (r: R, c: BoardColumn) => number | null; extra?: ReactNode;
}) {
  const { t } = themesI18n.useT();
  const bcol = breadthColumn(sort.col);
  const values = rows.map((r) => get(r, bcol));
  const valued = rows.map((r) => Object.fromEntries(columns.map((c) => [c, get(r, c)])) as Record<C, number | null>);
  return (
    <>
      <Segmented
        size="sm"
        className="sm:hidden"
        ariaLabel={t("columnAria")}
        value={sort.col}
        onChange={onPick}
        options={columns.map((m) => { const k: BoardColumn = m; return { value: m, label: t(`colsShort.${k}`), title: hasValues(valued, m) ? t(`cols.${k}`) : t(`unavailable.${k}`) }; })}
      />
      <BreadthStrip b={breadth(values)} col={bcol} className="hidden min-w-0 flex-1 sm:flex" />
      {extra && <div className="ml-auto flex items-center gap-1">{extra}</div>}
    </>
  );
}

const themeName = (th: BoardTheme) => {
  const { t } = themesI18n;
  return (
    <>
      <span className="truncate text-xs sm:text-sm" title={th.name}>{th.name}</span>
      {th.mine && <span className="shrink-0 rounded bg-primary/12 px-1 text-2xs leading-4 text-accent-soft" title={t("mineTitle")}>{t("mine")}</span>}
    </>
  );
};

/** «Общие темы» or a themes board. */
export function ThemesTable<C extends BoardColumn>({ rows, columns, sort, onSort, onPick, onOpen, extra, empty }: {
  rows: readonly BoardTheme[]; columns: readonly C[]; sort: ColSort<C>; onSort: (c: C) => void; onPick: (c: C) => void; onOpen: (key: string) => void;
  extra?: ReactNode; empty?: ReactNode;
}) {
  const { t } = themesI18n.useT();
  const get = (r: BoardTheme, c: BoardColumn) => (c in r ? (r as unknown as Record<string, number | null>)[c] ?? null : null);
  const spec: GridSpec<BoardTheme, C> = {
    rows, columns, sort, onSort, nameLabel: t("cols.theme"),
    keyOf: (r) => r.key, labelOf: (r) => r.name, get, name: themeName,
    renderRow: (r, rank, cells, className) => (
      <button type="button" data-row onClick={() => onOpen(r.key)} className={className}
        aria-label={t("rowAria", { rank, name: r.name, value: fmtPct(get(r, sort.col)) })}>
        {cells}
      </button>
    ),
  };
  if (!rows.length && empty) return <>{empty}</>;
  return <HeatTable spec={spec} toolbar={<Toolbar rows={rows} columns={columns} sort={sort} onPick={onPick} get={get} extra={extra} />} />;
}

/** A tickers board. */
export function TickersTable({ rows, columns, sort, onSort, onPick, source, footer }: {
  rows: readonly TickerRow[]; columns: readonly BoardColumn[]; sort: ColSort<BoardColumn>; onSort: (c: BoardColumn) => void; onPick: (c: BoardColumn) => void;
  source: string; footer?: ReactNode;
}) {
  const { t } = themesI18n.useT();
  const get = (r: TickerRow, c: BoardColumn) => r[c] ?? null;
  const spec: GridSpec<TickerRow, BoardColumn> = {
    rows, columns, sort, onSort, nameLabel: t("cols.ticker"),
    keyOf: (r) => r.ticker, labelOf: (r) => r.ticker, get,
    name: (r) => (
      <>
        <span className="text-xs font-semibold sm:text-sm">{r.ticker}</span>
        <span className="truncate text-2xs tabular-nums text-muted-foreground">{fmtPrice(r.price)}</span>
      </>
    ),
    renderRow: (r, _rank, cells, className) => (
      <TickerMenu ticker={r.ticker} source={source}>
        <button type="button" data-row className={className} aria-label={t("tickerRowAria", { ticker: r.ticker })}>{cells}</button>
      </TickerMenu>
    ),
  };
  return <HeatTable spec={spec} toolbar={<Toolbar rows={rows} columns={columns} sort={sort} onPick={onPick} get={get} />} footer={footer} />;
}

export function BoardLoading() {
  return <PanelSkeleton height={520} title={false} />;
}

/** A themes board without themes yet: what to do next. */
export function EmptyThemesBoard({ onAdd }: { onAdd: () => void }) {
  const { t } = themesI18n.useT();
  return (
    <EmptyState
      title={t("boards.emptyThemes")}
      description={t("boards.emptyThemesHint")}
      action={<Button type="button" size="sm" onClick={onAdd}><Plus aria-hidden="true" /> {t("my.add")}</Button>}
    />
  );
}
