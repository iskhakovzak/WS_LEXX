// Mini chart of an «Спроси журнал» answer: equity curve, bars by group, or a distribution.
// Up/down colours only where the value is money (net); counts and win rates stay neutral.
import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CSSProperties } from "react";
import { fmtMetric, fmtMoney, type AskChart as AskChartData } from "@/lib/ask/aggregate";

const TOOLTIP: CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.95)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
};
const CURSOR = { fill: "hsl(var(--muted-foreground) / 0.08)" };
const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 12, tickLine: false, axisLine: false } as const;
const GRID = "hsl(var(--border))";
const UP = "hsl(var(--up))";
const DOWN = "hsl(var(--down))";
const NEUTRAL = "hsl(var(--chart-1))";
const MUTED = "hsl(var(--muted-foreground) / 0.45)";
/** Bars always start at zero (two negative groups must not look like a big gap). */
const ZERO_DOMAIN: [(v: number) => number, (v: number) => number] = [(min) => Math.min(0, min), (max) => Math.max(0, max)];

const compactMoney = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : a.toFixed(0);
  return `${v < 0 ? "−" : ""}$${s}`;
};

export function AskChart({ chart, height = 200, onBarClick }: { chart: AskChartData; height?: number; onBarClick?: (ask: string) => void }) {
  const reduce = useReducedMotion();
  const anim = !reduce;
  const gid = React.useId().replace(/:/g, "");

  if (chart.type === "equity") {
    const last = chart.points[chart.points.length - 1]?.v ?? 0;
    const color = last >= 0 ? UP : DOWN;
    return (
      <figure aria-label={chart.title} className="min-w-0">
        <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{chart.title}</figcaption>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart.points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`eq-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="i" {...AXIS} minTickGap={32} />
              <YAxis {...AXIS} width={56} tickFormatter={compactMoney} />
              <ReferenceLine y={0} stroke={GRID} />
              <Tooltip
                contentStyle={TOOLTIP}
                cursor={{ stroke: GRID }}
                labelFormatter={(_, p) => (p?.[0]?.payload ? `#${p[0].payload.i} · ${p[0].payload.label}` : "")}
                formatter={(v: number) => [fmtMoney(v), "Нетто, накопл."]}
              />
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#eq-${gid})`} isAnimationActive={anim} animationDuration={240} dot={false} />
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
    const fill = (v: number, hl?: boolean) => (money ? (v >= 0 ? UP : DOWN) : hl ? NEUTRAL : MUTED);
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
                <CartesianGrid stroke={GRID} horizontal={false} strokeOpacity={0.5} />
                <XAxis type="number" {...AXIS} domain={ZERO_DOMAIN} tickFormatter={money ? compactMoney : undefined} />
                <YAxis type="category" dataKey="label" {...AXIS} width={labelW} interval={0} tickFormatter={(v: string) => (v.length > 30 ? `${v.slice(0, 29)}…` : v)} />
                <ReferenceLine x={0} stroke={GRID} />
                <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} formatter={(v: number) => [fmt(v), "Значение"]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={anim} animationDuration={240} cursor={clickable ? "pointer" : undefined} onClick={onClick}>
                  {chart.rows.map((r) => <Cell key={r.key} fill={fill(r.value, r.highlight)} fillOpacity={chart.rows.some((x) => x.highlight) && !r.highlight ? 0.45 : 0.9} />)}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={chart.rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} strokeOpacity={0.5} />
                <XAxis dataKey="label" {...AXIS} interval={0} />
                <YAxis {...AXIS} width={56} domain={ZERO_DOMAIN} tickFormatter={money ? compactMoney : undefined} />
                <ReferenceLine y={0} stroke={GRID} />
                <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} formatter={(v: number) => [fmt(v), "Значение"]} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={anim} animationDuration={240} cursor={clickable ? "pointer" : undefined} onClick={onClick}>
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
            <CartesianGrid stroke={GRID} vertical={false} strokeOpacity={0.5} />
            <XAxis dataKey="label" {...AXIS} tick={chart.bins.length > 8 ? false : undefined} interval={0} />
            <YAxis {...AXIS} width={40} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} formatter={(v: number) => [v, "Сделок"]} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={anim} animationDuration={240}>
              {chart.bins.map((b, i) => <Cell key={i} fill={b.tone === "up" ? UP : b.tone === "down" ? DOWN : MUTED} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
