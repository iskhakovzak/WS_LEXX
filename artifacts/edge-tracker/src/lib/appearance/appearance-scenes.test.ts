import { describe, expect, it } from "vitest";
import { AA_TEXT, contrast, mix, minContrast, tripletToRgb, type Rgb } from "./color";
import { CHIP_GROUPS, DEFAULT_APPEARANCE, THEME_IDS, isLightTheme, parseAppearance, type Appearance, type ThemeId } from "./model";
import { PHOTO_MUTED_DARK, SCENES, SCENE_IDS, TRAIL_ALPHA, photoScrim, smokeLevels } from "./scenes";
import { computeAppearanceVars } from "./vars";
import { THEME_SURFACES, surfaceRgb, textSurfaces } from "./themes";

const tri = (t: string) => tripletToRgb(t) as Rgb;
const MUTED: Record<ThemeId, string> = { dark: PHOTO_MUTED_DARK, dim: PHOTO_MUTED_DARK, light: "0 0% 37%", platinum: "0 0% 25%" };
const themes = THEME_IDS as readonly ThemeId[];

describe("WS originals: scrims keep muted text AA over every photo pixel", () => {
  for (const id of SCENE_IDS) {
    const photo = SCENES[id].photo;
    if (!photo) continue;
    it(`${id}`, () => {
      for (const theme of themes) {
        const trail = SCENES[id].mode === "hover" ? TRAIL_ALPHA : 0;
        const a = photoScrim(theme, photo, trail);
        expect(a).toBeLessThanOrEqual(1);
        const canvas = tri(THEME_SURFACES[theme].background);
        const ink: Rgb = isLightTheme(theme) ? [40, 40, 40] : [255, 255, 255];
        for (const g of [photo.max, photo.min, Math.round((photo.max + photo.min) / 2)]) {
          const c = mix(mix([g, g, g], canvas, a), ink, trail);
          expect(contrast(tri(MUTED[theme]), c), `${theme} grey ${g} scrim ${a}`).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
    });
  }

  it("dark themes let more of the photo through than the light ones", () => {
    const p = SCENES.laocoon.photo!;
    expect(photoScrim("dark", p)).toBeLessThan(photoScrim("light", p));
  });

  it("smoke + trail levels pass in every theme", () => {
    for (const theme of themes) {
      const { smoke, trail } = smokeLevels(theme);
      expect(smoke).toBeGreaterThan(0.05);
      const canvas = tri(THEME_SURFACES[theme].background);
      const range = isLightTheme(theme) ? [140, 245] : [0, 205];
      const ink: Rgb = isLightTheme(theme) ? [40, 40, 40] : [255, 255, 255];
      for (const g of range) {
        const c = mix(mix(canvas, [g, g, g], smoke), ink, trail);
        expect(contrast(tri(MUTED[theme]), c), `${theme} ${g}`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("a scene lifts muted text in the dark themes only", () => {
    const a: Appearance = { ...DEFAULT_APPEARANCE, bg: { kind: "discobolus", panels: "glass" } };
    expect(computeAppearanceVars(a, "dark").vars["--muted-foreground"]).toBe(PHOTO_MUTED_DARK);
    expect(computeAppearanceVars(a, "light").vars["--muted-foreground"]).toBeUndefined();
    // The lifted muted text still clears AA on the dark panels.
    expect(minContrast(tri(PHOTO_MUTED_DARK), textSurfaces("dim"))).toBeGreaterThanOrEqual(AA_TEXT);
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
