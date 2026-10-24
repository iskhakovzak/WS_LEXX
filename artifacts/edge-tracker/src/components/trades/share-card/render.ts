/**
 * Share card renderer: plain Canvas 2D on a 1080×1350 canvas, no dependency. Layout and texts come from model.ts;
 * this file only paints. Fonts: Inter (index.html), loaded with `loadCardFonts()` before the first draw — a canvas
 * never waits for a web font by itself.
 *
 * Layers, bottom up: background (artwork / photo cover, or procedural marble / night) → profit gold / loss steel tint →
 * top and bottom shades + vignette (text stays readable on any art) → header → price line with Entry / Exit pills →
 * big result → stats table → name + brand → artwork credit.
 */
import { CARD_H, CARD_W, chartPoints, ellipsize, fitFontSize, initials, pillBox, seededRandom, type CardSeries, type CardTexts, type Pt, type Rect, type ThemeKind } from "./model";

export type Tone = "profit" | "loss" | null;

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

const SANS = `Inter, "Segoe UI", system-ui, -apple-system, sans-serif`;
const font = (weight: number, size: number) => `${weight} ${size}px ${SANS}`;

/** Accent of the tone: warm gold for a profit, steel blue for a loss, soft white when flat. */
export function accentOf(tone: Tone): { r: number; g: number; b: number } {
  if (tone === "profit") return { r: 232, g: 195, b: 106 };
  if (tone === "loss") return { r: 127, g: 166, b: 207 };
  return { r: 220, g: 220, b: 228 };
}
const rgba = (c: { r: number; g: number; b: number }, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

/** Wait for the Inter faces the card uses (and the glyphs of the name, e.g. Cyrillic). Never throws. */
export async function loadCardFonts(sample = ""): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const text = `0123456789$+−.,%RLONGSHORT ${sample}`;
  try {
    await Promise.all([900, 800, 700, 600, 500].map((w) => document.fonts.load(font(w, 40), text)));
    await document.fonts.ready;
  } catch {
    /* a missing font only changes the face: the system fallback draws */
  }
}

/** Letter-spaced text where the canvas supports it (Chrome / Safari 17+); plain otherwise. */
function spaced(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rr = Math.min(radius, r.h / 2, r.w / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}

// ── Backgrounds ─────────────────────────────────────────────────────────────

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, size: { w: number; h: number }) {
  const s = Math.max(CARD_W / size.w, CARD_H / size.h);
  const w = size.w * s, h = size.h * s;
  ctx.drawImage(img, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
}

/** Black-and-white marble slab with engraving hatching (like the old Atlas prints). */
function drawMarble(ctx: CanvasRenderingContext2D, seed: number) {
  const rnd = seededRandom(seed || 1);
  const base = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  base.addColorStop(0, "#3a3a3d");
  base.addColorStop(0.45, "#202023");
  base.addColorStop(1, "#0c0c0e");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // Light falling on the slab from the upper left.
  const light = ctx.createRadialGradient(260, 220, 40, 260, 220, 1100);
  light.addColorStop(0, "rgba(255,255,255,0.22)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // Clouding: big soft patches of lighter and darker stone.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * CARD_W, y = rnd() * CARD_H, r = 160 + rnd() * 420;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() < 0.55;
    g.addColorStop(0, light ? `rgba(230,230,235,${0.05 + rnd() * 0.08})` : `rgba(0,0,0,${0.1 + rnd() * 0.15})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  // Veins: long smooth diagonal curves (a sum of sines along the slab), each drawn as a soft halo + a sharp core, with
  // a few thin branches.
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const vein = (y0: number, slope: number, amp: number, width: number, alpha: number) => {
    const waves = Array.from({ length: 4 }, (_, k) => ({ a: amp / (k + 1) * (0.5 + rnd()), f: (0.004 + rnd() * 0.006) * (k + 1), p: rnd() * Math.PI * 2 }));
    const pts: Pt[] = [];
    for (let x = -40; x <= CARD_W + 40; x += 12) {
      let y = y0 + slope * x;
      for (const w of waves) y += w.a * Math.sin(w.f * x + w.p);
      pts.push({ x, y });
    }
    const stroke = (lw: number, a: number, blur: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineWidth = lw;
      ctx.strokeStyle = `rgba(240,240,245,${a})`;
      ctx.shadowColor = `rgba(255,255,255,${a})`;
      ctx.shadowBlur = blur;
      ctx.stroke();
    };
    stroke(width * 6, alpha * 0.18, 30);
    stroke(width, alpha, 4);
    for (let b = 0; b < 3; b++) {
      const s = pts[Math.floor(rnd() * pts.length)]!;
      let x = s.x, y = s.y;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const dir = rnd() < 0.5 ? -1 : 1;
      for (let k = 0; k < 8; k++) { x += 14 + rnd() * 18; y += dir * (6 + rnd() * 16); ctx.lineTo(x, y); }
      ctx.lineWidth = width * 0.5;
      ctx.strokeStyle = `rgba(235,235,240,${alpha * 0.6})`;
      ctx.shadowBlur = 2;
      ctx.stroke();
    }
  };
  for (let v = 0; v < 7; v++) vein(rnd() * CARD_H * 1.1 - 300, 0.35 + rnd() * 0.45, 30 + rnd() * 60, 0.8 + rnd() * 1.6, 0.12 + rnd() * 0.2);
  vein(CARD_H * 0.15 + rnd() * 200, 0.55, 70, 2.4, 0.4);
  ctx.restore();
  // Engraving: fine diagonal hatching, denser in the shadows (lower right).
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = -CARD_H; i < CARD_W; i += 7) {
    const shade = Math.min(1, Math.max(0, (i + CARD_H) / (CARD_W + CARD_H)));
    ctx.strokeStyle = `rgba(0,0,0,${0.08 + shade * 0.22})`;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + CARD_H * 0.75, CARD_H);
    ctx.stroke();
  }
  ctx.restore();
  // Grain.
  ctx.save();
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.07})` : `rgba(0,0,0,${rnd() * 0.12})`;
    ctx.fillRect(rnd() * CARD_W, rnd() * CARD_H, 1.6, 1.6);
  }
  ctx.restore();
}

/** Deep night gradient with a glow in the tone's colour, a faint grid and a few stars. */
function drawNight(ctx: CanvasRenderingContext2D, seed: number, tone: Tone) {
  const rnd = seededRandom((seed || 1) ^ 0x9e3779b9);
  const acc = accentOf(tone);
  const base = ctx.createRadialGradient(540, 520, 60, 540, 620, 1000);
  base.addColorStop(0, "#1a2134");
  base.addColorStop(0.55, "#0c101b");
  base.addColorStop(1, "#040509");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = (x: number, y: number, r: number, a: number, c = acc) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  };
  glow(840, 360, 620, 0.34);
  glow(160, 1120, 560, 0.16, { r: 120, g: 110, b: 220 });
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= CARD_W; x += 54) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, CARD_H); ctx.stroke(); }
  for (let y = 0; y <= CARD_H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(CARD_W, y + 0.5); ctx.stroke(); }
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
    const s = rnd() < 0.85 ? 1.5 : 2.6;
    ctx.fillRect(rnd() * CARD_W, rnd() * CARD_H * 0.55, s, s);
  }
  ctx.restore();
}

