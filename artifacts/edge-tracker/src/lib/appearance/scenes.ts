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
import { SCENE_PHOTOS, type ScenePhoto } from "./scene-photos";
import { THEME_SURFACES } from "./themes";
import { BASE } from "@/lib/api";

/** URL of a scene file in public/backgrounds (`-bg` depth layer, `-thumb` picker tile, `-<width>` the scene). */
export const sceneUrl = (file: string, suffix = "") => `${BASE}/backgrounds/${file}${suffix}.webp`;

export { SCENE_IDS, type SceneId, type ScenePhoto };
export type { SceneCredit } from "./scene-photos";

/** Gallery groups («Вид» → Фон). «abstract» also holds our procedural backgrounds and «Без фона». */
export const SCENE_GROUPS = ["cars", "antiquity", "nature", "city", "abstract"] as const;
export type SceneGroup = (typeof SCENE_GROUPS)[number];

export type SceneDef = {
  mode: "3d" | "hover";
  group: SceneGroup;
  /** Photo scenes: files, measured greys and credit (scene-photos.ts, generated with the files). */
  photo?: ScenePhoto;
};

const photo = (id: keyof typeof SCENE_PHOTOS, mode: SceneDef["mode"], group: SceneGroup): SceneDef => ({ mode, group, photo: SCENE_PHOTOS[id] });

export const SCENES: Record<SceneId, SceneDef> = {
  smoke: { mode: "hover", group: "abstract" },
  ridge: { mode: "3d", group: "abstract" },
  "porsche-gt3rs": photo("porsche-gt3rs", "3d", "cars"),
  "porsche-wheel": photo("porsche-wheel", "3d", "cars"),
  "porsche-gt3": photo("porsche-gt3", "3d", "cars"),
  "porsche-turbo-s": photo("porsche-turbo-s", "3d", "cars"),
  "porsche-918": photo("porsche-918", "3d", "cars"),
  "carrera-gt": photo("carrera-gt", "3d", "cars"),
  "porsche-rs27": photo("porsche-rs27", "3d", "cars"),
  "ferrari-f40": photo("ferrari-f40", "3d", "cars"),
  laferrari: photo("laferrari", "3d", "cars"),
  "pagani-huayra": photo("pagani-huayra", "3d", "cars"),
  "bugatti-chiron": photo("bugatti-chiron", "3d", "cars"),
  "mclaren-p1": photo("mclaren-p1", "3d", "cars"),
  parthenon: photo("parthenon", "3d", "antiquity"),
  sounion: photo("sounion", "3d", "antiquity"),
  delphi: photo("delphi", "3d", "antiquity"),
  nike: photo("nike", "3d", "antiquity"),
  laocoon: photo("laocoon", "hover", "antiquity"),
  discobolus: photo("discobolus", "3d", "antiquity"),
  hercules: photo("hercules", "3d", "antiquity"),
  zeus: photo("zeus", "3d", "antiquity"),
  riace: photo("riace", "3d", "antiquity"),
  pantheon: photo("pantheon", "3d", "antiquity"),
  augustus: photo("augustus", "3d", "antiquity"),
  colosseum: photo("colosseum", "3d", "antiquity"),
  matterhorn: photo("matterhorn", "3d", "nature"),
  storm: photo("storm", "hover", "nature"),
  "milky-way": photo("milky-way", "3d", "nature"),
  "northern-lights": photo("northern-lights", "3d", "nature"),
  lightning: photo("lightning", "3d", "nature"),
  "fog-forest": photo("fog-forest", "3d", "nature"),
  glacier: photo("glacier", "3d", "nature"),
  skogafoss: photo("skogafoss", "3d", "nature"),
  "tre-cime": photo("tre-cime", "3d", "nature"),
  "ocean-rocks": photo("ocean-rocks", "3d", "nature"),
  dunes: photo("dunes", "3d", "nature"),
  "sea-mist": photo("sea-mist", "3d", "nature"),
  manhattan: photo("manhattan", "3d", "city"),
  nyse: photo("nyse", "3d", "city"),
  chicago: photo("chicago", "3d", "city"),
  "hong-kong": photo("hong-kong", "3d", "city"),
  tokyo: photo("tokyo", "3d", "city"),
  dubai: photo("dubai", "3d", "city"),
  london: photo("london", "3d", "city"),
  "brooklyn-bridge": photo("brooklyn-bridge", "3d", "city"),
  "empire-state": photo("empire-state", "3d", "city"),
  "rain-street": photo("rain-street", "3d", "city"),
  "trading-floor": photo("trading-floor", "3d", "city"),
  "golden-gate": photo("golden-gate", "3d", "city"),
  "smoke-trail": photo("smoke-trail", "3d", "abstract"),
  ink: photo("ink", "3d", "abstract"),
  "light-trails": photo("light-trails", "3d", "abstract"),
  "spiral-dome": photo("spiral-dome", "3d", "abstract"),
  "spiral-facade": photo("spiral-facade", "3d", "abstract"),
  "spiral-stairs": photo("spiral-stairs", "3d", "abstract"),
};

