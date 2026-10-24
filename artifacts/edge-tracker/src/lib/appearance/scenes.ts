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
  photo?: { file: string; max: number; min: number; credit: SceneCredit };
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
    photo: { file: "porsche-gt3rs", max: 210, min: 0, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_GT3_RS,_GIMS_2018,_Le_Grand-Saconnex_(1X7A0084).jpg") } },
  },
  "porsche-wheel": {
    mode: "3d",
    focusX: 45,
    photo: { file: "porsche-wheel", max: 208, min: 0, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_GT3_RS,_GIMS_2018,_Le_Grand-Saconnex_(1X7A0077).jpg") } },
  },
  laocoon: {
    mode: "hover",
    focusX: 64,
    photo: { file: "laocoon", max: 242, min: 0, credit: { author: "LivioAndronico (2014), Notwist", license: "CC BY-SA 4.0", source: commons("Laocoon_and_His_Sons_black.jpg") } },
  },
  discobolus: {
    mode: "3d",
    focusX: 68,
    photo: { file: "discobolus", max: 242, min: 0, credit: { author: "Livioandronico2013", license: "CC BY-SA 4.0", source: commons("Discobolus_in_National_Roman_Museum_Palazzo_Massimo_alle_Terme.JPG") } },
  },
  hercules: {
    mode: "3d",
    focusX: 70,
    photo: { file: "hercules", max: 227, min: 0, credit: { author: "Marie-Lan Nguyen (2011)", license: "CC BY 2.5", source: commons("Herakles_Farnese_MAN_Napoli_Inv6001_n01.jpg") } },
  },
  zeus: {
    mode: "3d",
    focusX: 68,
    photo: { file: "zeus", max: 240, min: 0, credit: { author: "Jastrow (2006)", license: "Public domain", source: commons("Zeus_Otricoli_Pio-Clementino_Inv257.jpg") } },
  },
};

export const isScene = (v: string): v is SceneId => (SCENE_IDS as readonly string[]).includes(v);
export const isPhotoScene = (v: string): boolean => isScene(v) && !!SCENES[v].photo;

/** The light themes keep their own muted text (index.css). */
const MUTED_LIGHT: Partial<Record<ThemeId, string>> = { light: "0 0% 37%", platinum: "0 0% 25%" };

/** Muted text in the dark themes while a scene is on: a little brighter, so the scene can show more. */
export const PHOTO_MUTED_DARK = "0 0% 74%";

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [40, 40, 40];

function canvasAndMuted(theme: ThemeId): { canvas: Rgb; muted: Rgb; light: boolean } {
  const light = isLightTheme(theme);
  return {
    canvas: tripletToRgb(THEME_SURFACES[theme].background) as Rgb,
    muted: tripletToRgb(light ? MUTED_LIGHT[theme] ?? "0 0% 37%" : PHOTO_MUTED_DARK) as Rgb,
    light,
  };
}

/** The HOVER trail paints white in the dark themes and ink in the light ones, at most `alpha` on top of everything. */
function withTrail(c: Rgb, light: boolean, alpha: number): Rgb {
  return alpha > 0 ? mix(c, light ? INK : WHITE, alpha) : c;
}

const passes = (muted: Rgb, composites: Rgb[]) => composites.every((c) => contrast(muted, c) >= AA_TEXT + 0.05);

/**
 * Lightest scrim (0…1: the canvas colour laid over the photo) that keeps muted text at ≥ 4.5:1 on the composite at
 * the photo's brightest and darkest grey, with the HOVER trail (`trailAlpha`) on top. CSS composites in sRGB (`mix`).
 */
export function photoScrim(theme: ThemeId, photo: { max: number; min: number }, trailAlpha = 0): number {
  const { canvas, muted, light } = canvasAndMuted(theme);
  const ok = (a: number) => passes(muted, [photo.max, photo.min].map((g) => withTrail(mix([g, g, g], canvas, a), light, trailAlpha)));
  for (let a = 0; a <= 1.0001; a += 0.01) if (ok(a)) return Math.round(a * 100) / 100;
  return 1;
}

/** Trail strength in the HOVER scenes. */
export const TRAIL_ALPHA = 0.08;

/** The smoke (lib/smoke) paints opaque greys: 0…205 in the dark themes, 140…245 in the light ones. */
const SMOKE_RANGE = { dark: [0, 205], light: [140, 245] } as const;

/**
 * Opacity of the «Дым» canvas and of its cursor trail for a theme: the strongest pair (smoke ≤ 0.22, trail ≤ 0.08)
 * that keeps muted text on the canvas at 4.5:1 over the brightest / darkest wisp with the trail on top.
 */
export function smokeLevels(theme: ThemeId): { smoke: number; trail: number } {
  const { canvas, muted, light } = canvasAndMuted(theme);
  const range = light ? SMOKE_RANGE.light : SMOKE_RANGE.dark;
  for (let smoke = 0.22; smoke > 0.02; smoke -= 0.01) {
    for (let trail = TRAIL_ALPHA; trail >= 0.03; trail -= 0.005) {
      const comps = range.map((g) => withTrail(mix(canvas, [g, g, g], smoke), light, trail));
      if (passes(muted, comps)) return { smoke: Math.round(smoke * 100) / 100, trail: Math.round(trail * 1000) / 1000 };
    }
  }
  return { smoke: 0.04, trail: 0.03 };
}
