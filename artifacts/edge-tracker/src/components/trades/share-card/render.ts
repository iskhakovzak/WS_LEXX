/**
 * Share card renderer: plain Canvas 2D on a 1080×1350 canvas, no dependency. Layout and texts come from model.ts;
 * this file only paints. Fonts: Inter (self-hosted, src/fonts.css), loaded with `loadCardFonts()` before the first draw — a canvas
 * never waits for a web font by itself.
 *
 * Layers, bottom up: background (artwork / photo cover, or procedural marble / night) → profit gold / loss steel tint →
 * top and bottom shades + vignette (text stays readable on any art) → header → price line with Entry / Exit pills →
 * big result → stats table → name + brand → artwork credit.
 */
import { CARD_H, CARD_W, chartPoints, ellipsize, fitFontSize, initials, pillBox, type CardSeries, type CardTexts, type Pt, type Rect, type ThemeKind } from "./model";
import { drawBackdrop } from "@/components/shared/share-canvas/backdrop";
import { accentOf, font, rgba, roundRect, shadowed, spaced, type Tone } from "@/components/shared/share-canvas/canvas";

// Shared with the «Итоги» story cards (components/shared/share-canvas).
export { accentOf, canvasPng, loadCardFonts, type Tone } from "@/components/shared/share-canvas/canvas";

export interface DrawInput {
  texts: CardTexts;
  series: CardSeries | null;
  tone: Tone;
  theme: ThemeKind;
  /** Artwork («olymp») or the user's photo («photo»); null → the night background stands in. */
  image: CanvasImageSource | null;
  imageSize: { w: number; h: number } | null;
  /** Small credit line of the artwork (olymp only). */
  credit: string | null;
  /** Seed of the procedural textures (trade id): the same trade always gets the same marble. */
  seed: number;
}

function drawBackground(ctx: CanvasRenderingContext2D, d: DrawInput) {
  drawBackdrop(ctx, d, { w: CARD_W, h: CARD_H });
}

// ── Foreground ──────────────────────────────────────────────────────────────

const M = 72; // side margin
const CHART: Rect = { x: M + 8, y: 330, w: CARD_W - 2 * (M + 8), h: 300 };
const PILL_BOUNDS: Rect = { x: M - 24, y: 262, w: CARD_W - 2 * (M - 24), h: 440 };

function drawHeader(ctx: CanvasRenderingContext2D, d: DrawInput) {
  const acc = accentOf(d.tone);
  const cx = M + 48, cy = 124, r = 48;
  // Monogram disc (no real logos: they are trademarks).
  ctx.save();
  shadowed(ctx, 24, 0.5);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, "rgba(255,255,255,0.97)");
  g.addColorStop(1, rgba(acc, 0.97));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const mono = d.texts.ticker.replace(/[^A-Z0-9]/g, "").slice(0, 1) || "?";
  ctx.save();
  ctx.fillStyle = "#101114";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(900, 46);
  ctx.fillText(mono, cx, cy + 2);
  ctx.restore();

  const x = cx + r + 28;
  const maxW = CARD_W - M - x;
  ctx.save();
  shadowed(ctx, 18);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  const size = fitFontSize(d.texts.ticker, maxW, 78, 40, (t, s) => { ctx.font = font(800, s); return ctx.measureText(t).width; });
  ctx.font = font(800, size);
  ctx.fillText(ellipsize(d.texts.ticker, maxW, (t) => ctx.measureText(t).width), x, cy + 12);
  ctx.font = font(600, 27);
  spaced(ctx, 5);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillText(d.texts.subtitle, x + 2, cy + 58);
  ctx.restore();
}

