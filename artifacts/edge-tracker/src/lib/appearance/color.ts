/**
 * Colour math for the appearance customiser («Вид»): hex / HSL conversions, WCAG 2.x relative luminance and contrast,
 * and the contrast guard that nudges a colour's lightness until it clears a ratio against a set of surfaces.
 * Pure code (no DOM). Tokens in index.css are HSL triplets («h s% l%») read as `hsl(var(--x))`, so every value this
 * module hands to the page is a triplet too (`toTriplet`).
 */

export type Rgb = readonly [number, number, number]; // 0…255
export type Hsl = readonly [number, number, number]; // h 0…360, s 0…100, l 0…100

/** WCAG AA for normal text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text and meaningful non-text UI (meter fills, focus rings). */
export const AA_UI = 3;

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim());
}

/** `#rgb` / `#rrggbb` → [r, g, b]; null when the string is not a hex colour. */
export function hexToRgb(hex: string): Rgb | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s * 100, l * 100];
}

export function hslToRgb([h, s, l]: Hsl): Rgb {
  const sn = s / 100, ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** «h s% l%» triplet (index.css token format) → rgb; null when unparsable. */
export function tripletToRgb(triplet: string): Rgb | null {
  const m = /^\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(triplet);
  if (!m) return null;
  return hslToRgb([((Number(m[1]) % 360) + 360) % 360, Number(m[2]), Number(m[3])]);
}

/** rgb → «h s% l%» with one decimal (stable output for caching and tests). */
export function toTriplet(rgb: Rgb): string {
  const [h, s, l] = rgbToHsl(rgb);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return `${r1(h)} ${r1(s)}% ${r1(l)}%`;
}

/** `rgb(r g b / a)` for the raw-colour tokens (--glass-border, --field-border …). */
export function toRgba(rgb: Rgb, alpha: number): string {
  return `rgb(${Math.round(rgb[0])} ${Math.round(rgb[1])} ${Math.round(rgb[2])} / ${Math.round(alpha * 1000) / 1000})`;
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance 0…1. */
export function luminance(rgb: Rgb): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** WCAG contrast ratio 1…21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lowest ratio of `fg` against every surface. */
export function minContrast(fg: Rgb, surfaces: readonly Rgb[]): number {
  return surfaces.reduce((m, s) => Math.min(m, contrast(fg, s)), Infinity);
}

/** Linear mix in sRGB space: t = 0 → a, t = 1 → b (what `color/alpha` over a surface renders). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export type GuardResult = {
  /** The colour to use (the input when it already passes). */
  rgb: Rgb;
  hex: string;
  /** The lightness had to move. */
  adjusted: boolean;
  /** Final ratio against the worst surface. */
  ratio: number;
  /** The final colour meets `min` (false only when no lightness of this hue can, e.g. mid-grey surfaces both ways). */
  ok: boolean;
};

/**
 * Contrast guard: keep the hue and saturation of `fg`, move its lightness (darker on light surfaces, lighter on dark
 * ones, whichever direction can reach `min`) in 0.5 % steps until the colour clears `min` against every surface.
 * Returns the passing colour closest to the input; when nothing passes, the best-scoring candidate with ok = false.
 */
export function ensureContrast(fg: Rgb, surfaces: readonly Rgb[], min = AA_TEXT): GuardResult {
  const start = minContrast(fg, surfaces);
  if (start >= min || surfaces.length === 0) return { rgb: fg, hex: rgbToHex(fg), adjusted: false, ratio: start, ok: true };
  const [h, s, l0] = rgbToHsl(fg);
  let best: { rgb: Rgb; ratio: number } = { rgb: fg, ratio: start };
  // Walk both directions together, so the first hit is the smallest lightness change.
  for (let step = 0.5; step <= 100; step += 0.5) {
    for (const l of [l0 - step, l0 + step]) {
      if (l < 0 || l > 100) continue;
      const c = hslToRgb([h, s, l]);
      const r = minContrast(c, surfaces);
      if (r >= min) return { rgb: c, hex: rgbToHex(c), adjusted: true, ratio: r, ok: true };
      if (r > best.ratio) best = { rgb: c, ratio: r };
    }
  }
  return { rgb: best.rgb, hex: rgbToHex(best.rgb), adjusted: true, ratio: best.ratio, ok: false };
}

/** Black or white, whichever reads better on `bg` (labels on solid accent fills). */
export function bestOn(bg: Rgb): Rgb {
  return contrast([255, 255, 255], bg) >= contrast([0, 0, 0], bg) ? [255, 255, 255] : [0, 0, 0];
}