/** Scene ids of a gallery group, in gallery order. */
export const scenesIn = (group: SceneGroup): SceneId[] => (Object.keys(SCENES) as SceneId[]).filter((id) => SCENES[id].group === group);

/**
 * Responsive sources of a photo scene. Wide screens pick by rendered width × DPR (the photo covers the viewport, so it
 * is drawn at least 160vh wide); phones get at most the 1920 file (the scene sits behind the panels: 1920 is plenty
 * there and keeps a phone's download ≤ ~300 KB).
 */
export function sceneSources(p: ScenePhoto): { src: string; srcSet: string; sizes: string; phoneSrcSet: string } {
  const url = (w: number) => sceneUrl(p.file, `-${w}`);
  const phone = p.widths.filter((w) => w <= 1920);
  return {
    src: url(phone[phone.length - 1]),
    srcSet: p.widths.map((w) => `${url(w)} ${w}w`).join(", "),
    sizes: "max(100vw, 160vh)",
    phoneSrcSet: phone.map((w, i) => `${url(w)} ${i + 1}x`).join(", "),
  };
}

export const isScene = (v: string): v is SceneId => (SCENE_IDS as readonly string[]).includes(v);
export const isPhotoScene = (v: string): boolean => isScene(v) && !!SCENES[v].photo;

/** The light themes keep their own muted text (index.css). */
const MUTED_LIGHT: Partial<Record<ThemeId, string>> = { light: "0 0% 37%", platinum: "0 0% 25%" };

/** Muted text in the dark themes while a scene is on: a little brighter, so the panels can stay more translucent. */
export const PHOTO_MUTED_DARK = "0 0% 74%";

/**
 * Photo tone in the light themes: the dark monochrome photos are lifted into a pale «engraving» (CSS
 * `contrast(c) brightness(b)`), so a light canvas shows the picture instead of a grey haze. Black lands near 24 % grey,
 * white stays white. The scrim maths below runs on the toned greys, so AA still holds.
 */
export const LIGHT_PHOTO_TONE = { contrast: 0.62, brightness: 1.24 } as const;
export const LIGHT_PHOTO_FILTER = `contrast(${LIGHT_PHOTO_TONE.contrast}) brightness(${LIGHT_PHOTO_TONE.brightness})`;
/** A grey after the light-theme tone (same formula the browser applies: contrast around 50 %, then a gain). */
export function toneLight(g: number): number {
  const c = (g / 255 - 0.5) * LIGHT_PHOTO_TONE.contrast + 0.5;
  return Math.round(Math.min(1, Math.max(0, c * LIGHT_PHOTO_TONE.brightness)) * 255);
}

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
  if (def.photo) {
    const p = def.photo;
    return light
      ? { max: toneLight(p.max), min: toneLight(p.min), titleMax: toneLight(p.p98), cap: 1, trail }
      : { max: p.max, min: p.min, titleMax: p.p98, cap: 1, trail };
  }
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
