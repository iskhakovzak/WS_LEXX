import { useMemo } from "react";
import type { Trade } from "@workspace/api-client-react";
import { Clock } from "lucide-react";
import { EmptyState, Panel } from "@/components/ds";
import { cn } from "@/lib/utils";
import { HEAT_CELL, HEAT_FLAT, heatCellStyle } from "@/components/shared/charts/heat";
import {
  HOUR_ORDER, REGULAR_COLS, dayKey, fmtMetricCompact, fmtValue, heatBg, hourKey, hourLabel, isClosed, isLoss, isWin, valueOf,
  weekdayIdx, weekdayLabel, type Metric,
} from "./metrics";
import { fmtRate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { statsI18n } from "@/i18n/ns/stats";
import { winRateOf } from "@/lib/trade-math";

const sd = (n: number) => commonI18n.t("units.tradesShort", { count: n });

export type Cell = { n: number; closed: number; wins: number; losses: number; v: number | null };
const empty = (): Cell => ({ n: 0, closed: 0, wins: 0, losses: 0, v: null });
const add = (c: Cell, t: Trade, metric: Metric) => {
  c.n++;
  if (isClosed(t)) {
    c.closed++;
    if (isWin(t)) c.wins++;
    if (isLoss(t)) c.losses++;
    const v = valueOf(t, metric);
    if (v != null) c.v = (c.v ?? 0) + v;
  }
};

/**
 * Weekday × entry hour heatmap (MAKSIM-14): the exact entry time (ET, PropReports `openedAt` or a timed `date`)
 * places each trade; trades without a time go to the «без времени» column. Colour = sum of the metric; text also
 * shows WR and count.
 */
/** Cells of the grid keyed "weekday|hour" from the trades (the server sends the same cells in the staff view). */
export function heatCellsOf(trades: Trade[], metric: Metric): Map<string, Cell> {
  const grid = new Map<string, Cell>();
  for (const t of trades) {
    const k = dayKey(t);
    if (!k) continue;
    const id = `${weekdayIdx(k)}|${hourKey(t)}`;
    if (!grid.has(id)) grid.set(id, empty());
    add(grid.get(id)!, t, metric);
  }
  return grid;
}

const merge = (into: Cell, c: Cell) => {
  into.n += c.n; into.closed += c.closed; into.wins += c.wins; into.losses += c.losses;
  if (c.v != null) into.v = (into.v ?? 0) + c.v;
};

export function TimeHeatmap({ trades, cells, metric }: {
  trades?: Trade[];
  /** Precomputed cells (staff view, GET /api/stats/aggregate) instead of the trades. */
  cells?: Map<string, Cell>;
  metric: Metric;
}) {
  const { t } = statsI18n.useT();
  const { cols, rows, colTotals, max, noTime, total } = useMemo(() => {
    const grid = cells ?? heatCellsOf(trades ?? [], metric);
    const present = new Set([...grid.keys()].map((id) => id.split("|")[1]!));
    const used = HOUR_ORDER.filter((k) => (REGULAR_COLS as readonly string[]).includes(k) || present.has(k));
    const hasWeekend = [...grid.keys()].some((id) => Number(id.split("|")[0]) >= 5);
    const dayIdx = hasWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
    const rowT = new Map<number, Cell>();
    const colT = new Map<string, Cell>();
    let n = 0;
    for (const [id, c] of grid) {
      const [ds, s] = id.split("|") as [string, string];
      const d = Number(ds);
      if (!rowT.has(d)) rowT.set(d, empty());
      if (!colT.has(s)) colT.set(s, empty());
      merge(rowT.get(d)!, c);
      merge(colT.get(s)!, c);
      n += c.n;
    }
    const m = Math.max(0, ...[...grid.values()].map((c) => Math.abs(c.v ?? 0)));
    return {
      cols: used,
      rows: dayIdx.map((d) => ({ d, cells: used.map((s) => grid.get(`${d}|${s}`) ?? empty()), total: rowT.get(d) ?? empty() })),
      colTotals: used.map((s) => colT.get(s) ?? empty()),
      max: m,
      noTime: colT.get("none")?.n ?? 0,
      total: n,
    };
  }, [trades, cells, metric]);

  const valText = (c: Cell) => (c.v != null ? fmtMetricCompact(c.v, metric) : c.wins + c.losses ? fmtRate((winRateOf(c.wins, c.losses) ?? 0)) : "");
  const toneCls = (v: number | null) => (v == null ? "text-foreground" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-foreground");

  return (
    <Panel
      title={t("heatmap.title")}
      icon={Clock}
      description={t("heatmap.hint")}
    >
      {total === 0 ? (
        <EmptyState title={t("heatmap.empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table data-density="fixed" className="w-full min-w-[440px] table-fixed border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="w-7 text-left font-normal text-muted-foreground"><span className="sr-only">{t("heatmap.day")}</span></th>
                {cols.map((s) => <th key={s} scope="col" className="px-0.5 pb-1 text-center text-2xs font-medium leading-tight text-muted-foreground">{hourLabel(s)}</th>)}
                <th scope="col" className="px-0.5 pb-1 text-center text-2xs font-semibold leading-tight text-foreground/80">{t("heatmap.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.d}>
                  <th scope="row" className="pr-1 text-left font-medium text-muted-foreground">{weekdayLabel(r.d)}</th>
                  {r.cells.map((c, i) => {
                    const label = `${weekdayLabel(r.d)}, ${hourLabel(cols[i])}: ${sd(c.n)}${c.wins + c.losses ? `, WR ${fmtRate((winRateOf(c.wins, c.losses) ?? 0))}` : ""}${c.v != null ? `, ${fmtValue(c.v, metric)}` : ""}`;
                    return (
                      <td
                        key={cols[i]}
                        title={label}
                        aria-label={label}
                        style={c.n ? heatCellStyle(heatBg(c.v ?? 0, max) ?? HEAT_FLAT) : undefined}
                        className={cn(
                          "h-12 border px-1 text-center align-middle tabular-nums",
                          c.n ? cn(HEAT_CELL, "border-transparent") : "rounded-[10px] border-dashed border-[hsl(var(--border)/0.4)]",
                          r.d >= 5 && !c.n && "opacity-50",
                        )}
                      >
                        {c.n > 0 && (
                          <div className="whitespace-nowrap text-2xs leading-tight tracking-tight">
                            <div className="font-semibold text-foreground">{valText(c)}</div>
                            <div className="text-2xs text-foreground/60">{sd(c.n)}</div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="rounded-[10px] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-1 text-center tabular-nums">
                    {r.total.n > 0 ? (
                      <div className="whitespace-nowrap text-2xs leading-tight tracking-tight">
                        <div className={cn("font-semibold", toneCls(r.total.v))}>{valText(r.total)}</div>
                        <div className="text-2xs text-muted-foreground">{sd(r.total.n)}</div>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="pr-1 pt-1 text-left font-semibold text-foreground/80">Σ</th>
                {colTotals.map((c, i) => (
                  <td key={cols[i]} className="h-10 rounded-[10px] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-1 text-center tabular-nums">
                    {c.n > 0 ? (
                      <div className="whitespace-nowrap text-2xs leading-tight tracking-tight">
                        <div className={cn("font-semibold", toneCls(c.v))}>{valText(c)}</div>
                        <div className="text-2xs text-muted-foreground">{sd(c.n)}</div>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("heatmap.footnote", { unit: metric === "r" ? "R" : "P&L" })}
            {noTime > 0 && ` ${t("heatmap.noTimeNote", { trades: commonI18n.t("units.trades", { count: noTime }) })}`}

          </p>
        </div>
      )}
    </Panel>
  );
}
