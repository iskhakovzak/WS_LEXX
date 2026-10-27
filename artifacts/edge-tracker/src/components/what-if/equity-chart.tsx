import { useId, useMemo } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ACTIVE_DOT, BAR_RADIUS, CHART, GRID, GlassTooltip, MARGIN, STROKE, STROKE_THIN, X_AXIS, Y_AXIS, ZERO_LINE,
  areaGradient, barGradients, pnlPaint, tint, tooltipProps, useBarFocus, useChartMotion,
} from "@/components/shared/charts";
import { fmtDate, fmtDateCustom, fmtDeskDate, fmtUsd } from "@/lib/format";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import type { DayResult, EquityPoint } from "./api";

/** Axis label: «16 окт.»; with the year («16 окт. 25») when the curve spans more than one calendar year (DENIS-36). */
export function shortDay(d: string, withYear = false): string {
  return withYear ? fmtDateCustom(d, { day: "numeric", month: "short", year: "2-digit" }) : fmtDate(d, "dayMonth");
}

/** Series data keys (codes); the legend / tooltip names come from the whatIf namespace. */
export const SERIES_BASE = "base";
export const SERIES_SCENARIO = "scenario";

/** Base and scenario equity on one day axis (the scenario is carried forward on days it has no trades). */
export function mergeEquity(base: EquityPoint[], scenario: EquityPoint[], hasScenario: boolean) {
  const sc = new Map(scenario.map((p) => [p.day, p.cum]));
  const withYear = base.length > 1 && base[0].day.slice(0, 4) !== base[base.length - 1].day.slice(0, 4);
  let last = 0;
  return base.map((p) => {
    if (sc.has(p.day)) last = sc.get(p.day)!;
    return { day: p.day, label: shortDay(p.day, withYear), [SERIES_BASE]: p.cum, [SERIES_SCENARIO]: hasScenario ? last : null } as Record<string, string | number | null>;
  });
}

