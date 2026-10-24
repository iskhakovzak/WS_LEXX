/**
 * Canvas 2D painters. `drawBase` paints everything that only changes with the view / data / theme (grid,
 * series, panes, axes, navigator); `drawOverlay` paints the cheap per-pointer layer (P&L bars — so a hover can
 * dim the other days —, crosshair, highlighted candle, axis pills). Both receive a fully resolved `Frame` — no state lives here.
 */
import type { ChartTheme } from "@/components/chart-engine/theme";
import type { EquityCandle, EquityUnit } from "@/components/equity-candles/lib";
import { fmtValue } from "@/components/equity-candles/lib";
import type { EquityAgg, EquityDerived } from "./model";
import { niceTicks, niceStep, axisLabel, type Domain } from "./scale";
import { crosshairDate, timeTicks } from "./time";
import { navWindow, xOf, type Layout, type Rect } from "./geometry";
import { fullView, type View } from "./viewport";
import { equityChartI18n } from "@/i18n/ns/equityChart";
import { BAR_DIM, CANVAS } from "@/components/shared/charts/theme";
import {
  FONT_SIZE, barWidth, bodyWidth, canBlur, chip, clamp01, crisp, easeOut, font, inkOn, monotonePath, overlaps, pill, rr, rr4, splitPaint, yScale,
} from "./paint";

export interface Frame {
  layout: Layout;
  view: View;
  bars: EquityCandle[];
  keys: string[];
  derived: EquityDerived;
  unit: EquityUnit;
  agg: EquityAgg;
  th: ChartTheme;
  /** 0 = candles, 1 = line / area (cross-fade in between). */
  mix: number;
  yMain: Domain;
  yPnl: Domain;
  yDd: Domain;
  navDomain: Domain;
  marks: boolean;
  /** Left-to-right reveal of the series on first paint (0…1). */
  reveal: number;
  /** Fade-in of freshly swapped data (0…1). */
  alpha: number;
  i0: number;
  i1: number;
  slotPx: number;
  year: string;
}

export interface Pointer { index: number; y: number | null; selected: boolean }

function aggWord(agg: EquityAgg): { best: string; worst: string; pnl: string } {
  const t = equityChartI18n.t;
  return { best: t(`canvas.best.${agg}`), worst: t(`canvas.worst.${agg}`), pnl: t(`canvas.pnl.${agg}`) };
}

/** Labels of the right axis for a pane domain (also used to size the axis). Few guides: one per ~52px, at least three. */
export function axisTicks(d: Domain, h: number): { values: number[]; step: number } {
  const target = Math.max(3, Math.min(6, Math.floor(h / 52)));
  const step = niceStep(d.max - d.min, target);
  return { values: niceTicks(d.min, d.max, target), step };
}

// ─────────────────────────────────────────────────────────────────────────────
// Base layer
// ─────────────────────────────────────────────────────────────────────────────

export function drawBase(ctx: CanvasRenderingContext2D, f: Frame) {
  const { layout: l, th } = f;
  ctx.clearRect(0, 0, l.width, l.height);
  if (!f.bars.length) return;
  const x = (slot: number) => xOf(slot, l.plotX, l.plotW, f.view);
  const ticks = timeTicks(f.keys, f.view.from, f.view.to, f.slotPx, f.agg);

  // No vertical guides (shared chart style): the time labels carry x; only faint horizontal guides below.
  drawMain(ctx, f, x);
  if (l.pnl) drawPnl(ctx, f, l.pnl);
  if (l.dd) drawDd(ctx, f, l.dd, x);

  // Time axis.
  ctx.font = font(th);
  ctx.textBaseline = "middle";
  const ty = l.time.y + l.time.h / 2 + 1;
  let lastRight = -Infinity;
  for (const t of ticks) {
    const cx = x(t.index + 0.5);
    ctx.font = font(th, FONT_SIZE, t.major ? 600 : 500);
    const w = ctx.measureText(t.label).width;
    const left = Math.max(l.plotX + 2, Math.min(l.plotX + l.plotW - w - 2, cx - w / 2));
    if (left < lastRight + 8) continue;
    ctx.fillStyle = t.major ? th.fg(0.78) : th.muted(0.9);
    ctx.textAlign = "left";
    ctx.fillText(t.label, left, ty);
    lastRight = left + w;
  }

  if (l.nav) drawNavigator(ctx, f, l.nav);
}

