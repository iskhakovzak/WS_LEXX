import { useMemo } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AXIS, CHART_TOOLTIP_STYLE, GRID, fmtUsd } from "@/components/analytics-page/metrics";
import type { DayResult, EquityPoint } from "./api";

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function shortDay(d: string): string {
  const [, m, dd] = d.split("-");
  return `${Number(dd)} ${MONTHS[Number(m) - 1] ?? m}`;
}

export const SERIES_BASE = "Как было";
export const SERIES_SCENARIO = "Как стало";

/** Base and scenario equity on one day axis (the scenario is carried forward on days it has no trades). */
export function mergeEquity(base: EquityPoint[], scenario: EquityPoint[], hasScenario: boolean) {
  const sc = new Map(scenario.map((p) => [p.day, p.cum]));
  let last = 0;
  return base.map((p) => {
    if (sc.has(p.day)) last = sc.get(p.day)!;
    return { day: p.day, label: shortDay(p.day), [SERIES_BASE]: p.cum, [SERIES_SCENARIO]: hasScenario ? last : null } as Record<string, string | number | null>;
  });
}

/** One large chart: «как было» (muted) vs «как стало» (accent). Fixed height so nothing jumps while recomputing. */
export function EquityChart({ base, scenario, hasScenario, height = 340 }: { base: EquityPoint[]; scenario: EquityPoint[]; hasScenario: boolean; height?: number }) {
  const data = useMemo(() => mergeEquity(base, scenario, hasScenario), [base, scenario, hasScenario]);
  return (
    <div style={{ height }} role="img" aria-label={hasScenario ? "Кривая капитала: как было и как стало" : "Кривая капитала по факту"}>
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="sim-scenario-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} minTickGap={36} />
            <YAxis {...AXIS} tickFormatter={(v: number) => fmtUsd(v)} width={76} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => fmtUsd(v)} labelFormatter={(_, p) => (p?.[0]?.payload?.day as string) ?? ""} />
            <Legend verticalAlign="top" align="right" height={28} iconType="plainline" />
            <ReferenceLine y={0} stroke={GRID} />
            <Line type="monotone" dataKey={SERIES_BASE} stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1.5} strokeDasharray={hasScenario ? "4 3" : undefined} isAnimationActive={false} />
            {hasScenario && (
              <Area type="monotone" dataKey={SERIES_SCENARIO} stroke="hsl(var(--primary))" strokeWidth={2.25} fill="url(#sim-scenario-fill)" dot={false} isAnimationActive={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="grid h-full place-items-center text-sm text-muted-foreground">Нет закрытых сделок за период</p>
      )}
    </div>
  );
}

const BIN_EDGES = [-1000, -500, -300, -200, -100, -50, -20, 0, 20, 50, 100, 200, 300, 500, 1000];
/** Compact edge: −1k, −500, 0, +50, +1k. */
function short(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${a / 1000}k` : String(a);
  return v < 0 ? `−${s}` : v > 0 ? `+${s}` : "0";
}
/** Short axis label (the upper edge of the bin); the tooltip shows the full range. */
function binTick(i: number): string {
  if (i === 0) return `<${short(BIN_EDGES[0])}`;
  if (i === BIN_EDGES.length) return `>${short(BIN_EDGES[BIN_EDGES.length - 1])}`;
  return short(BIN_EDGES[i]);
}
function binLabel(i: number): string {
  if (i === 0) return `меньше ${fmtUsd(BIN_EDGES[0])}`;
  if (i === BIN_EDGES.length) return `больше ${fmtUsd(BIN_EDGES[BIN_EDGES.length - 1])}`;
  return `от ${fmtUsd(BIN_EDGES[i - 1])} до ${fmtUsd(BIN_EDGES[i])}`;
}
function binOf(v: number): number {
  let i = 0;
  while (i < BIN_EDGES.length && v >= BIN_EDGES[i]) i++;
  return i;
}

/** Histogram of daily net results, base next to scenario. */
export function DailyHistogram({ base, scenario, hasScenario }: { base: DayResult[]; scenario: DayResult[]; hasScenario: boolean }) {
  const data = useMemo(() => {
    const bins = Array.from({ length: BIN_EDGES.length + 1 }, (_, i) => ({ i, tick: binTick(i), label: binLabel(i), [SERIES_BASE]: 0, [SERIES_SCENARIO]: 0, neg: i <= BIN_EDGES.indexOf(0) }));
    for (const d of base) bins[binOf(d.net)][SERIES_BASE]++;
    if (hasScenario) for (const d of scenario) bins[binOf(d.net)][SERIES_SCENARIO]++;
    const first = bins.findIndex((b) => b[SERIES_BASE] || b[SERIES_SCENARIO]);
    let last = bins.length - 1;
    while (last > 0 && !bins[last][SERIES_BASE] && !bins[last][SERIES_SCENARIO]) last--;
    return first < 0 ? [] : bins.slice(first, last + 1);
  }, [base, scenario, hasScenario]);
  return (
    <div className="h-[220px]">
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="tick" {...AXIS} interval={0} fontSize={12} />
            <YAxis {...AXIS} allowDecimals={false} width={32} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => `${v} дн.`} labelFormatter={(_, p) => (p?.[0]?.payload?.label as string) ?? ""} />
            <Legend />
            <Bar dataKey={SERIES_BASE} isAnimationActive={false} radius={[4, 4, 0, 0]}>
              {data.map((d) => <Cell key={d.i} fill={d.neg ? "hsl(var(--down) / 0.4)" : "hsl(var(--up) / 0.4)"} />)}
            </Bar>
            {hasScenario && (
              <Bar dataKey={SERIES_SCENARIO} isAnimationActive={false} radius={[4, 4, 0, 0]}>
                {data.map((d) => <Cell key={d.i} fill={d.neg ? "hsl(var(--down))" : "hsl(var(--up))"} />)}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="grid h-full place-items-center text-sm text-muted-foreground">Нет данных</p>
      )}
    </div>
  );
}

export function ChartSkeleton({ height = 340 }: { height?: number }) {
  return <Skeleton className="rounded-xl" style={{ height }} />;
}
