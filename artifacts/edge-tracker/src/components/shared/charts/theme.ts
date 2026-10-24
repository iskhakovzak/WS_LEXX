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
 *   · thin marks — 2px lines (1.5px when dense), 4px rounded data ends anchored to the baseline;
 *   · recessive grid — faint horizontal guides only, no vertical lines, no axis lines / tick marks;
 *   · the zero line is the one emphasised rule (P&L crosses it);
 *   · axis text small, muted, tabular; value text wears text tokens (profit / loss tones for P&L);
 *   · motion is a short draw-in, off under prefers-reduced-motion.
 */
import { useReducedMotion } from "framer-motion";

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

export type ChartToken = "up" | "down" | "muted-foreground" | "primary" | "foreground" | "border" | "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "warn";

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

/** Line widths: 2px by default, 1.5px for dense / secondary series. */
export const STROKE = 2;
export const STROKE_THIN = 1.5;

/** Rounded data end of a vertical bar (anchored to the baseline; recharts flips it for negative bars). */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
/** Rounded data end of a horizontal bar. */
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0];

const AXIS_TEXT = { fontSize: 11, fill: CHART.axis, style: { fontVariantNumeric: "tabular-nums" } } as const;

/** Faint horizontal guides only. */
export const GRID = { vertical: false, stroke: CHART.grid, strokeOpacity: 0.45, strokeDasharray: "" } as const;

/** Small, muted, tabular axis text; no axis line, no tick marks. */
export const X_AXIS = { tick: AXIS_TEXT, tickLine: false, axisLine: false, tickMargin: 8, minTickGap: 16 } as const;
export const Y_AXIS = { tick: AXIS_TEXT, tickLine: false, axisLine: false, tickMargin: 6, width: 56 } as const;
/** Axis text style for hand-drawn SVG charts (`<text {...AXIS_SVG_TEXT}>`). */
export const AXIS_SVG_TEXT = { fontSize: 11, fill: CHART.axis, style: { fontVariantNumeric: "tabular-nums" } } as const;

/** The emphasised zero rule (where P&L crosses zero). */
export const ZERO_LINE = { y: 0, stroke: CHART.fg, strokeOpacity: 0.4, strokeWidth: 1 } as const;
/** Same rule on a vertical value axis (horizontal bar charts). */
export const ZERO_LINE_X = { x: 0, stroke: CHART.fg, strokeOpacity: 0.4, strokeWidth: 1 } as const;
/** A secondary reference (target, limit, average): thin dashed, muted. */
export const REF_LINE = { stroke: CHART.axis, strokeOpacity: 0.7, strokeWidth: 1, strokeDasharray: "4 4" } as const;

/** Crosshair (vertical guide) for line / area charts and the column highlight for bar charts. */
export const LINE_CURSOR = { stroke: CHART.fg, strokeOpacity: 0.35, strokeWidth: 1, strokeDasharray: "3 3" } as const;
export const BAR_CURSOR = { fill: CHART.fg, fillOpacity: 0.06, radius: 6 } as const;

/** Hover dot on a line: filled, ringed with the surface so it reads on top of the stroke. */
export const ACTIVE_DOT = { r: 4, strokeWidth: 2, stroke: CHART.surface } as const;

/** Margins that leave room for a 56px value axis. */
export const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;

export const DRAW_MS = 650;

/** Draw-in animation props for recharts series; off under prefers-reduced-motion. */
export function useChartMotion(enabled = true): { isAnimationActive: boolean; animationDuration: number; animationEasing: "ease-out" } {
  const reduce = useReducedMotion();
  return { isAnimationActive: enabled && !reduce, animationDuration: DRAW_MS, animationEasing: "ease-out" };
}

/** `prefers-reduced-motion: reduce` outside React (canvas / SVG engines). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
  gridAlpha: (dark: boolean) => (dark ? 0.2 : 0.38),
  zeroAlpha: (dark: boolean) => (dark ? 0.5 : 0.45),
  fillTop: (dark: boolean) => (dark ? 0.28 : 0.2),
  fillMid: (dark: boolean) => (dark ? 0.08 : 0.06),
  line: 2,
  lineDense: 1.5,
  fontSize: 11,
} as const;
