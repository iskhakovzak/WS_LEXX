import { useMemo, useState, type ReactNode } from "react";
import type { Trade } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import { EVENT_LABEL } from "@/components/trades/trade-utils";
import { fmtValue, groupBy, sessionKey, sessionLabel, type GroupStat, type Metric } from "./metrics";
import { fmtRate } from "@/lib/format";

export type Dimension = "trader" | "setup" | "sector" | "ticker" | "session" | "conviction";

const DIMS: { value: Dimension; label: string; col: string; key: (t: Trade) => string | null | undefined }[] = [
  { value: "trader", label: "Трейдер", col: "Трейдер", key: (t) => t.trader },
  { value: "setup", label: "Сетап", col: "Сетап / событие", key: (t) => t.setup || (t.eventType ? EVENT_LABEL[t.eventType] ?? t.eventType : null) },
  { value: "sector", label: "Сектор", col: "Сектор", key: (t) => t.sector },
  { value: "ticker", label: "Тикер", col: "Тикер", key: (t) => t.ticker?.toUpperCase() },
  { value: "session", label: "Сессия", col: "Сессия", key: (t) => sessionLabel(sessionKey(t)) },
  { value: "conviction", label: "Убеждённость", col: "Убеждённость", key: (t) => (t.conviction != null ? `${t.conviction}★` : null) },
];

type SortKey = "key" | "value" | "count" | "winRate" | "avg";
const LIMIT = 8;

/** Compact "where do I make / lose" scorecard table. Deep breakdowns live in /analytics. */
export function BreakdownPanel({
  trades, metric, dimension, onDimension, onPickTrader, hideTrader = false,
}: {
  trades: Trade[];
  metric: Metric;
  dimension: Dimension;
  onDimension: (d: Dimension) => void;
  onPickTrader?: (name: string) => void;
  /** A trader sees only own trades: the «Трейдер» cut is one row, so it is not offered. */
  hideTrader?: boolean;
}) {
  const dims = hideTrader ? DIMS.filter((d) => d.value !== "trader") : DIMS;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const dim = dims.find((d) => d.value === dimension) ?? dims[0];

  const rows = useMemo(() => {
    const g = groupBy(trades, dim.key, metric);
    if (sort.key === "key") return g.sort((a, b) => a.key.localeCompare(b.key, "ru", { numeric: true }) * sort.dir);
    const val = (r: GroupStat) => (sort.key === "count" ? r.count : sort.key === "winRate" ? r.winRate : sort.key === "avg" ? r.avg : r.value);
    return g.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return b.count - a.count;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.dir || b.count - a.count;
    });
  }, [trades, dim, metric, sort]);

  const maxAbs = Math.max(0, ...rows.map((r) => Math.abs(r.value ?? 0)));
  const visible = showAll ? rows : rows.slice(0, LIMIT);

  const SortTh = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) => {
    const active = sort.key === k;
    return (
      <th scope="col" className={cn("px-2 py-2 font-medium", k === "key" ? "text-left" : "text-right", className)} aria-sort={active ? (sort.dir === -1 ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === "key" ? 1 : -1 }))}
          className={cn("inline-flex items-center gap-1 rounded-full px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "text-foreground" : "text-muted-foreground")}
        >
          {children}
          {active ? (sort.dir === -1 ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />) : <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
        </button>
      </th>
    );
  };

  return (
    <Panel
      title="Где зарабатываю и теряю"
      icon={Layers}
      description="Группировка сделок периода — нажмите на заголовок для сортировки"
    >
      <Segmented<Dimension>
        size="sm"
        ariaLabel="Группировать по"
        value={dim.value}
        onChange={(d) => { onDimension(d); setShowAll(false); }}
        options={dims.map((d) => ({ value: d.value, label: d.label }))}
        className="mb-3"
      />
      {rows.length === 0 ? (
        <EmptyState title="Нет сделок за период" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-[hsl(var(--border))]">
                <SortTh k="key">{dim.col}</SortTh>
                <SortTh k="count">Сделок</SortTh>
                <SortTh k="winRate">WR</SortTh>
                <SortTh k="avg" className="hidden sm:table-cell">Ср.</SortTh>
                <SortTh k="value">Итого</SortTh>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const w = maxAbs > 0 && r.value != null ? Math.max(4, (Math.abs(r.value) / maxAbs) * 100) : 0;
                const clickable = dimension === "trader" && onPickTrader && r.key !== "—";
                return (
                  <tr key={r.key} className="border-b border-[hsl(var(--border)/0.5)] last:border-0">
                    <td className="max-w-[160px] px-2 py-2">
                      {clickable ? (
                        <button
                          type="button"
                          className="truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          onClick={() => onPickTrader!(r.key)}
                          title={`Показать отчёт только по ${r.key}`}
                        >
                          {r.key}
                        </button>
                      ) : (
                        <span className="block truncate font-medium text-foreground" title={r.key}>{r.key}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{r.count}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums", r.winRate == null ? "text-muted-foreground" : r.winRate >= 0.5 ? "text-up" : "text-down")}>
                      {fmtRate(r.winRate)}
                    </td>
                    <td className="hidden px-2 py-2 text-right tabular-nums text-muted-foreground sm:table-cell">{fmtValue(r.avg, metric)}</td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[var(--glass-hover-bg)] md:block" aria-hidden="true">
                          <div className={cn("h-full rounded-full", (r.value ?? 0) >= 0 ? "bg-up" : "bg-down")} style={{ width: `${w}%` }} />
                        </div>
                        <span className={cn("font-semibold tabular-nums", r.value == null ? "text-muted-foreground" : r.value > 0 ? "text-up" : r.value < 0 ? "text-down" : "text-foreground")}>
                          {fmtValue(r.value, metric)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > LIMIT && (
            <Button variant="ghost" size="sm" className="mt-2 rounded-full" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Свернуть" : `Показать все (${rows.length})`}
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
