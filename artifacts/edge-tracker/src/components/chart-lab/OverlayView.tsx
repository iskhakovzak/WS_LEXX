import * as React from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Layers } from "lucide-react";
import { EmptyState, Panel, Pill, Segmented } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART, GRID, GlassTooltip, STROKE, X_AXIS, Y_AXIS, ZERO_LINE, tint, tooltipProps } from "@/components/shared/charts";
import { fmtNum } from "@/lib/format";
import { chartLabI18n } from "@/i18n/ns/chartLab";
import { type LabPick, type OverlayResponse, type OverlayUnit, useLabFacets, useLabOverlay } from "./api";
import { LabPicker, defaultPick } from "./LabPicker";

/** Paths drawn (the statistics use every entry). */
const MAX_DRAWN = 40;
/** Minutes after the entry shown as numbers under the chart. */
export const CHECKPOINTS = [5, 15, 30, 60] as const;

/** Chart rows: one per minute, the cloud bands as [lo, hi] ranges and the drawn paths as p0…pN. */
export function overlayRows(o: OverlayResponse): Record<string, number | [number, number] | null>[] {
  const paths = o.paths.slice(0, MAX_DRAWN);
  return o.minutes.map((m, i) => {
    const row: Record<string, number | [number, number] | null> = {
      m, mean: o.mean[i], mfe: o.mfe.p50[i], mae: o.mae.p50[i],
      band: o.p25[i] != null && o.p75[i] != null ? [o.p25[i] as number, o.p75[i] as number] : null,
      band90: o.p10[i] != null && o.p90[i] != null ? [o.p10[i] as number, o.p90[i] as number] : null,
    };
    paths.forEach((p, k) => { row[`p${k}`] = p.values[i]; });
    return row;
  });
}

/** Mean / median MFE / median MAE at minute `m` after the entry (null when no entry has a bar there). */
export function checkpoint(o: OverlayResponse, m: number): { mean: number | null; mfe: number | null; mae: number | null; n: number } {
  const i = o.minutes.indexOf(m);
  return i < 0 ? { mean: null, mfe: null, mae: null, n: 0 } : { mean: o.mean[i], mfe: o.mfe.p50[i], mae: o.mae.p50[i], n: o.n[i] };
}

/**
 * «Наложение входов»: every entry of a setup or ticker aligned at its entry minute — the paths (green won, red lost),
 * the average path, the 25–75% and 10–90% clouds and the median running MFE / MAE: where the setup usually goes after
 * the entry. Bars from the archive only; entries whose day was never archived are counted, not drawn.
 */
