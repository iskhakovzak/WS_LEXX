/**
 * «WS originals»: interactive backgrounds («Вид» → Фон). Pure registry + the scrim maths.
 *   3D    — 2–4 depth layers that follow the cursor (or the phone's tilt when that permission already exists).
 *   HOVER — a soft smoke trail follows the pointer and fades.
 * Photo scenes are monochrome derivatives of free-licensed Commons photos (public/backgrounds, CREDITS.md there);
 * `max` / `min` are the brightest / darkest grey of each file, measured when it was made, so the scrim can be the
 * lightest one that still keeps muted text on the canvas at 4.5:1 over any pixel of the photo (+ the trail).
 */
import { AA_TEXT, contrast, mix, tripletToRgb, type Rgb } from "./color";
import { SCENE_IDS, isLightTheme, type SceneId, type ThemeId } from "./model";
import { THEME_SURFACES } from "./themes";
import { BASE } from "@/lib/api";

/** URL of a scene file in public/backgrounds (`-bg` depth layer, `-thumb` picker tile). */
export const sceneUrl = (file: string, suffix = "") => `${BASE}/backgrounds/${file}${suffix}.webp`;

export { SCENE_IDS, type SceneId };

export type SceneCredit = { author: string; license: string; source: string };
export type SceneDef = {
  mode: "3d" | "hover";
  /** Photo file stem in /backgrounds (absent for drawn / generated scenes). */
  /** max / min: brightest / darkest grey; p98: 98th percentile (what titles on the canvas are measured against). */
  photo?: { file: string; max: number; p98: number; min: number; credit: SceneCredit };
  /** Horizontal focus of the subject (object-position), so phones crop to it. */
  focusX?: number;
};

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const SCENES: Record<SceneId, SceneDef> = {
  smoke: { mode: "hover" },
  ridge: { mode: "3d" },
  "porsche-gt3rs": {
    mode: "3d",
    focusX: 55,
    photo: { file: "porsche-gt3rs", max: 210, p98: 162, min: 0, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_GT3_RS,_GIMS_2018,_Le_Grand-Saconnex_(1X7A0084).jpg") } },
  },
  "porsche-wheel": {
    mode: "3d",
    focusX: 45,
    photo: { file: "porsche-wheel", max: 208, p98: 119, min: 0, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_GT3_RS,_GIMS_2018,_Le_Grand-Saconnex_(1X7A0077).jpg") } },
  },
  laocoon: {
    mode: "hover",
    focusX: 64,
    photo: { file: "laocoon", max: 242, p98: 223, min: 0, credit: { author: "LivioAndronico (2014), Notwist", license: "CC BY-SA 4.0", source: commons("Laocoon_and_His_Sons_black.jpg") } },
  },
  discobolus: {
    mode: "3d",
    focusX: 68,
    photo: { file: "discobolus", max: 242, p98: 158, min: 0, credit: { author: "Livioandronico2013", license: "CC BY-SA 4.0", source: commons("Discobolus_in_National_Roman_Museum_Palazzo_Massimo_alle_Terme.JPG") } },
  },
  hercules: {
    mode: "3d",
    focusX: 70,
    photo: { file: "hercules", max: 227, p98: 153, min: 0, credit: { author: "Marie-Lan Nguyen (2011)", license: "CC BY 2.5", source: commons("Herakles_Farnese_MAN_Napoli_Inv6001_n01.jpg") } },
  },
  zeus: {
    mode: "3d",
    focusX: 68,
    photo: { file: "zeus", max: 240, p98: 148, min: 0, credit: { author: "Jastrow (2006)", license: "Public domain", source: commons("Zeus_Otricoli_Pio-Clementino_Inv257.jpg") } },
  },
};

export const isScene = (v: string): v is SceneId => (SCENE_IDS as readonly string[]).includes(v);
export const isPhotoScene = (v: string): boolean => isScene(v) && !!SCENES[v].photo;

/** The light themes keep their own muted text (index.css). */
const MUTED_LIGHT: Partial<Record<ThemeId, string>> = { light: "0 0% 37%", platinum: "0 0% 25%" };

/** Muted text in the dark themes while a scene is on: a little brighter, so the panels can stay more translucent. */
export const PHOTO_MUTED_DARK = "0 0% 74%";

/** Trail strength in the HOVER scenes. */
export const TRAIL_ALPHA = 0.08;
/** Default «Яркость фона» (share of the brightest the theme allows). */
export const DEFAULT_BRIGHTNESS = 0.7;
/** Large text (page titles on the canvas) needs 3:1; smaller canvas text gets a halo + header band (index.css). */
const CANVAS_TARGET = 3 + 0.05;
const PANEL_TARGET = AA_TEXT + 0.05;
/** Ridge fills sum to ≈ 0.125 of the text colour at --ridge-k 1 (scenes/ridge.tsx). */
export const RIDGE_ALPHA_AT_K1 = 0.125;

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [40, 40, 40];
const grey = (g: number): Rgb => [g, g, g];

function surfaces(theme: ThemeId) {
  const light = isLightTheme(theme);
  const s = THEME_SURFACES[theme];
  return {
    light,
    canvas: tripletToRgb(s.background) as Rgb,
    card: tripletToRgb(s.card) as Rgb,
    fg: tripletToRgb(s.foreground) as Rgb,
    muted: tripletToRgb(light ? MUTED_LIGHT[theme] ?? "0 0% 37%" : PHOTO_MUTED_DARK) as Rgb,
  };
}

/** The HOVER trail paints white in the dark themes and ink in the light ones, at most `alpha` on top of everything. */
function withTrail(c: Rgb, light: boolean, alpha: number): Rgb {
  return alpha > 0 ? mix(c, light ? INK : WHITE, alpha) : c;
}

const passes = (text: Rgb, composites: Rgb[], target: number) => composites.every((c) => contrast(text, c) >= target);

/** What a background paints over the canvas: greys between `min` and `max`, shown at up to `cap` visibility. */
export type SceneSource = { max: number; min: number; cap: number; trail: number; /** Bright bound for canvas titles. */ titleMax?: number };

/** The paint model of each background kind (photos, the smoke canvas, the ridge in the text colour, your image). */
export function sceneSource(kind: string, theme: ThemeId): SceneSource | null {
  const light = isLightTheme(theme);
  if (kind === "image") return { max: 255, min: 0, cap: 1, trail: 0 };
  if (!isScene(kind)) return null;
  const def = SCENES[kind];
  const trail = def.mode === "hover" ? TRAIL_ALPHA : 0;
  if (def.photo) return { max: def.photo.max, min: def.photo.min, titleMax: def.photo.p98, cap: 1, trail };
  if (kind === "smoke") return light ? { max: 245, min: 140, cap: 0.6, trail } : { max: 205, min: 0, cap: 0.6, trail };
  // Ridge: fills in the theme's text colour.
  const g = Math.round((tripletToRgb(THEME_SURFACES[theme].foreground) as Rgb)[0]);
  return { max: g, min: g, cap: 0.6, trail };
}

export type SceneLevels = {
  /** How much of the background shows on the canvas (0…1): photo = 1 − scrim, smoke = canvas opacity, ridge ∝ k. */
  visibility: number;
  /** Card share of a glass panel over it (muted text on the panel stays 4.5:1); ≥ 0.5. */
  glass: number;
  /** Same for frosted panels (never below their usual 72 %). */
  frosted: number;
  /** Even an opaque-ish glass panel would not pass: use solid panels. */
  solid: boolean;
};

/**
 * Levels for a background at «Яркость фона» `brightness` (0…1): the visibility is that share of the most the theme
 * allows while the page title colour (foreground) on the canvas keeps 3:1 (large text) over the photo's 98th-percentile
 * and darkest grey + trail (the rare highlights above that are covered by the title halo and the header band, index.css);
 * panels get the least card cover that keeps their muted text at 4.5:1 over the very brightest composite.
 */
export function sceneLevels(theme: ThemeId, src: SceneSource, brightness = DEFAULT_BRIGHTNESS): SceneLevels {
  const { light, canvas, card, fg, muted } = surfaces(theme);
  const comps = (v: number, hi = src.max) => [hi, src.min].map((g) => withTrail(mix(canvas, grey(g), v), light, src.trail));
  let maxVis = 0;
  for (let v = src.cap; v >= 0; v -= 0.01) if (passes(fg, comps(v, src.titleMax ?? src.max), CANVAS_TARGET)) { maxVis = v; break; }
  const b = Math.min(1, Math.max(0, brightness));
  const visibility = Math.round(maxVis * b * 100) / 100;
  const under = comps(visibility);
  let need = 1;
  for (let p = 0.5; p <= 1.0001; p += 0.01) if (passes(muted, under.map((c) => mix(c, card, p)), PANEL_TARGET)) { need = p; break; }
  const glass = Math.round(need * 100) / 100;
  return { visibility, glass, frosted: Math.max(0.72, glass), solid: need > 0.92 };
}
