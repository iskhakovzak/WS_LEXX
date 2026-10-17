import { useState } from "react";
import { DataTable, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { BenchRow, MetricDef } from "./api";
import { fmtMetric, heatStyle } from "./format";

type Mode = "value" | "pct";

/** Traders × metrics; colour = percentile inside the desk (green = best), text = value or percentile. */
export function BenchmarkHeatmap({ rows, metrics, median }: { rows: BenchRow[]; metrics: MetricDef[]; median: Record<string, number | null> }) {
  const [mode, setMode] = useState<Mode>("value");
  const ranked = rows.filter((r) => r.qualified);
  if (!ranked.length) return <p className="py-8 text-center text-sm text-muted-foreground">Нет трейдеров с достаточным числом сделок.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded" style={heatStyle(0)} aria-hidden="true" /> худший</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded" style={heatStyle(0.5)} aria-hidden="true" /> медиана</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded" style={heatStyle(1)} aria-hidden="true" /> лучший</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded" style={heatStyle(0.8, true)} aria-hidden="true" /> стиль (без оценки)</span>
        </div>
        <Segmented<Mode> size="sm" ariaLabel="Что показывать в ячейках" value={mode} onChange={setMode}
          options={[{ value: "value", label: "Значения" }, { value: "pct", label: "Перцентили" }]} />
      </div>
      <DataTable stickyFirstCol maxHeight="70vh" ariaLabel="Тепловая карта метрик">
        <table>
          <thead>
            <tr>
              <th scope="col">Трейдер</th>
              {metrics.map((m) => (
                <th key={m.key} scope="col" className="text-center" title={`${m.hint}${m.neutral ? " · стиль, не оценка" : m.better === "lower" ? " · меньше — лучше" : ""}`}>
                  <span className={cn(m.neutral && "italic")}>{m.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.trader}>
                <td className="font-medium text-foreground">{r.trader}<div className="text-2xs font-normal text-muted-foreground">{r.trades} сд.</div></td>
                {metrics.map((m) => {
                  const p = r.percentiles?.[m.key] ?? null;
                  const v = r[m.key] as number | null;
                  return (
                    <td key={m.key} className="!px-1.5 text-center text-xs" style={heatStyle(p, m.neutral)}
                      title={`${r.trader} · ${m.label}: ${fmtMetric(m, v)}${p != null ? ` · перцентиль ${Math.round(p * 100)}` : ""}`}>
                      {p == null ? <span className="text-muted-foreground">—</span> : mode === "pct" ? Math.round(p * 100) : fmtMetric(m, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="text-xs text-muted-foreground">Медиана деска</td>
              {metrics.map((m) => <td key={m.key} className="text-center text-xs text-muted-foreground">{fmtMetric(m, median[m.key])}</td>)}
            </tr>
          </tbody>
        </table>
      </DataTable>
      <p className="text-2xs text-muted-foreground">Перцентиль считается среди трейдеров с минимумом сделок; у метрик «меньше — лучше» шкала перевёрнута. Курсивом — метрики стиля (активность, удержание, открытие) — без оценки «хорошо/плохо».</p>
    </div>
  );
}
