import { describe, expect, it } from "vitest";
import { AA_TEXT, AA_UI, contrast, ensureContrast, hexToRgb, mix, minContrast, rgbToHex, toTriplet, tripletToRgb, type Rgb } from "./color";
import { ACCENTS, ACCENT_IDS, DEFAULT_APPEARANCE, TEXT_TONES, TEXT_TONE_IDS, THEME_IDS, type Appearance, type ThemeId } from "./model";
import { computeAppearanceVars } from "./vars";
import { surfaceRgb, textSurfaces } from "./themes";

const rgb = (hex: string) => hexToRgb(hex)!;
const tri = (t: string) => tripletToRgb(t)!;
const withA = (patch: Partial<Appearance>): Appearance => ({ ...DEFAULT_APPEARANCE, ...patch });

describe("colour math", () => {
  it("matches the WCAG reference ratios", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast(rgb("#777777"), [255, 255, 255])).toBeCloseTo(4.48, 2);
    expect(contrast(rgb("#767676"), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });

  it("round-trips hex, rgb and HSL triplets", () => {
    expect(rgbToHex(rgb("#3b82f6"))).toBe("#3b82f6");
    expect(hexToRgb("#abc")).toEqual([170, 187, 204]);
    expect(hexToRgb("blue")).toBeNull();
    const back = tri(toTriplet(rgb("#14b8a6")));
    back.forEach((v, i) => expect(Math.abs(v - rgb("#14b8a6")[i])).toBeLessThanOrEqual(1.5));
  });
});

describe("contrast guard", () => {
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [10, 10, 10];

  it("leaves a passing colour untouched", () => {
    const r = ensureContrast(rgb("#1b2a4a"), [white], AA_TEXT);
    expect(r.adjusted).toBe(false);
    expect(r.hex).toBe("#1b2a4a");
  });

  it("darkens a failing colour on light surfaces and lightens it on dark ones, keeping the hue", () => {
    const onWhite = ensureContrast(rgb("#f59e0b"), [white], AA_TEXT);
    expect(onWhite.adjusted).toBe(true);
    expect(onWhite.ok).toBe(true);
    expect(onWhite.ratio).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(onWhite.rgb, white)).toBeGreaterThanOrEqual(AA_TEXT);
    const onBlack = ensureContrast(rgb("#1d4ed8"), [black], AA_TEXT);
    expect(onBlack.ok).toBe(true);
    expect(contrast(onBlack.rgb, black)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("checks against every surface at once (the worst one wins)", () => {
    const surfaces = [rgb("#ffffff"), rgb("#f5f5f5"), rgb("#ededed")];
    const r = ensureContrast(rgb("#22c55e"), surfaces, AA_TEXT);
    expect(minContrast(r.rgb, surfaces)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("reports ok = false instead of pretending when nothing can pass", () => {
    // 21:1 is only black on white: a mid grey surface can't reach it in either direction.
    const r = ensureContrast(rgb("#808080"), [rgb("#777777")], 21);
    expect(r.ok).toBe(false);
    expect(r.adjusted).toBe(true);
  });
});

describe("computed appearance stays AA in every theme", () => {
  const themes = THEME_IDS as readonly ThemeId[];

  it("every accent swatch and a bad custom one: AA as text and AA for the label on the fill", () => {
    for (const theme of themes) {
      for (const accent of [...ACCENT_IDS.filter((a) => ACCENTS[a]), "#ffff00", "#000080", "#777777"] as Appearance["accent"][]) {
        const { vars } = computeAppearanceVars(withA({ accent }), theme);
        const solid = tri(vars["--primary"]);
        expect(minContrast(solid, textSurfaces(theme)), `${theme} ${accent} as text`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(tri(vars["--primary-foreground"]), solid), `${theme} ${accent} label`).toBeGreaterThanOrEqual(AA_TEXT);
        const tint = mix(surfaceRgb(theme, "card"), solid, 0.12);
        expect(contrast(tri(vars["--accent-soft"]), tint), `${theme} ${accent} soft`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("text tones: presets pass as given; a failing custom tone is adjusted to AA (light themes only)", () => {
    for (const theme of ["light", "platinum"] as const) {
      for (const id of TEXT_TONE_IDS.filter((x) => TEXT_TONES[x])) {
        const { vars, report } = computeAppearanceVars(withA({ textTone: id }), theme);
        expect(report.tone?.adjusted, `${theme} ${id} preset should pass untouched`).toBe(false);
        expect(minContrast(tri(vars["--foreground"]), textSurfaces(theme))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(minContrast(tri(vars["--muted-foreground"]), textSurfaces(theme))).toBeGreaterThanOrEqual(AA_TEXT);
      }
      const pale = computeAppearanceVars(withA({ textTone: "#c0c0ff" }), theme);
      expect(pale.report.tone?.adjusted).toBe(true);
      expect(minContrast(tri(pale.vars["--foreground"]), textSurfaces(theme))).toBeGreaterThanOrEqual(AA_TEXT);
    }
    // Dark themes keep their own near-white text.
    expect(computeAppearanceVars(withA({ textTone: "navy" }), "dark").vars["--foreground"]).toBeUndefined();
  });

  it("money colours read as text and on their tinted pills; the meter clears 3:1", () => {
    for (const theme of themes) {
      const a = withA({ money: { win: "#a3e635", loss: "#ff8080", be: "#fde047", beRange: 0 }, guard: { mode: "daily", color: "#fef08a" } });
      const { vars } = computeAppearanceVars(a, theme);
      const card = surfaceRgb(theme, "card");
      for (const token of ["--up", "--down", "--be"]) {
        const c = tri(vars[token]);
        expect(minContrast(c, textSurfaces(theme)), `${theme} ${token}`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(c, mix(card, c, 0.15)), `${theme} ${token} pill`).toBeGreaterThanOrEqual(AA_TEXT);
      }
      expect(contrast(tri(vars["--guard"]), card)).toBeGreaterThanOrEqual(AA_UI);
    }
  });

  it("the default look sets no colour variables (the stylesheet tokens apply)", () => {
    for (const theme of themes) {
      const { vars, attrs } = computeAppearanceVars(DEFAULT_APPEARANCE, theme);
      expect(vars).toEqual({});
      expect(attrs).toEqual({});
    }
  });

  it("density, background, panels and font become data attributes / the font stack", () => {
    const { vars, attrs } = computeAppearanceVars(withA({ density: "spacious", font: "serif", bg: { kind: "smoke", panels: "frosted", brightness: 0.7, motion: "on", work: "dim" } }), "dark");
    expect(attrs).toEqual({ "data-density": "spacious", "data-font": "serif", "data-bg": "smoke", "data-panels": "frosted", "data-scene-panels": "frosted", "data-work-bg": "dim" });
    expect(vars["--app-font-sans"]).toContain("Source Serif 4");
  });
});
