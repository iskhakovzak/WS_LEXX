import { describe, expect, it } from "vitest";
import { AA_TEXT, contrast, mix, minContrast, tripletToRgb, type Rgb } from "./color";
import { CHIP_GROUPS, DEFAULT_APPEARANCE, THEME_IDS, isLightTheme, parseAppearance, type Appearance, type ThemeId } from "./model";
import { DEFAULT_BRIGHTNESS, PHOTO_MUTED_DARK, SCENES, SCENE_IDS, sceneLevels, sceneSource, toneLight } from "./scenes";
import { bgMotionAllowed } from "@/components/appearance/scenes/motion";
import { computeAppearanceVars } from "./vars";
import { THEME_SURFACES, surfaceRgb, textSurfaces } from "./themes";

const tri = (t: string) => tripletToRgb(t) as Rgb;
const MUTED: Record<ThemeId, string> = { dark: PHOTO_MUTED_DARK, dim: PHOTO_MUTED_DARK, light: "0 0% 37%", platinum: "0 0% 25%" };
const themes = THEME_IDS as readonly ThemeId[];

describe("WS originals: «Яркость фона», canvas titles and panel text stay readable", () => {
  const KINDS = [...SCENE_IDS, "image"] as const;
  const card = (t: ThemeId) => tri(THEME_SURFACES[t].card);
  const fg = (t: ThemeId) => tri(THEME_SURFACES[t].foreground);

  it("every scene / image, theme and brightness: titles ≥ 3:1 on the canvas, muted ≥ 4.5:1 on the panels", () => {
    for (const kind of KINDS) {
      for (const theme of themes) {
        const src = sceneSource(kind, theme)!;
        for (const b of [0, 0.35, 0.7, 1]) {
          const lv = sceneLevels(theme, src, b);
          const canvas = tri(THEME_SURFACES[theme].background);
          const ink: Rgb = isLightTheme(theme) ? [40, 40, 40] : [255, 255, 255];
          for (const g of [src.titleMax ?? src.max, src.min]) {
            const c = mix(mix(canvas, [g, g, g], lv.visibility), ink, src.trail);
            expect(contrast(fg(theme), c), `${kind} ${theme} b=${b} title`).toBeGreaterThanOrEqual(3);
          }
          for (const g of [src.max, src.min]) {
            const c = mix(mix(canvas, [g, g, g], lv.visibility), ink, src.trail);
            if (!lv.solid) {
              for (const p of [lv.glass, lv.frosted]) {
                expect(contrast(tri(MUTED[theme]), mix(c, card(theme), p)), `${kind} ${theme} b=${b} panel ${p}`).toBeGreaterThanOrEqual(AA_TEXT);
              }
            }
          }
        }
      }
    }
  });

  it("brightness scales the visibility; 0 hides the background", () => {
    const src = sceneSource("porsche-gt3rs", "dark")!;
    expect(sceneLevels("dark", src, 0).visibility).toBe(0);
    const lo = sceneLevels("dark", src, 0.35).visibility, hi = sceneLevels("dark", src, 1).visibility;
    expect(hi).toBeGreaterThan(lo);
    // The photos are clearly visible in the dark themes at the default (was ≈ 0.3 under the muted-text scrim).
    expect(sceneLevels("dark", src, DEFAULT_BRIGHTNESS).visibility).toBeGreaterThan(0.45);
  });

  it("glass panels stay translucent over the default dark scene, and vars carry the levels", () => {
    const a: Appearance = { ...DEFAULT_APPEARANCE, bg: { kind: "laocoon", panels: "glass", brightness: 0.7, motion: "on" } };
    const { vars, attrs } = computeAppearanceVars(a, "dark");
    expect(Number(vars["--scene-vis"])).toBeGreaterThanOrEqual(0.35);
    expect(vars["--glass-bg"]).toMatch(/color-mix\(in srgb, hsl\(var\(--card\)\) \d+%, transparent\)/);
    expect(attrs["data-scene-panels"]).toBe("glass");
    expect(vars["--muted-foreground"]).toBe(PHOTO_MUTED_DARK);
    expect(computeAppearanceVars(a, "light").vars["--muted-foreground"]).toBeUndefined();
    expect(minContrast(tri(PHOTO_MUTED_DARK), textSurfaces("dim"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the ridge gets its strength from the same levels", () => {
    const { vars } = computeAppearanceVars({ ...DEFAULT_APPEARANCE, bg: { kind: "ridge", panels: "glass", brightness: 1, motion: "on" } }, "dark");
    expect(Number(vars["--ridge-k"])).toBeGreaterThan(2);
  });

  it("old stored looks without brightness read the default", () => {
    expect(parseAppearance({ bg: { kind: "zeus", panels: "glass" } }).bg.brightness).toBe(0.7);
    expect(SCENES.zeus.photo).toBeTruthy();
  });
});

describe("journal chips", () => {
  it("off → every chip of the group is neutral; on with no colours → stylesheet defaults", () => {
    const off = parseAppearance({ chips: { strategy: { on: false, colors: {} } } });
    const { vars } = computeAppearanceVars(off, "dark");
    for (const k of CHIP_GROUPS.strategy) expect(vars[`--chip-strategy-${k.toLowerCase()}`]).toBe("var(--muted-foreground)");
    expect(vars["--chip-tag-setup"]).toBeUndefined();
  });

  it("custom colours are guarded to AA as text and on their own tint", () => {
    const a = parseAppearance({ chips: { strategy: { on: true, colors: { OPG: "#ffff66", MOC: "#111111" } }, tag: { on: true, colors: { mistake: "#ffd400" } } } });
    for (const theme of themes) {
      const { vars } = computeAppearanceVars(a, theme);
      const card = surfaceRgb(theme, "card");
      for (const token of ["--chip-strategy-opg", "--chip-strategy-moc", "--chip-tag-mistake"]) {
        const c = tri(vars[token]);
        expect(minContrast(c, textSurfaces(theme)), `${theme} ${token}`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(c, mix(card, c, 0.12)), `${theme} ${token} tint`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("parse drops keys outside a group and broken colours", () => {
    const a = parseAppearance({ chips: { strategy: { on: true, colors: { OPG: "#123456", NOPE: "#123456", Day: "red" } } } });
    expect(a.chips.strategy.colors).toEqual({ OPG: "#123456" });
    expect(a.chips.tag).toEqual({ on: true, colors: {} });
  });
});

describe("Light-theme photo tone and «Движение фона»", () => {
  it("lifts the darks into a pale engraving, keeps white white and the order of greys", () => {
    expect(toneLight(255)).toBe(255);
    expect(toneLight(0)).toBeGreaterThan(50);
    expect(toneLight(0)).toBeLessThan(70);
    for (let g = 1; g <= 255; g++) expect(toneLight(g)).toBeGreaterThanOrEqual(toneLight(g - 1));
  });
  it("photo scenes in the light themes are modelled on the toned greys (more of the photo shows)", () => {
    const id = SCENE_IDS.find((s) => SCENES[s].photo)!;
    const p = SCENES[id].photo!;
    expect(sceneSource(id, "light")!.min).toBe(toneLight(p.min));
    expect(sceneSource(id, "dark")!.min).toBe(p.min);
  });
  it("«Вкл» runs even under the system «reduce motion», «Выкл» never runs", () => {
    expect(bgMotionAllowed("on")).toBe(true);
    expect(bgMotionAllowed("off")).toBe(false);
  });
  it("animations are on by default: no field, or the old «auto», reads as «on»", () => {
    expect(parseAppearance({ bg: { kind: "parthenon", panels: "glass", brightness: 0.7 } }).bg.motion).toBe("on");
    expect(parseAppearance({ bg: { kind: "parthenon", panels: "glass", brightness: 0.7, motion: "auto" } }).bg.motion).toBe("on");
    expect(parseAppearance({ bg: { kind: "parthenon", panels: "glass", brightness: 0.7, motion: "off" } }).bg.motion).toBe("off");
  });
});
