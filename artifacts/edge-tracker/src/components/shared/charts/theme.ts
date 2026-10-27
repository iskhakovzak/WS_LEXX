/**
 * One chart style for the whole app (recharts, inline SVG and the canvas engines).
 *
 *   <CartesianGrid {...GRID} />
 *   <XAxis dataKey="day" {...X_AXIS} />  <YAxis {...Y_AXIS} tickFormatter={…} />
 *   <ReferenceLine {...ZERO_LINE} />
 *   <Area {...motion} type="monotone" dataKey="equity" stroke={CHART.accent} strokeWidth={STROKE} fill={`url(#${id})`} activeDot={ACTIVE_DOT} />
 *   <Tooltip {...tooltipProps("line")} content={<GlassTooltip tone="pnl" />} />
 *
 * Colours are CSS variables only (--up / --down / --muted-foreground / --primary / --chart-N), so a new palette in
 * index.css flows into every chart without touching this file. Rules (dataviz method):
 *   · smooth monotone curves (no overshoot), 2.25px round-capped lines (1.5px when dense / secondary);
 *   · bars: rounded data end (zero side flat), a soft gradient body, dimmed neighbours while one is hovered;
 *   · recessive grid — a few dotted horizontal guides, no vertical lines, no axis lines / tick marks;
 *   · the zero line is the one emphasised rule (a crisp hairline — P&L crosses it);
 *   · crosshair = a solid vertical hairline + a dot snapped onto the curve;
 *   · axis text small, muted, tabular; value text wears text tokens (profit / loss tones for P&L);
 *   · dark themes add a faint glow under the main line (one cheap SVG / canvas blur);
 *   · motion is a short draw-in (≤ 700 ms), only when the app's motion setting allows it (./env).
 */
import { motionAllowed, useMotionAllowed } from "./env";

/** Semantic chart colours (CSS variables). */
export const CHART = {
  up: "hsl(var(--up))",
  down: "hsl(var(--down))",
  /** Break-even / neutral marks. */
  neutral: "hsl(var(--muted-foreground))",
  /** A single non-P&L series (equity of a scenario, counts, scores). */
  accent: "hsl(var(--primary))",
  fg: "hsl(var(--foreground))",
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
  surface: "hsl(var(--card))",
  /** Categorical order — fixed, never cycled (chart-1 … chart-5). */
  series: ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"],
} as const;

export type ChartToken = "up" | "down" | "muted-foreground" | "primary" | "foreground" | "border" | "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "warn" | "be";

/** `hsl(var(--token) / a)` — a translucent step of a theme token. */
export const tint = (token: ChartToken, alpha: number) => `hsl(var(--${token}) / ${alpha})`;

/** Profit / loss / neutral colour of a value. */
export function pnlColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return CHART.neutral;
  return v > 0 ? CHART.up : CHART.down;
}

/** Tailwind text class of a value's tone (tooltips, labels). */
export function pnlTextClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "text-foreground";
  return v > 0 ? "text-up" : "text-down";
}

/** Line widths: 2.25px for the main series, 1.5px for dense / secondary series. */
export const STROKE = 2.25;
export const STROKE_THIN = 1.5;

/** Rounded data end of a vertical bar (anchored to the baseline; recharts flips it for negative bars). */
export const BAR_RADIUS: [number, number, number, number] = [5, 5, 0, 0];
/** Rounded data end of a horizontal bar. */
export const BAR_RADIUS_H: [number, number, number, number] = [0, 5, 5, 0];
/** Fill opacity of the bars that are NOT hovered while one is (focus + context). */
export const BAR_DIM = 0.35;

const AXIS_TEXT = { fontSize: 12, fill: CHART.axis, style: { fontVariantNumeric: "tabular-nums" } } as const;

/** A few dotted horizontal guides only. */
export const GRID = { vertical: false, stroke: CHART.grid, strokeOpacity: 0.7, strokeDasharray: "1 4" } as const;

/** Small, muted, tabular axis text; no axis line, no tick marks; 4 value ticks (fewer guides). */
export const X_AXIS = { tick: AXIS_TEXT, tickLine: false, axisLine: false, tickMargin: 8, minTickGap: 16 } as const;
export const Y_AXIS = { tick: AXIS_TEXT, tickLine: false, axisLine: false, tickMargin: 6, width: 56, tickCount: 4 } as const;
/** Axis text style for hand-drawn SVG charts (`<text {...AXIS_SVG_TEXT}>`). */
export const AXIS_SVG_TEXT = { fontSize: 12, fill: CHART.axis, style: { fontVariantNumeric: "tabular-nums" } } as const;

/** The emphasised zero rule (where P&L crosses zero). */
export const ZERO_LINE = { y: 0, stroke: CHART.fg, strokeOpacity: 0.32, strokeWidth: 1, shapeRendering: "crispEdges" } as const;
/** Same rule on a vertical value axis (horizontal bar charts). */
export const ZERO_LINE_X = { x: 0, stroke: CHART.fg, strokeOpacity: 0.32, strokeWidth: 1, shapeRendering: "crispEdges" } as const;
/** A secondary reference (target, limit, average): thin dashed, muted. */
export const REF_LINE = { stroke: CHART.axis, strokeOpacity: 0.7, strokeWidth: 1, strokeDasharray: "3 4" } as const;

/** Crosshair (a solid vertical hairline) for line / area charts and the column highlight for bar charts. */
export const LINE_CURSOR = { stroke: CHART.fg, strokeOpacity: 0.22, strokeWidth: 1 } as const;
export const BAR_CURSOR = { fill: CHART.fg, fillOpacity: 0.05, radius: 8 } as const;

/** Hover dot snapped onto a line: filled, ringed with the surface so it reads on top of the stroke. */
export const ACTIVE_DOT = { r: 4.5, strokeWidth: 2.5, stroke: CHART.surface } as const;

/** Margins that leave room for a 56px value axis. */
export const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;

export const DRAW_MS = 650;

/** Draw-in animation props for recharts series (lines draw, bars grow from zero); only when motion is allowed. */
export function useChartMotion(enabled = true): { isAnimationActive: boolean; animationDuration: number; animationEasing: "ease-out" } {
  const allowed = useMotionAllowed();
  return { isAnimationActive: enabled && allowed, animationDuration: DRAW_MS, animationEasing: "ease-out" };
}

/** Motion is NOT allowed (the app's motion setting, else prefers-reduced-motion) — for canvas / SVG engines. */
export function prefersReducedMotion(): boolean {
  return !motionAllowed();
}

/**
 * Where zero sits inside [min, max] as a 0…1 offset from the top — the stop of a split (profit above / loss below)
 * gradient. 1 = everything is above zero, 0 = everything below.
 */
export function zeroOffset(values: readonly (number | null | undefined)[]): number {
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return 1;
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

/** Canvas-engine counterparts of the rules above (alpha steps for ChartTheme colour functions). */
export const CANVAS = {
  gridAlpha: (dark: boolean) => (dark ? 0.38 : 0.6),
  /** Dotted guides: 1px dots every 4px. */
  gridDash: [1, 3] as readonly number[],
  zeroAlpha: (dark: boolean) => (dark ? 0.36 : 0.34),
  fillTop: (dark: boolean) => (dark ? 0.3 : 0.2),
  fillMid: (dark: boolean) => (dark ? 0.1 : 0.07),
  line: STROKE,
  lineDense: STROKE_THIN,
  fontSize: 12,
} as const;
