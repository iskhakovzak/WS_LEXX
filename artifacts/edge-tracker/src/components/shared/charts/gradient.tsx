/**
 * Soft fills under area / equity curves. These are plain functions that return a `<defs>` element, because recharts 2
 * only renders raw SVG elements and its own components as chart children (a wrapper component would be dropped):
 *
 *   <AreaChart …>
 *     {areaGradient(id, CHART.accent)}
 *     <Area … stroke={CHART.accent} fill={`url(#${id})`} />
 *
 *   const paint = pnlPaint(id, data.map((d) => d.equity));   // profit above zero, loss below
 *   {paint.defs}
 *   <Area … stroke={paint.stroke} fill={paint.fill} />
 */
import type { ReactElement } from "react";
import { CHART, pnlColor, zeroOffset } from "./theme";

/** One-colour fade: soft at the line → transparent at the baseline (`flip` — for an area hanging below its base). */
export function areaGradient(id: string, color: string, top = 0.28, flip = false) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1={flip ? "1" : "0"} x2="0" y2={flip ? "0" : "1"}>
        <stop offset="0%" stopColor={color} stopOpacity={top} />
        <stop offset="45%" stopColor={color} stopOpacity={top * 0.4} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

/**
 * Soft glow under a line (dark themes): `<path filter="url(#id)">`. One small blur merged under the stroke — cheap,
 * keeps the line's own (gradient) colours. Use on the one main series only.
 */
export function glowFilter(id: string, blur = 3) {
  return (
    <defs>
      <filter id={id} x="-5%" y="-20%" width="110%" height="140%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="b" />
        <feComponentTransfer in="b" result="g"><feFuncA type="linear" slope={0.6} /></feComponentTransfer>
        <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

/**
 * Vertical bar body: full colour at the data end, softer towards the zero base. `-up` / `-down` ids (negative bars
 * hang below zero, so their gradient is flipped; `downHangs: false` for loss-coloured bars that still grow upwards,
 * e.g. a histogram of losing days).
 *
 *   {barGradients(id)}
 *   <Cell fill={`url(#${id}-${v >= 0 ? "up" : "down"})`} />
 */
export function barGradients(id: string, up: string = CHART.up, down: string = CHART.down, downHangs = true) {
  return (
    <defs>
      <linearGradient id={`${id}-up`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={up} stopOpacity={0.95} />
        <stop offset="100%" stopColor={up} stopOpacity={0.55} />
      </linearGradient>
      <linearGradient id={`${id}-down`} x1="0" y1={downHangs ? "1" : "0"} x2="0" y2={downHangs ? "0" : "1"}>
        <stop offset="0%" stopColor={down} stopOpacity={0.95} />
        <stop offset="100%" stopColor={down} stopOpacity={0.55} />
      </linearGradient>
    </defs>
  );
}

/**
 * Paint of a P&L curve split at zero: the stroke switches hard from profit to loss colour where the curve crosses
 * zero, the fill fades from each colour towards the zero line. A flat series (no vertical extent — an SVG gradient on
 * a zero-height box paints nothing) falls back to a solid colour.
 */
export function pnlPaint(id: string, values: readonly (number | null | undefined)[]): { defs: ReactElement | null; stroke: string; fill: string } {
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || min === max || min >= 0 || max <= 0) {
    const c = !Number.isFinite(min) ? CHART.neutral : max <= 0 && min < 0 ? CHART.down : min === max ? pnlColor(min) : CHART.up;
    return { defs: areaGradient(`${id}-fill`, c, 0.28, c === CHART.down), stroke: c, fill: `url(#${id}-fill)` };
  }
  const o = zeroOffset(values);
  return {
    defs: (
      <defs>
        <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
          <stop offset={0} stopColor={CHART.up} />
          <stop offset={o} stopColor={CHART.up} />
          <stop offset={o} stopColor={CHART.down} />
          <stop offset={1} stopColor={CHART.down} />
        </linearGradient>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset={0} stopColor={CHART.up} stopOpacity={0.3} />
          <stop offset={o * 0.6} stopColor={CHART.up} stopOpacity={0.1} />
          <stop offset={o} stopColor={CHART.up} stopOpacity={0} />
          <stop offset={o} stopColor={CHART.down} stopOpacity={0} />
          <stop offset={o + (1 - o) * 0.4} stopColor={CHART.down} stopOpacity={0.1} />
          <stop offset={1} stopColor={CHART.down} stopOpacity={0.3} />
        </linearGradient>
      </defs>
    ),
    stroke: `url(#${id}-line)`,
    fill: `url(#${id}-fill)`,
  };
}
