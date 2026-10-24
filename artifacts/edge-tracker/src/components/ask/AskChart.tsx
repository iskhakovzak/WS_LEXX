// Mini chart of an «Спроси журнал» answer: equity curve, bars by group, or a distribution.
// Up/down colours only where the value is money (net); counts and win rates stay neutral.
import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ACTIVE_DOT, BAR_RADIUS, BAR_RADIUS_H, CHART, GRID, GlassTooltip, STROKE, X_AXIS, Y_AXIS, ZERO_LINE, ZERO_LINE_X,
  pnlPaint, tint, tooltipProps, useChartMotion,
} from "@/components/shared/charts";
import { fmtMetric, type AskChart as AskChartData } from "@/lib/ask/aggregate";
import { fmtUsd } from "@/lib/format";
import { askI18n } from "@/i18n/ns/ask";

const NEUTRAL = CHART.accent;
const MUTED = tint("muted-foreground", 0.45);
/** Horizontal bars: faint guides along the value axis only. */
const GRID_V = { horizontal: false, vertical: true, stroke: "hsl(var(--border))", strokeOpacity: 0.45 } as const;
/** Bars always start at zero (two negative groups must not look like a big gap). */
const ZERO_DOMAIN: [(v: number) => number, (v: number) => number] = [(min) => Math.min(0, min), (max) => Math.max(0, max)];

export function AskChart({ chart, height = 200, onBarClick }: { chart: AskChartData; height?: number; onBarClick?: (ask: string) => void }) {
  const { t } = askI18n.useT();
  const motion = useChartMotion();
  const gid = React.useId().replace(/:/g, "");
  const paint = React.useMemo(() => (chart.type === "equity" ? pnlPaint(`eq-${gid}`, chart.points.map((p) => p.v)) : null), [chart, gid]);

  if (chart.type === "equity") {
    return (
      <figure aria-label={chart.title} className="min-w-0">
        <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{chart.title}</figcaption>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart.points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              {paint?.defs}
              <CartesianGrid {...GRID} />
              <XAxis dataKey="i" {...X_AXIS} minTickGap={32} />
              <YAxis {...Y_AXIS} width={56} tickFormatter={(v: number) => fmtUsd(v, { compact: true })} />
              <ReferenceLine {...ZERO_LINE} />
              <Tooltip
                {...tooltipProps("line")}
                content={<GlassTooltip tone="pnl" />}
                labelFormatter={(_, p) => (p?.[0]?.payload ? `#${p[0].payload.i} · ${p[0].payload.label}` : "")}
                formatter={(v: number) => [fmtUsd(v, { signed: true }), t("chart.cumNet")]}
              />
              <Area type="monotone" dataKey="v" stroke={paint?.stroke} strokeWidth={STROKE} fill={paint?.fill} {...motion} dot={false} activeDot={{ ...ACTIVE_DOT, fill: CHART.fg }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </figure>
    );
  }

  if (chart.type === "bars") {
    const money = chart.metric === "net" || chart.metric === "avg";
    const horizontal = chart.rows.length > 8 || chart.rows.some((r) => r.label.length > 10);
    const h = horizontal ? Math.max(height, chart.rows.length * 26 + 16) : height;
    const fill = (v: number, hl?: boolean) => (money ? (v >= 0 ? CHART.up : CHART.down) : hl ? NEUTRAL : MUTED);
    const fmt = (v: number) => fmtMetric(v, chart.metric);
    const labelW = Math.min(230, Math.max(60, Math.max(...chart.rows.map((r) => Math.min(30, r.label.length))) * 7.5 + 28));
    const clickable = Boolean(onBarClick) && chart.rows.some((r) => r.ask);
    const onClick = (d: { ask?: string } | undefined) => { if (d?.ask && onBarClick) onBarClick(d.ask); };
    return (
      <figure aria-label={chart.title} className="min-w-0">
        <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{chart.title}</figcaption>
        <div style={{ height: h }}>
          <ResponsiveContainer width="100%" height="100%">
            {horizontal ? (
              <BarChart data={chart.rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_V} />
                <XAxis type="number" {...X_AXIS} domain={ZERO_DOMAIN} tickFormatter={money ? (v: number) => fmtUsd(v, { compact: true }) : undefined} />
                <YAxis type="category" dataKey="label" {...Y_AXIS} width={labelW} interval={0} tickFormatter={(v: string) => (v.length > 30 ? `${v.slice(0, 29)}…` : v)} />
                <ReferenceLine {...ZERO_LINE_X} />
                <Tooltip {...tooltipProps("bar")} content={<GlassTooltip tone={money ? "pnl" : "plain"} />} formatter={(v: number) => [fmt(v), t("chart.value")]} />
                <Bar dataKey="value" radius={BAR_RADIUS_H} {...motion} cursor={clickable ? "pointer" : undefined} onClick={onClick}>
                  {chart.rows.map((r) => <Cell key={r.key} fill={fill(r.value, r.highlight)} fillOpacity={chart.rows.some((x) => x.highlight) && !r.highlight ? 0.45 : 0.9} />)}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={chart.rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" {...X_AXIS} interval={0} />
                <YAxis {...Y_AXIS} width={56} domain={ZERO_DOMAIN} tickFormatter={money ? (v: number) => fmtUsd(v, { compact: true }) : undefined} />
                <ReferenceLine {...ZERO_LINE} />
                <Tooltip {...tooltipProps("bar")} content={<GlassTooltip tone={money ? "pnl" : "plain"} />} formatter={(v: number) => [fmt(v), t("chart.value")]} />
                <Bar dataKey="value" radius={BAR_RADIUS} maxBarSize={56} {...motion} cursor={clickable ? "pointer" : undefined} onClick={onClick}>
                  {chart.rows.map((r) => <Cell key={r.key} fill={fill(r.value, r.highlight)} fillOpacity={chart.rows.some((x) => x.highlight) && !r.highlight ? 0.45 : 0.9} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </figure>
    );
  }

  // Distribution: bin colour = sign of money in the bin (net); count axis is neutral.
  return (
    <figure aria-label={chart.title} className="min-w-0">
      <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{chart.title}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart.bins} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...X_AXIS} tick={chart.bins.length > 8 ? false : X_AXIS.tick} interval={0} />
            <YAxis {...Y_AXIS} width={40} allowDecimals={false} />
            <Tooltip {...tooltipProps("bar")} content={<GlassTooltip />} formatter={(v: number) => [v, t("chart.trades")]} />
            <Bar dataKey="value" radius={BAR_RADIUS} {...motion}>
              {chart.bins.map((b, i) => <Cell key={i} fill={b.tone === "up" ? CHART.up : b.tone === "down" ? CHART.down : MUTED} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