/** Mean luminance 0…1 of what is on the canvas (sampled on a 24×30 grid). 0.5 when the pixels cannot be read. */
function meanLuminance(ctx: CanvasRenderingContext2D): number {
  try {
    const c = document.createElement("canvas");
    c.width = 24; c.height = 30;
    const s = c.getContext("2d");
    if (!s) return 0.5;
    s.drawImage(ctx.canvas, 0, 0, 24, 30);
    const px = s.getImageData(0, 0, 24, 30).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
    return sum / (px.length / 4);
  } catch {
    return 0.5;
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, d: DrawInput) {
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if ((d.theme === "olymp" || d.theme === "photo") && d.image && d.imageSize) {
    drawCover(ctx, d.image, d.imageSize);
    // Light pictures (engravings on white paper, bright photos) get dimmed so the white line and text stand out.
    const dim = Math.min(0.5, Math.max(0, (meanLuminance(ctx) - 0.32) * 1.1));
    if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, CARD_W, CARD_H); }
  }
  else if (d.theme === "marble") drawMarble(ctx, d.seed);
  else drawNight(ctx, d.seed, d.tone);

  // Tone: a loss loses some colour and turns steel blue, a profit warms to gold. The marble stays black and white.
  if (d.theme !== "night") {
    ctx.save();
    if (d.tone === "loss") {
      ctx.globalCompositeOperation = "saturation";
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = "hsl(0,0%,50%)";
      ctx.fillRect(0, 0, CARD_W, CARD_H);
    }
    if (d.tone) {
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = d.theme === "marble" ? 0.14 : 0.5;
      ctx.fillStyle = rgba(accentOf(d.tone), 1);
      ctx.fillRect(0, 0, CARD_W, CARD_H);
    }
    ctx.restore();
  }

  // Shades for the text: top (header), bottom (number, table, footer), and a vignette.
  const top = ctx.createLinearGradient(0, 0, 0, 380);
  top.addColorStop(0, "rgba(0,0,0,0.66)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_W, 380);
  const bottom = ctx.createLinearGradient(0, 560, 0, CARD_H);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(0.35, "rgba(0,0,0,0.55)");
  bottom.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 560, CARD_W, CARD_H - 560);
  const vig = ctx.createRadialGradient(CARD_W / 2, CARD_H * 0.45, CARD_W * 0.35, CARD_W / 2, CARD_H * 0.45, CARD_H * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

// ── Foreground ──────────────────────────────────────────────────────────────

const M = 72; // side margin
const CHART: Rect = { x: M + 8, y: 330, w: CARD_W - 2 * (M + 8), h: 300 };
const PILL_BOUNDS: Rect = { x: M - 24, y: 262, w: CARD_W - 2 * (M - 24), h: 440 };

function shadowed(ctx: CanvasRenderingContext2D, blur: number, alpha = 0.55) {
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = Math.round(blur / 6);
}

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

/** PNG of a canvas (null when the browser refuses, e.g. a tainted canvas). */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), "image/png"); } catch { resolve(null); }
  });
}