function drawGrid(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, d: Domain, labels: "all" | "edges") {
  const { th, layout: l } = f;
  const y = yScale(d, pane);
  const { values, step } = axisTicks(d, pane.h);
  ctx.lineWidth = 1;
  ctx.font = font(th);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Small panes: only the far edge (top for P&L, bottom for drawdown) and zero.
  const edge = d.max > -d.min ? values[values.length - 1] : values[0];
  const shown = labels === "all" ? values : values.filter((v) => v === edge || (v === 0 && pane.h >= 64));
  let lastLabelY = -Infinity;
  for (const v of values) {
    const py = crisp(y(v));
    if (py < pane.y - 0.5 || py > pane.y + pane.h + 0.5) continue;
    if (v !== 0) {
      // Dotted, recessive guides.
      ctx.save();
      ctx.setLineDash(CANVAS.gridDash as number[]);
      ctx.strokeStyle = th.border(CANVAS.gridAlpha(th.dark));
      ctx.beginPath();
      ctx.moveTo(pane.x, py);
      ctx.lineTo(pane.x + pane.w, py);
      ctx.stroke();
      ctx.restore();
    }
    if (shown.includes(v) && py > pane.y + 6 && py < pane.y + pane.h - 4 && Math.abs(py - lastLabelY) >= 14) {
      ctx.fillStyle = th.muted(0.85);
      ctx.fillText(axisLabel(v, f.unit, step), l.axisX + 8, py);
      lastLabelY = py;
    }
  }
  // Start / zero line: the one emphasised rule (solid, stronger than the guides).
  const zy = y(0);
  if (zy >= pane.y && zy <= pane.y + pane.h) {
    ctx.save();
    ctx.strokeStyle = th.fg(CANVAS.zeroAlpha(th.dark));
    ctx.beginPath();
    ctx.moveTo(pane.x, crisp(zy));
    ctx.lineTo(pane.x + pane.w, crisp(zy));
    ctx.stroke();
    ctx.restore();
  }
}

function paneTitle(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, text: string) {
  const { th } = f;
  ctx.font = font(th, 10, 600);
  const w = ctx.measureText(text).width + 10;
  rr(ctx, pane.x + 4, pane.y + 3, w, 16, 5);
  ctx.fillStyle = th.bg(th.dark ? 0.6 : 0.75);
  ctx.fill();
  ctx.fillStyle = th.muted(0.95);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pane.x + 9, pane.y + 11.5);
}