function drawPill(ctx: CanvasRenderingContext2D, label: string, box: Rect, dot: Pt, acc: { r: number; g: number; b: number }) {
  // Connector from the pill to the fill.
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const fromY = box.y > dot.y ? box.y : box.y + box.h;
  ctx.moveTo(Math.max(box.x + 14, Math.min(box.x + box.w - 14, dot.x)), fromY);
  ctx.lineTo(dot.x, dot.y);
  ctx.stroke();
  shadowed(ctx, 20, 0.45);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  roundRect(ctx, box, box.h / 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "#0f1013";
  ctx.font = font(700, 25);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, box.x + box.w / 2, box.y + box.h / 2 + 1);
  ctx.restore();
  // The fill itself: white dot with a ring in the tone's colour.
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = rgba(acc, 1);
  ctx.lineWidth = 5;
  ctx.shadowColor = rgba(acc, 0.9);
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawChart(ctx: CanvasRenderingContext2D, d: DrawInput) {
  const s = d.series;
  if (!s || s.closes.length < 2) return;
  const acc = accentOf(d.tone);
  const { line, entry, exit } = chartPoints(s, CHART);
  const a = s.entryIdx ?? 0, b = s.exitIdx ?? line.length - 1;
  const path = (from: number, to: number) => {
    ctx.beginPath();
    ctx.moveTo(line[from]!.x, line[from]!.y);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(line[i]!.x, line[i]!.y);
  };
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Glow under the in-trade part.
  if (b > a) {
    const area = ctx.createLinearGradient(0, CHART.y, 0, CHART.y + CHART.h + 60);
    area.addColorStop(0, rgba(acc, 0.24));
    area.addColorStop(1, rgba(acc, 0));
    ctx.beginPath();
    ctx.moveTo(line[a]!.x, CHART.y + CHART.h + 60);
    for (let i = a; i <= b; i++) ctx.lineTo(line[i]!.x, line[i]!.y);
    ctx.lineTo(line[b]!.x, CHART.y + CHART.h + 60);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
  }
  // Context before / after: thin and faint; the trade itself: bright with a glow.
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  if (a > 0) { path(0, a); ctx.stroke(); }
  if (b < line.length - 1) { path(b, line.length - 1); ctx.stroke(); }
  if (b > a) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.shadowColor = rgba(acc, 0.85);
    ctx.shadowBlur = 22;
    path(a, b);
    ctx.stroke();
  }
  ctx.restore();

  ctx.font = font(700, 25);
  const pill = (label: string) => ({ w: Math.ceil(ctx.measureText(label).width) + 40, h: 48 });
  const pe = pill("Entry"), px = pill("Exit");
  const entryBox = entry ? pillBox(entry, pe.w, pe.h, PILL_BOUNDS) : null;
  const exitBox = exit ? pillBox(exit, px.w, px.h, PILL_BOUNDS, entryBox) : null;
  if (entry && entryBox) drawPill(ctx, "Entry", entryBox, entry, acc);
  if (exit && exitBox) drawPill(ctx, "Exit", exitBox, exit, acc);
}

function drawResult(ctx: CanvasRenderingContext2D, d: DrawInput) {
  const acc = accentOf(d.tone);
  ctx.save();
  shadowed(ctx, 14);
  ctx.font = font(700, 26);
  spaced(ctx, 6);
  ctx.fillStyle = rgba(acc, 0.95);
  ctx.fillText(d.texts.resultLabel, M + 2, 764);
  ctx.restore();

  const maxW = CARD_W - 2 * M;
  ctx.save();
  const size = fitFontSize(d.texts.big, maxW, 210, 90, (t, s) => { ctx.font = font(900, s); return ctx.measureText(t).width; });
  ctx.font = font(900, size);
  spaced(ctx, -2);
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(d.texts.big, M - 4, 928);
  // A second pass with a soft coloured glow, no shadow offset.
  ctx.shadowColor = rgba(acc, 0.55);
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 0;
  ctx.fillText(d.texts.big, M - 4, 928);
  ctx.restore();
}

function drawStats(ctx: CanvasRenderingContext2D, d: DrawInput) {
  const cells = d.texts.stats;
  if (!cells.length) return;
  const top = 976;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(M, top, CARD_W - 2 * M, 2);
  const colW = (CARD_W - 2 * M) / 3;
  cells.forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = M + col * colW, y = top + 54 + row * 108;
    ctx.save();
    shadowed(ctx, 10, 0.5);
    ctx.font = font(600, 22);
    spaced(ctx, 3);
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.fillText(c.label.toUpperCase(), x, y);
    spaced(ctx, 0);
    ctx.font = font(700, 40);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(ellipsize(c.value, colW - 24, (t) => ctx.measureText(t).width), x, y + 48);
    ctx.restore();
  });
  ctx.restore();
}

function drawFooter(ctx: CanvasRenderingContext2D, d: DrawInput) {
  const acc = accentOf(d.tone);
  const y = d.texts.stats.length > 3 ? 1272 : 1236;
  if (d.texts.name) {
    const r = 30, cx = M + r;
    ctx.save();
    ctx.fillStyle = rgba(acc, 0.95);
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#101114";
    ctx.font = font(800, 24);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(d.texts.name) || "·", cx, y + 1);
    ctx.restore();
    ctx.save();
    shadowed(ctx, 10, 0.5);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(600, 30);
    ctx.textBaseline = "middle";
    ctx.fillText(ellipsize(d.texts.name, 560, (t) => ctx.measureText(t).width), cx + r + 18, y + 1);
    ctx.restore();
  }
  ctx.save();
  shadowed(ctx, 10, 0.5);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = font(900, 34);
  spaced(ctx, 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(d.texts.brand, CARD_W - M, y + 1);
  ctx.restore();
  if (d.credit) {
    ctx.save();
    ctx.textAlign = "right";
    ctx.font = font(500, 17);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(ellipsize(d.credit, CARD_W - 2 * M, (t) => ctx.measureText(t).width), CARD_W - M, CARD_H - 22);
    ctx.restore();
  }
}

/** Paint the whole card (the canvas must be CARD_W × CARD_H). */
export function drawShareCard(ctx: CanvasRenderingContext2D, d: DrawInput): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  drawBackground(ctx, d);
  drawHeader(ctx, d);
  drawChart(ctx, d);
  drawResult(ctx, d);
  drawStats(ctx, d);
  drawFooter(ctx, d);
  ctx.restore();
}