export function OverlayView({ trader }: { trader: string }) {
  const { t } = chartLabI18n.useT();
  const facets = useLabFacets(trader);
  const [picked, setPicked] = React.useState<LabPick>(null);
  const pick = picked ?? defaultPick(facets.data);
  const [unit, setUnit] = React.useState<OverlayUnit>("pct");
  const q = useLabOverlay(trader, pick, unit);
  const o = q.data;
  const rows = React.useMemo(() => (o ? overlayRows(o) : []), [o]);
  const fmt = (v: number | null) => (v == null ? "—" : unit === "r" ? `${fmtNum(v, { decimals: 2, signed: true })}R` : `${fmtNum(v, { decimals: 2, signed: true })}%`);
  const drawn = Math.min(o?.paths.length ?? 0, MAX_DRAWN);
  return (
    <Panel
      title={t("stack.title")}
      icon={Layers}
      description={t("stack.hint")}
      actions={(
        <span className="flex flex-wrap items-center gap-2">
          <LabPicker facets={facets.data} value={pick} onChange={setPicked} />
          <Segmented<OverlayUnit> size="sm" ariaLabel={t("stack.unitAria")} value={unit} onChange={setUnit}
            options={[{ value: "pct", label: t("stack.unitPct") }, { value: "r", label: "R", disabled: (o?.withRisk ?? 0) < 5, title: t("stack.unitRHint") }]} />
        </span>
      )}
    >
      {facets.isLoading || (q.isLoading && pick) ? (
        <Skeleton className="h-[360px] rounded-2xl" />
      ) : !pick ? (
        <EmptyState compact icon={Layers} title={t("stack.noTradesTitle")} description={t("stack.noTrades")} />
      ) : !o || o.trades === 0 ? (
        <EmptyState compact icon={Layers} title={t("stack.noBarsTitle")} description={t("stack.noBars", { count: (o?.missing ?? 0) + (o?.coarse ?? 0) })} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Pill tone="neutral">{t("stack.entries", { count: o.trades })}</Pill>
            {o.missing > 0 && <Pill tone="warn" title={t("stack.missingHint")}>{t("stack.missing", { count: o.missing })}</Pill>}
            {(o.coarse ?? 0) > 0 && <Pill tone="neutral" title={t("stack.coarseHint")}>{t("stack.coarse", { count: o.coarse ?? 0 })}</Pill>}
            {drawn < o.trades && <Pill tone="neutral">{t("stack.drawn", { count: drawn })}</Pill>}
          </div>
          <div className="h-[340px]" role="img" aria-label={t("stack.aria", { name: pick.name })}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="m" type="number" domain={["dataMin", "dataMax"]} {...X_AXIS} ticks={[-10, 0, 5, 15, 30, 45, 60]} tickFormatter={(v: number) => (v === 0 ? t("stack.entry") : `${v > 0 ? "+" : ""}${v}`)} />
                <YAxis {...Y_AXIS} width={56} tickFormatter={(v: number) => fmt(v)} />
                <ReferenceLine {...ZERO_LINE} />
                <ReferenceLine x={0} stroke={CHART.axis} strokeDasharray="3 3" />
                <Area dataKey="band90" stroke="none" fill={tint("primary", 0.08)} isAnimationActive={false} name={t("stack.band90")} />
                <Area dataKey="band" stroke="none" fill={tint("primary", 0.18)} isAnimationActive={false} name={t("stack.band")} />
                {Array.from({ length: drawn }, (_, k) => (
                  <Line key={k} dataKey={`p${k}`} dot={false} isAnimationActive={false} connectNulls={false} legendType="none" tooltipType="none"
                    stroke={o.paths[k].win == null ? tint("muted-foreground", 0.25) : o.paths[k].win ? tint("up", 0.3) : tint("down", 0.3)} strokeWidth={1} />
                ))}
                <Line dataKey="mfe" dot={false} isAnimationActive={false} stroke={CHART.up} strokeDasharray="5 3" strokeWidth={1.5} name={t("stack.mfe")} />
                <Line dataKey="mae" dot={false} isAnimationActive={false} stroke={CHART.down} strokeDasharray="5 3" strokeWidth={1.5} name={t("stack.mae")} />
                <Line dataKey="mean" dot={false} isAnimationActive={false} stroke={CHART.accent} strokeWidth={STROKE + 0.5} name={t("stack.mean")} />
                <Tooltip {...tooltipProps("line")} content={<GlassTooltip />} labelFormatter={(m) => t("stack.minute", { m: String(m) })}
                  formatter={(v: number | [number, number], name: string) => [Array.isArray(v) ? `${fmt(v[0])} … ${fmt(v[1])}` : fmt(v), name]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-medium">{t("stack.after")}</th>
                <th className="py-1 text-right font-medium">{t("stack.mean")}</th>
                <th className="py-1 text-right font-medium">{t("stack.mfe")}</th>
                <th className="py-1 text-right font-medium">{t("stack.mae")}</th>
                <th className="py-1 text-right font-medium">n</th>
              </tr>
            </thead>
            <tbody>
              {CHECKPOINTS.map((m) => {
                const c = checkpoint(o, m);
                return (
                  <tr key={m} className="border-t border-border/50">
                    <td className="py-1.5">{t("stack.minutes", { m })}</td>
                    <td className={c.mean == null ? "py-1.5 text-right" : c.mean >= 0 ? "py-1.5 text-right text-up" : "py-1.5 text-right text-down"}>{fmt(c.mean)}</td>
                    <td className="py-1.5 text-right text-up">{fmt(c.mfe)}</td>
                    <td className="py-1.5 text-right text-down">{fmt(c.mae)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{c.n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-2xs text-muted-foreground">{t("stack.footnote")}</p>
        </div>
      )}
    </Panel>
  );
}
