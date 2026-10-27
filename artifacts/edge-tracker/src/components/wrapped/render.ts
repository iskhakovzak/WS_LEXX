/**
 * «Итоги» renderer: story cards 1080×1920 (Instagram / Telegram story size) and the summary card 1080×1350, plain
 * Canvas 2D. Backgrounds, tone colours, fonts and text fitting are the trade share card's (components/shared/
 * share-canvas); texts come from texts.ts. A story is laid out top-down with a cursor, so cards with fewer parts stay
 * balanced; everything sits inside the story safe area (≈ 250…1700 px), clear of the apps' own top and bottom bars.
 */
import { drawBackdrop, type BackdropInput } from "@/components/shared/share-canvas/backdrop";
import {
  accentOf, ellipsize, fitFontSize, font, initials, rgba, roundRect, shadowed, spaced, wrapLines, type Rect, type Tone,
} from "@/components/shared/share-canvas/canvas";
import { chartPoints, type CardSeries } from "@/components/shared/share-canvas/series";
import type { StoryTexts, SummaryTexts } from "./texts";

export const STORY_W = 1080;
export const STORY_H = 1920;
export const SUMMARY_W = 1080;
export const SUMMARY_H = 1350;

export type Backdrop = Omit<BackdropInput, "tone">;

export interface StoryDraw {
  texts: StoryTexts;
  /** The best trade's price line (best card only). */
  series: CardSeries | null;
  backdrop: Backdrop;
  /** Artwork credit («Олимп» only). */
  credit: string | null;
}

const M = 84; // side margin
const W = STORY_W - 2 * M;

type Ctx = CanvasRenderingContext2D;
const measureAt = (ctx: Ctx, weight: number) => (t: string, s: number) => { ctx.font = font(weight, s); return ctx.measureText(t).width; };

function text(ctx: Ctx, s: string, x: number, y: number, o: { weight: number; size: number; color?: string; align?: CanvasTextAlign; spacing?: number; shadow?: number }) {
  ctx.save();
  if (o.shadow) shadowed(ctx, o.shadow, 0.5);
  ctx.font = font(o.weight, o.size);
  ctx.fillStyle = o.color ?? "#ffffff";
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if (o.spacing) spaced(ctx, o.spacing);
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** Wrapped paragraph; returns the y under its last line. */
function paragraph(ctx: Ctx, s: string, x: number, y: number, o: { weight: number; size: number; lineHeight: number; maxLines: number; width: number; color?: string }): number {
  ctx.font = font(o.weight, o.size);
  const lines = wrapLines(s, o.width, o.maxLines, (t) => ctx.measureText(t).width);
  lines.forEach((l, i) => text(ctx, l, x, y + o.size + i * o.lineHeight, { weight: o.weight, size: o.size, color: o.color, shadow: 12 }));
  return y + o.size + (lines.length - 1) * o.lineHeight + Math.round(o.size * 0.35);
}

function header(ctx: Ctx, brand: string, period: string, y: number) {
  text(ctx, brand, M, y, { weight: 900, size: 34, spacing: 5, shadow: 10 });
  ctx.font = font(600, 28);
  const p = ellipsize(period.toUpperCase(), W - 260, (t) => ctx.measureText(t).width);
  text(ctx, p, STORY_W - M, y, { weight: 600, size: 28, color: "rgba(255,255,255,0.8)", align: "right", spacing: 3, shadow: 10 });
}

function footer(ctx: Ctx, name: string | null, credit: string | null, tone: Tone, y: number, width: number, height: number, m = M) {
  const acc = accentOf(tone);
  if (name) {
    const r = 30, cx = m + r;
    ctx.save();
    ctx.fillStyle = rgba(acc, 0.95);
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#101114";
    ctx.font = font(800, 24);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(name) || "·", cx, y + 1);
    ctx.restore();
    ctx.save();
    shadowed(ctx, 10, 0.5);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(600, 30);
    ctx.textBaseline = "middle";
    ctx.fillText(ellipsize(name, width - 2 * m - 120, (t) => ctx.measureText(t).width), cx + r + 18, y + 1);
    ctx.restore();
  }
  if (credit) {
    ctx.save();
    ctx.textAlign = "right";
    ctx.font = font(500, 17);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(ellipsize(credit, width - 2 * m, (t) => ctx.measureText(t).width), width - m, height - 26);
    ctx.restore();
  }
}

