import { useMemo } from "react";
import { GitCompare } from "lucide-react";
import { EmptyState, Panel, toneText } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BenchRow, MetricDef } from "./api";
import { EquityLines, Radar } from "./charts";
import { SERIES_COLORS, fmtMetric } from "./format";
import { PersonSelect } from "@/components/people/person-select";

/** Two traders side by side: percentile radar, equity curves, metric-by-metric table with the winner marked. */
export function CompareView({
  rows, metrics, a, b, onChange,
}: {
  rows: BenchRow[];
  metrics: MetricDef[];
  a: string | null;
  b: string | null;
  onChange: (a: string | null, b: string | null) => void;
}) {
  const ra = rows.find((r) => r.trader === a) ?? null;
  const rb = rows.find((r) => r.trader === b) ?? null;
  const radarAxes = useMemo(() => metrics.filter((m) => m.radar).map((m) => ({ key: m.key, label: m.label })), [metrics]);
  const pick = (which: "a" | "b") => (
    <PersonSelect
      value={(which === "a" ? a : b) ?? ""}
      onValueChange={(v) => (which === "a" ? onChange(v, b) : onChange(a, v))}
      options={rows.filter((r) => r.trader !== (which === "a" ? b : a)).map((r) => ({ value: r.trader, hint: `${r.trades} сд.` }))}
      placeholder={which === "a" ? "Трейдер A" : "Трейдер B"}
      ariaLabel={which === "a" ? "Первый трейдер" : "Второй трейдер"}
      className="w-48"
    />
  );
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES_COLORS[0] }} aria-hidden="true" />{pick("a")}
      <span className="text-muted-foreground">vs</span>
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES_COLORS[1] }} aria-hidden="true" />{pick("b")}
      <span className="text-xs text-muted-foreground">или отметьте двоих галочкой в таблице</span>
    </div>
  );
  if (!ra || !rb) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <EmptyState icon={GitCompare} title="Выберите двух трейдеров" description="Радар перцентилей внутри деска, две кривые капитала и разница по каждой метрике." />
      </div>
    );
  }
  const mixedUnits = ra.equityUnit !== rb.equityUnit;
  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Panel title="Радар" description="Перцентиль внутри деска, 1 = лучший">
          <div className="grid place-items-center">
            <Radar axes={radarAxes} series={[
              { name: ra.trader, color: SERIES_COLORS[0], values: ra.percentiles ?? {} },
              { name: rb.trader, color: SERIES_COLORS[1], values: rb.percentiles ?? {} },
            ]} />
          </div>
        </Panel>
        <Panel title="Кривые капитала" description={mixedUnits ? "Разные единицы ($ и R) — кривые показаны отдельно" : ra.equityUnit === "r" ? "Накопленный R по дням" : "Накопленное нетто по дням"}>
          {mixedUnits ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <EquityLines height={200} series={[{ name: ra.trader, color: SERIES_COLORS[0], unit: ra.equityUnit, points: ra.equity }]} />
              <EquityLines height={200} series={[{ name: rb.trader, color: SERIES_COLORS[1], unit: rb.equityUnit, points: rb.equity }]} />
            </div>
          ) : (
            <EquityLines series={[
              { name: ra.trader, color: SERIES_COLORS[0], unit: ra.equityUnit, points: ra.equity },
              { name: rb.trader, color: SERIES_COLORS[1], unit: rb.equityUnit, points: rb.equity },
            ]} />
          )}
        </Panel>
      </div>
      <Panel title="По метрикам" padded={false} bodyClassName="p-2">
        <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Метрика</th>
              <th className="px-3 py-2 text-right font-medium">{ra.trader}</th>
              <th className="px-3 py-2 text-right font-medium">{rb.trader}</th>
              <th className="px-3 py-2 text-left font-medium">Лучше</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const va = ra[m.key] as number | null;
              const vb = rb[m.key] as number | null;
              const win = va == null || vb == null || va === vb || m.neutral ? null : (m.better === "higher" ? va > vb : va < vb) ? "a" : "b";
              return (
                <tr key={m.key} className="border-t border-border/50">
                  <td className="px-3 py-1.5 text-muted-foreground" title={m.hint}>{m.label}</td>
                  <td className={cn("px-3 py-1.5 text-right", win === "a" && cn("font-semibold", toneText("up")))}>{fmtMetric(m, va)}</td>
                  <td className={cn("px-3 py-1.5 text-right", win === "b" && cn("font-semibold", toneText("up")))}>{fmtMetric(m, vb)}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{m.neutral ? "стиль" : win === "a" ? ra.trader : win === "b" ? rb.trader : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Panel>
    </div>
  );
}
