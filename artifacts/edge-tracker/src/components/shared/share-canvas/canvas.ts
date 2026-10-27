/**
 * Canvas 2D helpers shared by the image cards (the trade share card in components/trades/share-card and the
 * «Итоги» story cards in components/wrapped): fonts, colours of the profit / loss tone, text fitting and wrapping,
 * rounded rectangles, the PNG of a canvas. Pure maths (fitFontSize / ellipsize / wrapLines / seededRandom) is
 * unit-tested with fake measures.
 */

export type Tone = "profit" | "loss" | null;
export type Rgb = { r: number; g: number; b: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export const SANS = `Inter, "Segoe UI", system-ui, -apple-system, sans-serif`;
export const font = (weight: number, size: number) => `${weight} ${size}px ${SANS}`;

/** Accent of the tone: warm gold for a profit, steel blue for a loss, soft white when flat. */
export function accentOf(tone: Tone): Rgb {
  if (tone === "profit") return { r: 232, g: 195, b: 106 };
  if (tone === "loss") return { r: 127, g: 166, b: 207 };
  return { r: 220, g: 220, b: 228 };
}
export const rgba = (c: Rgb, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

/** Wait for the Inter faces the cards use (and the glyphs of `sample`, e.g. Cyrillic names). Never throws. */
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
export function spaced(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

export function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rr = Math.min(radius, r.h / 2, r.w / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}

export function shadowed(ctx: CanvasRenderingContext2D, blur: number, alpha = 0.55) {
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = Math.round(blur / 6);
}

/**
 * Largest font size in [min, max] (step 2) whose measured width fits `maxWidth`. `measure(text, size)` = width at that
 * size (canvas measureText in the renderer, a fake in tests). Returns `min` when even that is too wide.
 */
export function fitFontSize(text: string, maxWidth: number, max: number, min: number, measure: (text: string, size: number) => number): number {
  for (let size = max; size > min; size -= 2) if (measure(text, size) <= maxWidth) return size;
  return min;
}

/** Cut a text with «…» until it fits (setup names, long tickers at the minimum size). */
export function ellipsize(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}…`) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/**
 * Word-wrap a text into at most `maxLines` lines of `maxWidth`; the last line gets «…» when the text does not fit.
 * A single word wider than the line is cut with «…».
 */
export function wrapLines(text: string, maxWidth: number, maxLines: number, measure: (text: string) => number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  if (maxLines < 1) return lines;
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxWidth) { cur = next; continue; }
    // The last allowed line and text is left over: cut it with «…».
    if (lines.length === maxLines - 1) { lines.push(ellipsize(next, maxWidth, measure)); return lines; }
    if (cur) lines.push(cur);
    cur = w;
    if (measure(cur) > maxWidth) {
      if (lines.length === maxLines - 1) { lines.push(ellipsize(words.slice(i).join(" "), maxWidth, measure)); return lines; }
      lines.push(ellipsize(cur, maxWidth, measure));
      cur = "";
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Initials for the avatar disc: «Zakir Ishakov» → «ZI», a one-word name → its first letter. */
export function initials(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/** Small deterministic PRNG (mulberry32) for the procedural themes: the same seed draws the same marble. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PNG of a canvas (null when the browser refuses, e.g. a tainted canvas). */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), "image/png"); } catch { resolve(null); }
  });
}