function chart(ctx: Ctx, s: CardSeries, r: Rect, tone: Tone) {
  const acc = accentOf(tone);
  const { line, entry, exit } = chartPoints(s, r);
  if (line.length < 2) return;
  const a = s.entryIdx ?? 0, b = s.exitIdx ?? line.length - 1;
  const path = (from: number, to: number) => {
    ctx.beginPath();
    ctx.moveTo(line[from]!.x, line[from]!.y);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(line[i]!.x, line[i]!.y);
  };
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (b > a) {
    const area = ctx.createLinearGradient(0, r.y, 0, r.y + r.h + 40);
    area.addColorStop(0, rgba(acc, 0.26));
    area.addColorStop(1, rgba(acc, 0));
    ctx.beginPath();
    ctx.moveTo(line[a]!.x, r.y + r.h + 40);
    for (let i = a; i <= b; i++) ctx.lineTo(line[i]!.x, line[i]!.y);
    ctx.lineTo(line[b]!.x, r.y + r.h + 40);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  if (a > 0) { path(0, a); ctx.stroke(); }
  if (b < line.length - 1) { path(b, line.length - 1); ctx.stroke(); }
  if (b > a) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.shadowColor = rgba(acc, 0.85);
    ctx.shadowBlur = 22;
    path(a, b);
    ctx.stroke();
  }
  ctx.restore();
  for (const p of [entry, exit]) {
    if (!p) continue;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = rgba(acc, 1);
    ctx.lineWidth = 5;
    ctx.shadowColor = rgba(acc, 0.9);
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function dots(ctx: Ctx, days: boolean[], y: number, tone: Tone): number {
  const acc = accentOf(tone ?? "profit");
  const perRow = days.length <= 7 ? days.length : 11;
  const gap = 18;
  const size = Math.min(96, Math.floor((W - (perRow - 1) * gap) / perRow));
  days.forEach((clean, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const cx = M + col * (size + gap) + size / 2, cy = y + row * (size + gap) + size / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    if (clean) {
      ctx.fillStyle = rgba(acc, 0.95);
      ctx.shadowColor = rgba(acc, 0.6);
      ctx.shadowBlur = 18;
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.18, cy - size * 0.18);
      ctx.lineTo(cx + size * 0.18, cy + size * 0.18);
      ctx.moveTo(cx + size * 0.18, cy - size * 0.18);
      ctx.lineTo(cx - size * 0.18, cy + size * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  });
  const rows = Math.ceil(days.length / perRow);
  return y + rows * size + (rows - 1) * gap;
}

function bars(ctx: Ctx, list: StoryTexts["bars"], y: number, tone: Tone): number {
  const acc = accentOf(tone ?? "profit");
  let cy = y;
  for (const b of list) {
    ctx.font = font(600, 30);
    const label = ellipsize(b.label, W * 0.62, (t) => ctx.measureText(t).width);
    text(ctx, label, M, cy + 30, { weight: 600, size: 30, color: "rgba(255,255,255,0.9)", shadow: 8 });
    ctx.font = font(700, 30);
    const value = ellipsize(b.value, W * 0.36, (t) => ctx.measureText(t).width);
    text(ctx, value, STORY_W - M, cy + 30, { weight: 700, size: 30, align: "right", shadow: 8 });
    const track: Rect = { x: M, y: cy + 50, w: W, h: 16 };
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    roundRect(ctx, track, 8);
    ctx.fill();
    ctx.fillStyle = b.pass ? rgba(acc, 1) : "rgba(255,255,255,0.85)";
    roundRect(ctx, { ...track, w: Math.max(16, track.w * b.progress) }, 8);
    ctx.fill();
    ctx.restore();
    cy += 112;
  }
  return cy;
}

function statsGrid(ctx: Ctx, stats: StoryTexts["stats"], y: number): number {
  if (!stats.length) return y;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(M, y, W, 2);
  ctx.restore();
  const cols = stats.length === 1 ? 1 : 2;
  const colW = W / cols;
  stats.slice(0, 4).forEach((s, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = M + col * colW, sy = y + 60 + row * 122;
    text(ctx, s.label.toUpperCase(), x, sy, { weight: 600, size: 24, color: "rgba(255,255,255,0.62)", spacing: 3, shadow: 8 });
    ctx.font = font(700, 46);
    text(ctx, ellipsize(s.value, colW - 28, (t) => ctx.measureText(t).width), x, sy + 56, { weight: 700, size: 46, shadow: 10 });
  });
  return y + 60 + Math.ceil(Math.min(4, stats.length) / cols) * 122;
}

/** Paint one story card (the canvas must be STORY_W × STORY_H). */
export function drawStory(ctx: Ctx, d: StoryDraw): void {
  const s = d.texts;
  const acc = accentOf(s.tone);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, STORY_W, STORY_H);
  drawBackdrop(ctx, { ...d.backdrop, tone: s.tone }, { w: STORY_W, h: STORY_H }, 1.5);
  header(ctx, s.brand, s.period, 230);

  let y = 400;
  text(ctx, s.kicker.toUpperCase(), M, y, { weight: 700, size: 32, color: rgba(acc, 0.98), spacing: 6, shadow: 12 });
  y += 40;
  if (s.headline) {
    const size = fitFontSize(s.headline, W, 92, 56, measureAt(ctx, 800));
    y = paragraph(ctx, s.headline, M, y, { weight: 800, size, lineHeight: Math.round(size * 1.12), maxLines: 2, width: W });
  }
  if (s.big) {
    const size = fitFontSize(s.big, W, 230, 96, measureAt(ctx, 900));
    y += 20;
    ctx.save();
    ctx.font = font(900, size);
    spaced(ctx, -2);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 8;
    ctx.fillText(s.big, M - 4, y + size * 0.8);
    ctx.shadowColor = rgba(acc, 0.55);
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 0;
    ctx.fillText(s.big, M - 4, y + size * 0.8);
    ctx.restore();
    y += Math.round(size * 0.95) + 12;
  }
  if (s.sub) y = paragraph(ctx, s.sub, M, y, { weight: 600, size: 38, lineHeight: 50, maxLines: 2, width: W, color: "rgba(255,255,255,0.86)" });
  y += 50;

  if (d.series && s.kind === "best") { chart(ctx, d.series, { x: M + 10, y: y + 30, w: W - 20, h: 330 }, s.tone); y += 420; }
  if (s.dots?.length) y = dots(ctx, s.dots, y, s.tone) + 60;
  if (s.bars.length) y = bars(ctx, s.bars, y, s.tone) + 10;
  for (const b of s.blocks) {
    text(ctx, b.label.toUpperCase(), M, y + 26, { weight: 600, size: 26, color: "rgba(255,255,255,0.62)", spacing: 3, shadow: 8 });
    const size = fitFontSize(b.title, W, 84, 54, measureAt(ctx, 800));
    y = paragraph(ctx, b.title, M, y + 40, { weight: 800, size, lineHeight: Math.round(size * 1.1), maxLines: 2, width: W });
    if (b.value) y = paragraph(ctx, b.value, M, y, { weight: 600, size: 36, lineHeight: 46, maxLines: 2, width: W, color: rgba(acc, 0.98) });
    y += 70;
  }
  if (s.quote) {
    const large = s.quoteLarge;
    y = paragraph(ctx, s.quote, M, y, { weight: large ? 800 : 600, size: large ? 72 : 40, lineHeight: large ? 88 : 54, maxLines: large ? 9 : 6, width: W, color: large ? "#ffffff" : "rgba(255,255,255,0.9)" });
    y += 40;
  }
  if (s.stats.length) statsGrid(ctx, s.stats, Math.max(y, 1360));
  if (s.note) {
    ctx.font = font(600, 30);
    text(ctx, ellipsize(s.note, W, (t) => ctx.measureText(t).width), M, 1690, { weight: 600, size: 30, color: rgba(acc, 0.95), shadow: 10 });
  }
  footer(ctx, s.name, d.credit, s.tone, 1780, STORY_W, STORY_H);
  ctx.restore();
}

/** Paint the summary card (the canvas must be SUMMARY_W × SUMMARY_H). */
export function drawSummary(ctx: Ctx, s: SummaryTexts, backdrop: Backdrop, credit: string | null): void {
  const acc = accentOf(s.tone);
  const SW = SUMMARY_W - 2 * 72;
  const X = 72;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SUMMARY_W, SUMMARY_H);
  drawBackdrop(ctx, { ...backdrop, tone: s.tone }, { w: SUMMARY_W, h: SUMMARY_H }, 1.7);
  text(ctx, s.brand, X, 112, { weight: 900, size: 30, spacing: 5, shadow: 10 });
  ctx.font = font(600, 26);
  text(ctx, ellipsize(s.period.toUpperCase(), SW - 240, (t) => ctx.measureText(t).width), SUMMARY_W - X, 112, { weight: 600, size: 26, color: "rgba(255,255,255,0.8)", align: "right", spacing: 3, shadow: 10 });
  text(ctx, s.title.toUpperCase(), X, 200, { weight: 700, size: 30, color: rgba(acc, 0.98), spacing: 6, shadow: 12 });
  const size = fitFontSize(s.big, SW, 160, 80, measureAt(ctx, 900));
  ctx.save();
  ctx.font = font(900, size);
  spaced(ctx, -2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = rgba(acc, 0.5);
  ctx.shadowBlur = 36;
  ctx.fillText(s.big, X - 4, 216 + size * 0.82);
  ctx.restore();
  let y = 216 + size * 0.95;
  if (s.sub) {
    ctx.font = font(600, 30);
    text(ctx, ellipsize(s.sub, SW, (t) => ctx.measureText(t).width), X, y + 34, { weight: 600, size: 30, color: "rgba(255,255,255,0.86)", shadow: 10 });
    y += 60;
  }
  y = Math.max(y + 24, 470);
  // Tiles: two columns, up to three rows.
  const gap = 20, tileW = (SW - gap) / 2, tileH = 168;
  s.tiles.forEach((tile, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const r: Rect = { x: X + col * (tileW + gap), y: y + row * (tileH + gap), w: tileW, h: tileH };
    ctx.save();
    ctx.fillStyle = "rgba(10,10,14,0.5)";
    roundRect(ctx, r, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    const iw = r.w - 48;
    ctx.font = font(600, 21);
    text(ctx, ellipsize(tile.label.toUpperCase(), iw, (t) => ctx.measureText(t).width), r.x + 24, r.y + 44, { weight: 600, size: 21, color: rgba(acc, 0.95), spacing: 2 });
    const vs = fitFontSize(tile.value, iw, 44, 30, measureAt(ctx, 800));
    ctx.font = font(800, vs);
    text(ctx, ellipsize(tile.value, iw, (t) => ctx.measureText(t).width), r.x + 24, r.y + 100, { weight: 800, size: vs });
    if (tile.sub) {
      ctx.font = font(500, 23);
      text(ctx, ellipsize(tile.sub, iw, (t) => ctx.measureText(t).width), r.x + 24, r.y + 140, { weight: 500, size: 23, color: "rgba(255,255,255,0.72)" });
    }
  });
  y += Math.ceil(s.tiles.length / 2) * (tileH + gap) + 16;
  text(ctx, s.focusLabel.toUpperCase(), X, y + 26, { weight: 700, size: 22, color: rgba(acc, 0.95), spacing: 3, shadow: 8 });
  paragraph(ctx, s.focus, X, y + 34, { weight: 700, size: 34, lineHeight: 44, maxLines: Math.max(1, Math.floor((SUMMARY_H - 110 - (y + 34)) / 44)), width: SW });
  footer(ctx, s.name, credit, s.tone, SUMMARY_H - 70, SUMMARY_W, SUMMARY_H, X);
  ctx.restore();
}
