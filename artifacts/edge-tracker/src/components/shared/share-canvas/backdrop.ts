/**
 * Backgrounds of the image cards, for any canvas size (1080×1350 trade / summary cards, 1080×1920 story cards):
 * artwork or photo cover («Олимп» / «Своё фото»), procedural marble («Мрамор») and night («Ночь»), then the profit gold
 * / loss steel tint and the shades that keep text readable on any art. Coordinates are designed on 1080×1350 and
 * scale with the canvas (identical output at 1080×1350).
 */
import type { ThemeKind } from "./policy";
import { accentOf, rgba, seededRandom, type Pt, type Tone } from "./canvas";

export interface BackdropInput {
  theme: ThemeKind;
  tone: Tone;
  /** Artwork («olymp») or the user's photo («photo»); null → the night background stands in. */
  image: CanvasImageSource | null;
  imageSize: { w: number; h: number } | null;
  /** Seed of the procedural textures: the same seed always gets the same marble. */
  seed: number;
}

type Size = { w: number; h: number };

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, size: Size, c: Size) {
  const s = Math.max(c.w / size.w, c.h / size.h);
  const w = size.w * s, h = size.h * s;
  ctx.drawImage(img, (c.w - w) / 2, (c.h - h) / 2, w, h);
}

/** Black-and-white marble slab with engraving hatching (like the old Atlas prints). */
function drawMarble(ctx: CanvasRenderingContext2D, seed: number, { w: W, h: H }: Size) {
  const s = W / 1080;
  const rnd = seededRandom(seed || 1);
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, "#3a3a3d");
  base.addColorStop(0.45, "#202023");
  base.addColorStop(1, "#0c0c0e");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // Light falling on the slab from the upper left.
  const light = ctx.createRadialGradient(260 * s, 220 * s, 40 * s, 260 * s, 220 * s, 1100 * s);
  light.addColorStop(0, "rgba(255,255,255,0.22)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  // Clouding: big soft patches of lighter and darker stone.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, r = (160 + rnd() * 420) * s;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const isLight = rnd() < 0.55;
    g.addColorStop(0, isLight ? `rgba(230,230,235,${0.05 + rnd() * 0.08})` : `rgba(0,0,0,${0.1 + rnd() * 0.15})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Veins: long smooth diagonal curves (a sum of sines along the slab), each drawn as a soft halo + a sharp core, with
  // a few thin branches.
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const vein = (y0: number, slope: number, amp: number, width: number, alpha: number) => {
    const waves = Array.from({ length: 4 }, (_, k) => ({ a: amp / (k + 1) * (0.5 + rnd()), f: (0.004 + rnd() * 0.006) * (k + 1), p: rnd() * Math.PI * 2 }));
    const pts: Pt[] = [];
    for (let x = -40; x <= W + 40; x += 12) {
      let y = y0 + slope * x;
      for (const wv of waves) y += wv.a * Math.sin(wv.f * x + wv.p);
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
      const st = pts[Math.floor(rnd() * pts.length)]!;
      let x = st.x, y = st.y;
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
  for (let v = 0; v < 7; v++) vein(rnd() * H * 1.1 - 300 * s, 0.35 + rnd() * 0.45, 30 + rnd() * 60, 0.8 + rnd() * 1.6, 0.12 + rnd() * 0.2);
  vein(H * 0.15 + rnd() * 200 * s, 0.55, 70, 2.4, 0.4);
  ctx.restore();
  // Engraving: fine diagonal hatching, denser in the shadows (lower right).
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = -H; i < W; i += 7) {
    const shade = Math.min(1, Math.max(0, (i + H) / (W + H)));
    ctx.strokeStyle = `rgba(0,0,0,${0.08 + shade * 0.22})`;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H * 0.75, H);
    ctx.stroke();
  }
  ctx.restore();
  // Grain.
  ctx.save();
  const grains = Math.round(5000 * (W * H) / (1080 * 1350));
  for (let i = 0; i < grains; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.07})` : `rgba(0,0,0,${rnd() * 0.12})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1.6, 1.6);
  }
  ctx.restore();
}

/** Deep night gradient with a glow in the tone's colour, a faint grid and a few stars. */
function drawNight(ctx: CanvasRenderingContext2D, seed: number, tone: Tone, { w: W, h: H }: Size) {
  const s = W / 1080, sy = H / 1350;
  const rnd = seededRandom((seed || 1) ^ 0x9e3779b9);
  const acc = accentOf(tone);
  const base = ctx.createRadialGradient(W / 2, 520 * sy, 60 * s, W / 2, 620 * sy, 1000 * Math.max(s, sy));
  base.addColorStop(0, "#1a2134");
  base.addColorStop(0.55, "#0c101b");
  base.addColorStop(1, "#040509");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, a: number, c = acc) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(840 * s, 360 * sy, 620 * s, 0.34);
  glow(160 * s, 1120 * sy, 560 * s, 0.16, { r: 120, g: 110, b: 220 });
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
    const st = rnd() < 0.85 ? 1.5 : 2.6;
    ctx.fillRect(rnd() * W, rnd() * H * 0.55, st, st);
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

/**
 * Paint the background, the tone and the shades on a `size` canvas. `shade` = how dark the reading shades are
 * (1 = the trade card; story cards with text over the whole height use more).
 */
export function drawBackdrop(ctx: CanvasRenderingContext2D, d: BackdropInput, size: Size, shade = 1): void {
  const { w: W, h: H } = size;
  const sy = H / 1350;
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, W, H);
  if ((d.theme === "olymp" || d.theme === "photo") && d.image && d.imageSize) {
    drawCover(ctx, d.image, d.imageSize, size);
    // Light pictures (engravings on white paper, bright photos) get dimmed so the white line and text stand out.
    const dim = Math.min(0.5, Math.max(0, (meanLuminance(ctx) - 0.32) * 1.1));
    if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
  }
  else if (d.theme === "marble") drawMarble(ctx, d.seed, size);
  else drawNight(ctx, d.seed, d.tone, size);

  // Tone: a loss loses some colour and turns steel blue, a profit warms to gold. The marble stays black and white.
  if (d.theme !== "night") {
    ctx.save();
    if (d.tone === "loss") {
      ctx.globalCompositeOperation = "saturation";
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = "hsl(0,0%,50%)";
      ctx.fillRect(0, 0, W, H);
    }
    if (d.tone) {
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = d.theme === "marble" ? 0.14 : 0.5;
      ctx.fillStyle = rgba(accentOf(d.tone), 1);
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // Shades for the text: top (header), bottom (number, table, footer), and a vignette.
  const topH = 380 * sy;
  const top = ctx.createLinearGradient(0, 0, 0, topH);
  top.addColorStop(0, `rgba(0,0,0,${Math.min(0.9, 0.66 * shade)})`);
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, topH);
  const from = 560 * sy;
  const bottom = ctx.createLinearGradient(0, from, 0, H);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(0.35, `rgba(0,0,0,${Math.min(0.85, 0.55 * shade)})`);
  bottom.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, 0.9 * shade)})`);
  ctx.fillStyle = bottom;
  ctx.fillRect(0, from, W, H - from);
  if (shade > 1) {
    // Story cards carry text in the middle too: an even veil over the whole card.
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.35, (shade - 1) * 0.5)})`;
    ctx.fillRect(0, 0, W, H);
  }
  const vig = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.35, W / 2, H * 0.45, H * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}