function drawMain(ctx: CanvasRenderingContext2D, f: Frame, x: (s: number) => number) {
  const { th, layout: l, bars, derived } = f;
  const pane = l.main;
  const y = yScale(f.yMain, pane);
  drawGrid(ctx, f, pane, f.yMain, "all");
  const a = Math.max(0, f.i0 - 1);
  const b = Math.min(bars.length - 1, f.i1 + 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pane.x, pane.y - 2, pane.w * f.reveal, pane.h + 4);
  ctx.clip();
  ctx.globalAlpha = f.alpha;

  // Running peak (high-water mark), dotted step line.
  if (f.marks) {
    ctx.save();
    ctx.setLineDash([1.5, 3.5]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = th.fg(th.dark ? 0.42 : 0.38);
    ctx.beginPath();
    let pen = false;
    for (let i = a; i <= b; i++) {
      const p = derived.peak[i];
      if (p <= 0) { pen = false; continue; }
      const py = y(p);
      if (!pen) { ctx.moveTo(x(i), py); pen = true; } else ctx.lineTo(x(i), py);
      ctx.lineTo(x(i + 1), py);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (f.mix > 0.001) drawArea(ctx, f, pane, x, y, a, b, f.mix * f.alpha);
  if (f.mix < 0.999) drawCandles(ctx, f, x, y, a, b, (1 - f.mix) * f.alpha);
  ctx.restore();

  if (f.marks && f.reveal >= 1) drawMarkers(ctx, f, pane, x, y);
  drawLastValue(ctx, f, pane, x, y);
}

function linePoints(f: Frame, x: (s: number) => number, y: (v: number) => number, a: number, b: number): [number, number][] {
  const pts: [number, number][] = [];
  if (a === 0 && f.bars.length) pts.push([x(0), y(f.bars[0].open)]);
  for (let i = a; i <= b; i++) pts.push([x(i + 0.5), y(f.bars[i].close)]);
  return pts;
}

function drawArea(
  ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, x: (s: number) => number, y: (v: number) => number, a: number, b: number, alpha: number,
) {
  const { th } = f;
  const pts = linePoints(f, x, y, a, b);
  if (!pts.length) return;
  const line = new Path2D();
  monotonePath(line, pts);
  if (pts.length === 1) line.lineTo(pts[0][0] + 0.01, pts[0][1]);
  const y0 = Math.max(pane.y, Math.min(pane.y + pane.h, y(0)));
  const fill = new Path2D(line);
  fill.lineTo(pts[pts.length - 1][0], y0);
  fill.lineTo(pts[0][0], y0);
  fill.closePath();

  // A monotone curve never leaves the points' range, so the points bound the paint.
  let top = Infinity, bot = -Infinity;
  for (const p of pts) { top = Math.min(top, p[1]); bot = Math.max(bot, p[1]); }
  const paint = splitPaint(ctx, th, top, bot, y0);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = paint.fill;
  ctx.fill(fill);
  const dense = f.slotPx < 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Dark themes: a soft glow under the line (one blurred pass of the same stroke).
  if (th.dark && !dense && canBlur(ctx)) {
    ctx.save();
    ctx.filter = `blur(${CANVAS.glowBlur / 2}px)`;
    ctx.globalAlpha = alpha * CANVAS.glowAlpha;
    ctx.lineWidth = CANVAS.line + 2;
    ctx.strokeStyle = paint.stroke;
    ctx.stroke(line);
    ctx.restore();
  }
  ctx.lineWidth = dense ? CANVAS.lineDense : CANVAS.line;
  ctx.strokeStyle = paint.stroke;
  ctx.stroke(line);
  ctx.restore();
}

function drawCandles(
  ctx: CanvasRenderingContext2D, f: Frame, x: (s: number) => number, y: (v: number) => number, a: number, b: number, alpha: number,
) {
  const { th, bars } = f;
  const bw = bodyWidth(f.slotPx);
  const thin = f.slotPx < 2.2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineWidth = f.slotPx > 10 ? 1.5 : 1;
  for (let i = a; i <= b; i++) {
    const c = bars[i];
    const cx = x(i + 0.5);
    const up = c.close > c.open;
    const flat = c.close === c.open;
    const base = flat ? th.muted : up ? th.up : th.down;
    const wx = f.slotPx > 10 ? cx : crisp(cx);
    const yh = y(c.high), yl = y(c.low);
    if (thin) {
      ctx.strokeStyle = base(flat ? 0.8 : 1);
      ctx.beginPath();
      ctx.moveTo(wx, yh);
      ctx.lineTo(wx, Math.max(yl, yh + 1));
      ctx.stroke();
      continue;
    }
    const yo = y(c.open), yc = y(c.close);
    const top = Math.min(yo, yc);
    const h = Math.max(1.5, Math.abs(yo - yc));
    // Wick: round-capped, a little softer than the body; two halves, so it never shows through the body.
    if (yl - yh > 0.5) {
      ctx.strokeStyle = base(flat ? 0.6 : 0.72);
      ctx.beginPath();
      if (top - yh > 0.5) { ctx.moveTo(wx, yh); ctx.lineTo(wx, top); }
      if (yl - (top + h) > 0.5) { ctx.moveTo(wx, top + h); ctx.lineTo(wx, yl); }
      ctx.stroke();
    }
    // Body: 2px corners, a gentle vertical gradient (lit top → deeper bottom) and a crisp edge of the same hue.
    const left = cx - bw / 2;
    rr(ctx, left, top, bw, h, bw >= 6 ? 2 : 1);
    if (bw >= 5 && h >= 4) {
      const g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, base(flat ? 0.75 : 1));
      g.addColorStop(1, base(flat ? 0.55 : 0.72));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = base(0.95);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = base(flat ? 0.8 : 1);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawMarkers(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, x: (s: number) => number, y: (v: number) => number) {
  const { th, bars, derived } = f;
  const words = aggWord(f.agg);
  const placed: Rect[] = [];
  const lineMode = f.mix >= 0.5;
  type M = { i: number; color: (a?: number) => string; text: string; above: boolean };
  const list: M[] = [];
  if (derived.best >= 0) list.push({ i: derived.best, color: th.up, text: `${fmtShort(bars[derived.best].value, f.unit)} · ${words.best}`, above: true });
  if (derived.worst >= 0) list.push({ i: derived.worst, color: th.down, text: `${fmtShort(bars[derived.worst].value, f.unit)} · ${words.worst}`, above: false });
  if (derived.trough >= 0 && derived.trough !== derived.worst) {
    list.push({ i: derived.trough, color: th.down, text: equityChartI18n.t("canvas.drawdown", { value: fmtShort(derived.maxDrawdown, f.unit) }), above: false });
  } else if (derived.trough >= 0 && derived.trough === derived.worst && list.length) {
    list[list.length - 1].text += ` · ${equityChartI18n.t("canvas.ddBottom")}`;
  }
  for (const m of list) {
    if (m.i < f.i0 || m.i > f.i1) continue;
    const c = bars[m.i];
    const cx = x(m.i + 0.5);
    const anchorY = lineMode ? y(c.close) : y(m.above ? c.high : c.low);
    // Label: flipped towards the inside near the edges, skipped if it collides.
    ctx.font = font(th, 10, 600);
    const w = ctx.measureText(m.text).width + 14;
    const align: "left" | "right" | "center" = cx - w / 2 < pane.x + 4 ? "left" : cx + w / 2 > pane.x + pane.w - 4 ? "right" : "center";
    const lx = align === "left" ? cx - 8 : align === "right" ? cx + 8 : cx;
    const ly = Math.max(pane.y + 10, Math.min(pane.y + pane.h - 10, anchorY + (m.above ? -20 : 20)));
    const probe: Rect = { x: align === "left" ? lx : align === "right" ? lx - w : lx - w / 2, y: ly - 9, w, h: 18 };
    const collides = placed.some((r) => overlaps(r, probe));
    // Leader: a short hairline from the point to the label.
    if (!collides && Math.abs(ly - anchorY) > 10) {
      ctx.save();
      ctx.strokeStyle = m.color(0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crisp(cx), anchorY + (m.above ? -5 : 5));
      ctx.lineTo(crisp(cx), ly + (m.above ? 9 : -9));
      ctx.stroke();
      ctx.restore();
    }
    // Point: a ringed dot with a soft halo.
    ctx.beginPath();
    ctx.arc(cx, anchorY, 6, 0, Math.PI * 2);
    ctx.fillStyle = m.color(0.16);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, anchorY, 3, 0, Math.PI * 2);
    ctx.fillStyle = m.color();
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.bg();
    ctx.stroke();
    if (collides) continue;
    // Quiet chip: surface-tinted, a hairline edge, the value in the series tone (sign + word carry the meaning too).
    placed.push(chip(ctx, m.text, lx, ly, { tone: m.color, align, th }));
  }
}

function fmtShort(v: number, unit: EquityUnit): string {
  const s = axisLabel(v, unit);
  return v > 0 && !s.startsWith("+") ? `+${s}` : s;
}

function drawLastValue(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, x: (s: number) => number, y: (v: number) => number) {
  const { th, bars, layout: l } = f;
  const last = bars[bars.length - 1];
  const v = last.close;
  const color = v > 0 ? th.up : v < 0 ? th.down : th.muted;
  const py = Math.max(pane.y + 9, Math.min(pane.y + pane.h - 9, y(v)));
  const lastX = x(bars.length - 0.5);
  if (lastX < l.plotX + l.plotW) {
    ctx.save();
    ctx.setLineDash([1, 3]);
    ctx.strokeStyle = color(0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.max(l.plotX, lastX + 8), crisp(py));
    ctx.lineTo(l.axisX, crisp(py));
    ctx.stroke();
    ctx.restore();
    if (f.mix >= 0.5 && f.reveal >= 1 && lastX >= l.plotX) {
      // The living end point: halo + ringed dot (the pulse ring is a CSS layer on top, when motion is allowed).
      ctx.beginPath();
      ctx.arc(lastX, y(v), 8, 0, Math.PI * 2);
      ctx.fillStyle = color(0.16);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lastX, y(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = color();
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = th.bg();
      ctx.stroke();
    }
  }
  // End-value tag: solid tone, 6px corners, a small notch pointing at the level; ink picked for AA contrast.
  const bg = color();
  const r = pill(ctx, axisLabel(v, f.unit, niceStep(f.yMain.max - f.yMain.min, 6) / 10), l.axisX + 6, py, {
    bg, fg: inkOn(bg), align: "left", th, size: 11, weight: 650, h: 20, radius: 6,
  });
  ctx.beginPath();
  ctx.moveTo(r.x + 0.5, py - 4);
  ctx.lineTo(r.x - 4, py);
  ctx.lineTo(r.x + 0.5, py + 4);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
}

function drawPnl(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect) {
  // Guides only: the bars live on the overlay layer, so a hover can dim the other days without a full repaint.
  drawGrid(ctx, f, pane, f.yPnl, "edges");
}

/** P&L bars (overlay layer): grow from zero on entrance; while a day is hovered, the others recede. */
function drawPnlBars(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, hover: number) {
  const { th, bars, layout: l } = f;
  const y = yScale(f.yPnl, pane);
  const x = (slot: number) => xOf(slot, l.plotX, l.plotW, f.view);
  ctx.save();
  ctx.beginPath();
  ctx.rect(pane.x, pane.y, pane.w, pane.h);
  ctx.clip();
  ctx.globalAlpha = f.alpha;
  for (let i = Math.max(0, f.i0 - 1); i <= Math.min(bars.length - 1, f.i1 + 1); i++) {
    const cx = x(i + 0.5);
    // Entrance: bars grow from zero, left to right (f.reveal stays 1 when motion is off).
    const grow = f.reveal >= 1 ? 1 : easeOut(clamp01((f.reveal - 0.35 * clamp01((cx - pane.x) / pane.w)) / 0.65));
    pnlBar(ctx, th, f, y, cx, bars[i].value, grow, hover < 0 || hover === i ? 1 : BAR_DIM);
  }
  ctx.restore();
  zeroRule(ctx, f, pane, y(0));
  paneTitle(ctx, f, pane, aggWord(f.agg).pnl);
}

/** The crisp zero hairline on top of the bars (they sit on it). */
function zeroRule(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, zy: number) {
  if (zy < pane.y || zy > pane.y + pane.h) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = f.th.fg(CANVAS.zeroAlpha(f.th.dark));
  ctx.beginPath();
  ctx.moveTo(pane.x, crisp(zy));
  ctx.lineTo(pane.x + pane.w, crisp(zy));
  ctx.stroke();
  ctx.restore();
}

/** One P&L bar: rounded data end (the zero side stays flat), a gradient from the full tone at the end to softer at zero. */
function pnlBar(ctx: CanvasRenderingContext2D, th: ChartTheme, f: Frame, y: (v: number) => number, cx: number, v: number, grow: number, emph: number) {
  if (!v || grow <= 0) return;
  const zy = y(0);
  const bw = barWidth(f.slotPx);
  const vy = zy + (y(v) - zy) * grow;
  const h = Math.max(1, Math.abs(vy - zy));
  const top = v > 0 ? zy - h : zy;
  const r = bw >= 6 ? Math.min(4, bw / 3) : bw >= 3 ? 1 : 0;
  rr4(ctx, cx - bw / 2, top, bw, h, v > 0 ? [r, r, 0, 0] : [0, 0, r, r]);
  const tone = v > 0 ? th.up : th.down;
  if (h >= 4) {
    const g = ctx.createLinearGradient(0, v > 0 ? top : top + h, 0, v > 0 ? top + h : top);
    g.addColorStop(0, tone(0.95 * emph));
    g.addColorStop(1, tone((th.dark ? 0.45 : 0.5) * emph));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = tone(0.85 * emph);
  }
  ctx.fill();
}

function drawDd(ctx: CanvasRenderingContext2D, f: Frame, pane: Rect, x: (s: number) => number) {
  const { th, derived } = f;
  const y = yScale(f.yDd, pane);
  drawGrid(ctx, f, pane, f.yDd, "edges");
  const a = Math.max(0, f.i0 - 1);
  const b = Math.min(derived.underwater.length - 1, f.i1 + 1);
  if (b < a) return;
  const zy = y(0);
  const line = new Path2D();
  const startX = a === 0 ? x(0) : x(a + 0.5);
  const dpts: [number, number][] = a === 0 ? [[startX, zy]] : [];
  for (let i = a; i <= b; i++) dpts.push([x(i + 0.5), y(derived.underwater[i])]);
  monotonePath(line, dpts);
  const area = new Path2D(line);
  area.lineTo(x(b + 0.5), zy);
  area.lineTo(startX, zy);
  area.closePath();
  ctx.save();
  ctx.beginPath();
  ctx.rect(pane.x, pane.y, pane.w * f.reveal, pane.h);
  ctx.clip();
  ctx.globalAlpha = f.alpha;
  const g = ctx.createLinearGradient(0, pane.y, 0, pane.y + pane.h);
  g.addColorStop(0, th.down(0.06));
  g.addColorStop(1, th.down(th.dark ? 0.4 : 0.32));
  ctx.fillStyle = g;
  ctx.fill(area);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = th.down(0.9);
  ctx.stroke(line);
  ctx.restore();
  paneTitle(ctx, f, pane, equityChartI18n.t("ddPane"));
}

function drawNavigator(ctx: CanvasRenderingContext2D, f: Frame, nav: Rect) {
  const { th, bars } = f;
  const n = bars.length;
  const full = fullView(n);
  const span = full.to - full.from;
  const nx = (slot: number) => nav.x + ((slot - full.from) / span) * nav.w;
  const inner: Rect = { x: nav.x, y: nav.y + 4, w: nav.w, h: nav.h - 8 };
  const y = yScale(f.navDomain, inner);

  rr(ctx, nav.x + 0.5, nav.y + 0.5, nav.w - 1, nav.h - 1, 8);
  ctx.fillStyle = th.fg(th.dark ? 0.03 : 0.025);
  ctx.fill();
  ctx.strokeStyle = th.border(th.dark ? 0.5 : 0.8);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  rr(ctx, nav.x + 1, nav.y + 1, nav.w - 2, nav.h - 2, 7);
  ctx.clip();
  // Mini curve, split above / below the start like the main area.
  const line = new Path2D();
  // Long series: one point per ~1.5px is plenty.
  const step = Math.max(1, Math.floor(n / (nav.w / 1.5)));
  const npts: [number, number][] = [[nx(0), y(bars[0].open)]];
  for (let i = 0; i < n - 1; i += step) npts.push([nx(i + 0.5), y(bars[i].close)]);
  npts.push([nx(n - 0.5), y(bars[n - 1].close)]);
  monotonePath(line, npts);
  const zy = Math.max(inner.y, Math.min(inner.y + inner.h, y(0)));
  const area = new Path2D(line);
  area.lineTo(nx(n - 0.5), zy);
  area.lineTo(nx(0), zy);
  area.closePath();
  for (const [clipY, clipH, color] of [[nav.y, zy - nav.y, th.up], [zy, nav.y + nav.h - zy, th.down]] as const) {
    if (clipH <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(nav.x, clipY, nav.w, clipH);
    ctx.clip();
    ctx.fillStyle = color(0.14);
    ctx.fill(area);
    ctx.strokeStyle = color(0.75);
    ctx.lineWidth = 1.25;
    ctx.stroke(line);
    ctx.restore();
  }

  // Dim outside the window, then the window itself.
  const { x0, x1 } = navWindow(nav, f.view, n);
  const wx0 = Math.max(nav.x, x0), wx1 = Math.min(nav.x + nav.w, x1);
  ctx.fillStyle = th.bg(th.dark ? 0.55 : 0.6);
  if (wx0 > nav.x) ctx.fillRect(nav.x, nav.y, wx0 - nav.x, nav.h);
  if (wx1 < nav.x + nav.w) ctx.fillRect(wx1, nav.y, nav.x + nav.w - wx1, nav.h);
  ctx.restore();

  const full0 = wx0 <= nav.x + 1 && wx1 >= nav.x + nav.w - 1;
  rr(ctx, wx0 + 0.5, nav.y + 0.5, Math.max(2, wx1 - wx0 - 1), nav.h - 1, 7);
  ctx.fillStyle = th.primary(full0 ? 0.04 : 0.08);
  ctx.fill();
  ctx.strokeStyle = th.primary(full0 ? 0.35 : 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  // Grips.
  for (const gx of [wx0, wx1]) {
    const hx = Math.max(nav.x + 3, Math.min(nav.x + nav.w - 3, gx));
    rr(ctx, hx - 3.5, nav.y + nav.h / 2 - 9, 7, 18, 3.5);
    ctx.fillStyle = th.bg();
    ctx.fill();
    ctx.strokeStyle = th.primary(0.8);
    ctx.stroke();
    ctx.strokeStyle = th.primary(0.7);
    ctx.beginPath();
    ctx.moveTo(crisp(hx) - 1, nav.y + nav.h / 2 - 4);
    ctx.lineTo(crisp(hx) - 1, nav.y + nav.h / 2 + 4);
    ctx.moveTo(crisp(hx) + 1, nav.y + nav.h / 2 - 4);
    ctx.lineTo(crisp(hx) + 1, nav.y + nav.h / 2 + 4);
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay layer
// ─────────────────────────────────────────────────────────────────────────────

export function drawOverlay(ctx: CanvasRenderingContext2D, f: Frame, p: Pointer | null) {
  const { layout: l, th, bars } = f;
  ctx.clearRect(0, 0, l.width, l.height);
  if (!bars.length) return;
  const x = (slot: number) => xOf(slot, l.plotX, l.plotW, f.view);
  const valid = !!p && p.index >= 0 && p.index < bars.length;
  const cx = valid ? x(p!.index + 0.5) : NaN;
  const inside = valid && cx >= l.plotX - 1 && cx <= l.plotX + l.plotW + 1;
  if (l.pnl) drawPnlBars(ctx, f, l.pnl, inside ? p!.index : -1);
  if (!p || !inside) return;
  const bottomPane = l.dd ?? l.pnl ?? l.main;
  const c = bars[p.index];

  const lineMode = f.mix >= 0.5;
  const colTop = l.main.y, colBot = bottomPane.y + bottomPane.h;
  // Candles: highlight the whole day column (soft rounded band). Line: the hairline alone is enough.
  if (!lineMode || p.selected) {
    const colW = Math.max(Math.min(f.slotPx * 0.92, f.slotPx - 2), 6);
    rr(ctx, cx - colW / 2, colTop - 2, colW, colBot - colTop + 4, Math.min(8, colW / 2));
    ctx.fillStyle = p.selected ? th.primary(th.dark ? 0.12 : 0.08) : th.fg(th.dark ? 0.06 : 0.045);
    ctx.fill();
  }
  // Vertical crosshair: one solid hairline through every pane.
  ctx.save();
  ctx.strokeStyle = th.fg(th.dark ? 0.28 : 0.24);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(crisp(cx), colTop);
  ctx.lineTo(crisp(cx), colBot);
  ctx.stroke();
  // Horizontal guide at the pointer inside the main pane (dotted, quieter).
  if (p.y != null && p.y >= l.main.y && p.y <= l.main.y + l.main.h) {
    ctx.setLineDash([1, 3]);
    ctx.strokeStyle = th.fg(th.dark ? 0.3 : 0.26);
    ctx.beginPath();
    ctx.moveTo(l.plotX, crisp(p.y));
    ctx.lineTo(l.axisX, crisp(p.y));
    ctx.stroke();
  }
  ctx.restore();

  const y = yScale(f.yMain, l.main);
  const color = c.close > c.open ? th.up : c.close < c.open ? th.down : th.muted;
  if (lineMode) {
    // Dot snapped onto the curve.
    const py = y(c.close);
    const tone = c.close >= 0 ? th.up : th.down;
    ctx.beginPath();
    ctx.arc(cx, py, 10, 0, Math.PI * 2);
    ctx.fillStyle = tone(0.16);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = tone();
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = th.bg();
    ctx.stroke();
  } else {
    // Ring around the hovered candle body.
    const bw = bodyWidth(f.slotPx);
    const top = Math.min(y(c.open), y(c.close));
    const h = Math.max(1.5, Math.abs(y(c.open) - y(c.close)));
    rr(ctx, cx - bw / 2 - 3, top - 3, bw + 6, h + 6, 5);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color(0.9);
    ctx.stroke();
  }
  if (l.dd) {
    const yd = yScale(f.yDd, l.dd);
    const u = f.derived.underwater[p.index] ?? 0;
    ctx.beginPath();
    ctx.arc(cx, yd(u), 3, 0, Math.PI * 2);
    ctx.fillStyle = th.down();
    ctx.fill();
  }

  // Axis pills: value at the pointer, date on the time axis.
  if (p.y != null && p.y >= l.main.y && p.y <= l.main.y + l.main.h) {
    const v = y.invert(p.y);
    pill(ctx, axisLabel(v, f.unit, niceStep(f.yMain.max - f.yMain.min, 6) / 10), l.axisX + 3, p.y, { bg: th.labelBg, fg: "rgba(255,255,255,0.96)", align: "left", th });
  }
  const label = crosshairDate(c.key, f.agg, f.year);
  ctx.font = font(th, FONT_SIZE, 600);
  const w = ctx.measureText(label).width + 12;
  const px = Math.max(l.plotX + w / 2, Math.min(l.plotX + l.plotW - w / 2, cx));
  pill(ctx, label, px, l.time.y + l.time.h / 2 + 1, { bg: th.labelBg, fg: "rgba(255,255,255,0.96)", align: "center", th });
}

/** Screen-reader / aria text of a candle. */
export function candleText(c: EquityCandle, unit: EquityUnit): string {
  return equityChartI18n.t("canvas.candleText", { value: fmtValue(c.value, unit), close: fmtValue(c.close, unit), count: c.trades });
}
