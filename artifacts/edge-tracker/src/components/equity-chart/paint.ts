/**
 * Canvas paint helpers of the equity engine (pure): text pills / chips, rounded rects, the zero-split paint of the
 * line, candle / bar widths. render.ts composes them into the base and overlay layers.
 */
import type { ChartTheme } from "@/components/chart-engine/theme";
import { CANVAS } from "@/components/shared/charts/theme";
import { linear, type Domain } from "./scale";
import type { Rect } from "./geometry";

export const FONT_SIZE: number = CANVAS.fontSize;
export const crisp = (v: number) => Math.round(v) + 0.5;

export function font(th: ChartTheme, size = FONT_SIZE, weight = 500) {
  return `${weight} ${size}px ${th.font}`;
}

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, rad);
  else ctx.rect(x, y, w, h);
}

/** Text pill (axis labels, markers). Returns its rect. */
export function pill(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  o: { bg: string; fg: string; border?: string; align?: "left" | "right" | "center"; h?: number; size?: number; weight?: number; radius?: number; th: ChartTheme },
): Rect {
  ctx.font = font(o.th, o.size ?? FONT_SIZE, o.weight ?? 600);
  const h = o.h ?? 18;
  const w = Math.ceil(ctx.measureText(text).width) + 12;
  const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
  const top = y - h / 2;
  rr(ctx, left, top, w, h, o.radius ?? 6);
  ctx.fillStyle = o.bg;
  ctx.fill();
  if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = o.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
  return { x: left, y: top, w, h };
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Rounded rect with per-corner radii [tl, tr, br, bl] (falls back to a plain rect on old canvases). */
export function rr4(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]) {
  const lim = Math.max(0, Math.min(w / 2, h));
  const rad = r.map((v) => Math.max(0, Math.min(v, lim))) as [number, number, number, number];
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, rad);
  else ctx.rect(x, y, w, h);
}

/** Straight segments through the points: a P&L curve shows only the real day / trade results, never values a smooth
 * curve would draw between them (design audit). */
export function linePath(path: Path2D, pts: readonly (readonly [number, number])[]) {
  pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
}

/** Ink for text on a solid colour pill: near-black on light fills, white on dark ones (AA on every theme). */
export function inkOn(rgba: string): string {
  const m = rgba.match(/[\d.]+/g);
  if (!m || m.length < 3) return "rgba(255,255,255,0.98)";
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
  // Contrast with white vs with #111: pick the larger.
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0559 ? "rgba(255,255,255,0.98)" : "rgba(17,18,20,0.94)";
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

export function yScale(d: Domain, r: Rect) {
  return linear(d, r.y + r.h, r.y);
}

/** Candle body width: a fixed share of the slot, so the gaps stay proportional at any zoom. */
export function bodyWidth(slotPx: number): number {
  return Math.max(1, Math.min(26, slotPx * (slotPx > 12 ? 0.6 : slotPx > 5 ? 0.68 : 0.8)));
}

/** P&L bar width: a touch wider than a candle body (it is the only mark in its pane). */
export function barWidth(slotPx: number): number {
  return Math.max(1, Math.min(28, slotPx * (slotPx > 12 ? 0.68 : slotPx > 5 ? 0.74 : 0.84)));
}

/**
 * Vertical paint split at the zero line: `stroke` switches hard from profit to loss colour exactly at zero (one path,
 * one gradient — no seam), `fill` fades from each colour to transparent at the zero line.
 */
export function splitPaint(ctx: CanvasRenderingContext2D, th: ChartTheme, top: number, bot: number, y0: number) {
  const a = Math.min(top, y0), b = Math.max(bot, y0);
  const span = Math.max(1, b - a);
  const z = clamp01((y0 - a) / span);
  const stroke = ctx.createLinearGradient(0, a, 0, a + span);
  stroke.addColorStop(0, th.up());
  stroke.addColorStop(z, th.up());
  stroke.addColorStop(z, th.down());
  stroke.addColorStop(1, th.down());
  const fill = ctx.createLinearGradient(0, a, 0, a + span);
  fill.addColorStop(0, th.up(CANVAS.fillTop(th.dark)));
  fill.addColorStop(z * 0.55, th.up(CANVAS.fillMid(th.dark)));
  fill.addColorStop(z, th.up(0));
  fill.addColorStop(z, th.down(0));
  fill.addColorStop(z + (1 - z) * 0.45, th.down(CANVAS.fillMid(th.dark)));
  fill.addColorStop(1, th.down(CANVAS.fillTop(th.dark)));
  return { stroke, fill };
}

/** Small refined marker label: a tinted surface chip, 6px corners, hairline edge, toned text. */
export function chip(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  o: { tone: (a?: number) => string; align: "left" | "right" | "center"; th: ChartTheme },
): Rect {
  const { th } = o;
  ctx.font = font(th, 10, 600);
  const h = 18;
  const w = Math.ceil(ctx.measureText(text).width) + 14;
  const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
  const top = y - h / 2;
  rr(ctx, left, top, w, h, 6);
  ctx.fillStyle = th.bg(th.dark ? 0.9 : 0.94);
  ctx.fill();
  ctx.fillStyle = o.tone(th.dark ? 0.12 : 0.08);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = o.tone(th.dark ? 0.35 : 0.3);
  ctx.stroke();
  ctx.fillStyle = o.tone();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
  return { x: left, y: top, w, h };
}