/** One large chart: «как было» (muted) vs «как стало» (accent). Fixed height so nothing jumps while recomputing. */
export function EquityChart({ base, scenario, hasScenario, height = 340, onDay }: { base: EquityPoint[]; scenario: EquityPoint[]; hasScenario: boolean; height?: number; /** Click on a day → e.g. open its report. */ onDay?: (day: string) => void }) {
  const { t } = whatIfI18n.useT();
  const data = useMemo(() => mergeEquity(base, scenario, hasScenario), [base, scenario, hasScenario, t]); // eslint-disable-line react-hooks/exhaustive-deps -- labels follow the language
  const motion = useChartMotion();
  const gid = `wi${useId().replace(/:/g, "")}`;
  // Fact alone: a P&L curve (profit above zero, loss below). With a scenario: fact recedes (dashed, muted), scenario leads.
  const paint = useMemo(() => pnlPaint(gid, base.map((p) => p.cum)), [base, gid]);
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  return (
    <div style={{ height }} className={onDay ? "cursor-pointer" : undefined} title={onDay ? t("chart.clickDay") : undefined} role="img" aria-label={hasScenario ? t("chart.ariaBoth") : t("chart.ariaFact")}>
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onClick={onDay ? (st: { activePayload?: { payload?: { day?: unknown } }[] } | null) => { const day = st?.activePayload?.[0]?.payload?.day; if (typeof day === "string") onDay(day); } : undefined}
          >
            {hasScenario ? areaGradient(`${gid}-sc`, CHART.accent) : paint.defs}
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...X_AXIS} minTickGap={36} />
            <YAxis {...Y_AXIS} tickFormatter={usd} width={76} />
            <Tooltip
              {...tooltipProps("line")}
              content={<GlassTooltip
                tone="pnl"
                delta={hasScenario ? (r) => (typeof r[SERIES_SCENARIO] === "number" && typeof r[SERIES_BASE] === "number" ? (r[SERIES_SCENARIO] as number) - (r[SERIES_BASE] as number) : null) : undefined}
                deltaFormat={usd}
                deltaLabel={t("chart.delta")}
              />}
              formatter={(v: number, name: string) => [usd(v), name]}
              labelFormatter={(_, p) => { const d = p?.[0]?.payload?.day; return typeof d === "string" ? fmtDeskDate(d, "medium") : ""; }}
            />
            {hasScenario && <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />}
            <ReferenceLine {...ZERO_LINE} />
            {hasScenario ? (
              <Line type="linear" dataKey={SERIES_BASE} name={t("chart.base")} stroke={CHART.neutral} dot={false} strokeWidth={STROKE_THIN} strokeDasharray="4 3" activeDot={{ ...ACTIVE_DOT, fill: CHART.neutral }} {...motion} />
            ) : (
              <Area type="linear" dataKey={SERIES_BASE} name={t("chart.base")} stroke={paint.stroke} fill={paint.fill} dot={false} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" activeDot={{ ...ACTIVE_DOT, fill: CHART.fg }} {...motion} />
            )}
            {hasScenario && (
              <Area type="linear" dataKey={SERIES_SCENARIO} name={t("chart.scenario")} stroke={CHART.accent} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill={`url(#${gid}-sc)`} dot={false} activeDot={{ ...ACTIVE_DOT, fill: CHART.accent }} {...motion} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="grid h-full place-items-center text-sm text-muted-foreground">{t("chart.noTrades")}</p>
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
  const t = whatIfI18n.t;
  const u = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  if (i === 0) return t("chart.binLess", { value: u(BIN_EDGES[0]) });
  if (i === BIN_EDGES.length) return t("chart.binMore", { value: u(BIN_EDGES[BIN_EDGES.length - 1]) });
  return t("chart.binRange", { from: u(BIN_EDGES[i - 1]), to: u(BIN_EDGES[i]) });
}
function binOf(v: number): number {
  let i = 0;
  while (i < BIN_EDGES.length && v >= BIN_EDGES[i]) i++;
  return i;
}

/** Histogram of daily net results, base next to scenario. */
export function DailyHistogram({ base, scenario, hasScenario }: { base: DayResult[]; scenario: DayResult[]; hasScenario: boolean }) {
  const { t } = whatIfI18n.useT();
  const data = useMemo(() => {
    const bins = Array.from({ length: BIN_EDGES.length + 1 }, (_, i) => ({ i, tick: binTick(i), label: binLabel(i), [SERIES_BASE]: 0, [SERIES_SCENARIO]: 0, neg: i <= BIN_EDGES.indexOf(0) }));
    for (const d of base) bins[binOf(d.net)][SERIES_BASE]++;
    if (hasScenario) for (const d of scenario) bins[binOf(d.net)][SERIES_SCENARIO]++;
    const first = bins.findIndex((b) => b[SERIES_BASE] || b[SERIES_SCENARIO]);
    let last = bins.length - 1;
    while (last > 0 && !bins[last][SERIES_BASE] && !bins[last][SERIES_SCENARIO]) last--;
    return first < 0 ? [] : bins.slice(first, last + 1);
  }, [base, scenario, hasScenario, t]); // eslint-disable-line react-hooks/exhaustive-deps -- bin labels follow the language
  const motion = useChartMotion();
  const focus = useBarFocus();
  const gid = `wh${useId().replace(/:/g, "")}`;
  return (
    <div className="h-[220px]">
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={MARGIN} barGap={2} {...focus.chartProps}>
            {barGradients(gid, CHART.up, CHART.down, false)}
            <CartesianGrid {...GRID} />
            <XAxis dataKey="tick" {...X_AXIS} interval={0} />
            <YAxis {...Y_AXIS} allowDecimals={false} width={32} />
            <Tooltip {...tooltipProps("bar")} content={<GlassTooltip />} formatter={(v: number, name: string) => [t("chart.days", { count: v }), name]} labelFormatter={(_, p) => (p?.[0]?.payload?.label as string) ?? ""} />
            {hasScenario && <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />}
            <Bar dataKey={SERIES_BASE} name={t("chart.base")} fill={hasScenario ? tint("muted-foreground", 0.45) : CHART.up} radius={BAR_RADIUS} {...motion}>
              {data.map((d, k) => <Cell key={d.i} fill={hasScenario ? tint(d.neg ? "down" : "up", 0.4) : `url(#${gid}-${d.neg ? "down" : "up"})`} fillOpacity={focus.opacity(k)} />)}
            </Bar>
            {hasScenario && (
              <Bar dataKey={SERIES_SCENARIO} name={t("chart.scenario")} fill={CHART.up} radius={BAR_RADIUS} {...motion}>
                {data.map((d, k) => <Cell key={d.i} fill={`url(#${gid}-${d.neg ? "down" : "up"})`} fillOpacity={focus.opacity(k)} />)}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="grid h-full place-items-center text-sm text-muted-foreground">{t("noData")}</p>

      )}
    </div>
  );
}

export function ChartSkeleton({ height = 340 }: { height?: number }) {
  return <Skeleton className="rounded-xl" style={{ height }} />;
}
