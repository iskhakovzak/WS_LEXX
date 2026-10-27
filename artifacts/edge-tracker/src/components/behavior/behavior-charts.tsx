/**
 * Столбчатые кривые поведения: нетто по номеру сделки в дне, по минутам после убытка, по часу входа.
 */
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented, usePersistentState } from "@/components/ds";
import * as React from "react";
import {
  BAR_RADIUS, CHART, GRID, GlassTooltip, MARGIN, WrapTick, X_AXIS, Y_AXIS, ZERO_LINE, tooltipProps, useChartMotion,
} from "@/components/shared/charts";
import { type Bucket } from "./api";
import { fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { behaviorI18n } from "@/i18n/ns/behavior";

const Y_W = 52;

type Mode = "avg" | "sum";

export const BucketBars = React.memo(function BucketBars({ data, ariaLabel, height = 200 }: { data: Bucket[]; ariaLabel: string; height?: number }) {
  const motion = useChartMotion();
  const [mode, setMode] = usePersistentState<Mode>("behavior.charts.mode", "avg");
  const rows = React.useMemo(() => data.map((b) => ({ ...b, value: mode === "avg" ? b.avgNet ?? 0 : b.net ?? 0 })), [data, mode]);
  const hasData = rows.some((r) => r.n > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <Segmented
          size="sm"
          ariaLabel={behaviorI18n.t("chart.modeAria", { label: ariaLabel })}
          value={mode}
          onChange={setMode}
          options={[{ value: "avg", label: behaviorI18n.t("chart.avg") }, { value: "sum", label: behaviorI18n.t("chart.sum") }]}
        />
      </div>
      {hasData ? (
        <div style={{ height }} role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={MARGIN}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...X_AXIS} interval={0} tick={<WrapTick />} height={44} />
              <YAxis {...Y_AXIS} width={Y_W} tickFormatter={(v: number) => fmtUsd(v, { signed: true, compact: true }) === "—" ? "0" : fmtUsd(v, { signed: true, compact: true })} />
              <ReferenceLine {...ZERO_LINE} />
              <Tooltip
                {...tooltipProps("bar")}
                content={<GlassTooltip tone="pnl" footer={(r) => {
                  const b = r as unknown as Bucket;
                  return `${commonI18n.t("units.trades", { count: b.n })} · WR ${fmtRate(b.winRate)}`;
                }} />}
                formatter={(v: number) => [fmtUsd(v, { signed: true, decimals: "auto" }), mode === "avg" ? behaviorI18n.t("chart.avgNet") : behaviorI18n.t("chart.sumNet")]}
              />
              <Bar dataKey="value" radius={BAR_RADIUS} maxBarSize={40} {...motion}>
                {rows.map((r) => <Cell key={r.label} fill={r.value >= 0 ? CHART.up : CHART.down} fillOpacity={r.n ? 1 : 0.3} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">{behaviorI18n.t("chart.noData")}</p>

      )}
      <div className="grid gap-1 text-2xs text-muted-foreground tabular-nums" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, paddingLeft: Y_W + MARGIN.left, paddingRight: MARGIN.right }} aria-hidden="true">
        {rows.map((r) => <span key={r.label} className="truncate text-center">{r.n ? `n=${r.n}` : ""}</span>)}
      </div>
    </div>
  );
});
