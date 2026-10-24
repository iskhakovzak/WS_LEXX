/**
 * Appearance settings + theme → CSS custom properties and <html> data attributes. Pure: the same input always gives
 * the same output (cached in localStorage and replayed before first paint by the inline script in index.html).
 * Every colour goes through the contrast guard against the theme's surfaces (themes.ts):
 *   text colours (accent as text, text tone, win / loss / break-even)  ≥ 4.5:1 (also on their 12–15 % tinted pills),
 *   labels on solid accent fills                                       ≥ 4.5:1 (black or white, whichever passes),
 *   the guardrail meter fill (non-text UI)                             ≥ 3:1.
 * Values are HSL triplets for `hsl(var(--x))` tokens — the charts read the same variables (chart-engine/theme.ts).
 */
import { AA_TEXT, AA_UI, bestOn, contrast, ensureContrast, hexToRgb, minContrast, mix, toRgba, toTriplet, type GuardResult, type Rgb } from "./color";
import { CHIP_GROUP_IDS, CHIP_GROUPS, FONT_STACKS, accentHex, chipToken, isLightTheme, toneHex, type Appearance, type ThemeId } from "./model";
import { PHOTO_MUTED_DARK, RIDGE_ALPHA_AT_K1, isScene, sceneLevels, sceneSource } from "./scenes";
import { surfaceRgb, textSurfaces } from "./themes";

/** AA plus a hair of margin: the triplets are rounded to 0.1 and pills mix the colour into the card. */
const TEXT_TARGET = AA_TEXT + 0.05;

export type GuardReport = Partial<Record<"accent" | "tone" | "win" | "loss" | "be" | "guard", GuardResult>> & {
  /** Chip colours that had to move for AA, by token. */
  chips?: Record<string, GuardResult>;
};

export type ComputedAppearance = {
  vars: Record<string, string>;
  attrs: Record<string, string>;
  report: GuardReport;
};

/** The data attributes this module may set on <html> (removed when not set). */
export const APPEARANCE_ATTRS = ["data-density", "data-bg", "data-panels", "data-font", "data-scene-panels"] as const;

const FG_KEYS = ["--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground", "--accent-foreground", "--sidebar-foreground", "--sidebar-accent-foreground"];

/** Accent fill + its label: AA as text on every surface, AA for the label on the fill. */
function accentColours(base: Rgb, theme: ThemeId): { solid: GuardResult; fg: Rgb } {
  const surfaces = textSurfaces(theme);
  let solid = ensureContrast(base, surfaces, TEXT_TARGET);
  let fg = bestOn(solid.rgb);
  if (contrast(fg, solid.rgb) < TEXT_TARGET) {
    // Mid-tone fills (rare after the text guard): push the fill away from its label as well.
    const both = ensureContrast(solid.rgb, [...surfaces, fg], TEXT_TARGET);
    solid = { ...both, adjusted: true };
    fg = bestOn(solid.rgb);
  }
  return { solid, fg };
}

/** Text colour that also reads on its own 12 % / 15 % tinted pill (bg-up/12, bg-down/15 …). */
function moneyColour(hex: string, theme: ThemeId): GuardResult | null {
  let base = hexToRgb(hex);
  if (!base) return null;
  const card = surfaceRgb(theme, "card");
  // A grey that fails here mirrors its lightness (a light grey picked in a dark theme reads as a dark grey in a light
  // one), so the «Монохром» money preset keeps win / break-even / loss apart in every theme.
  if (base[0] === base[1] && base[1] === base[2] && minContrast(base, textSurfaces(theme)) < TEXT_TARGET) {
    const m = 255 - base[0];
    base = [m, m, m];
  }
  const first = ensureContrast(base, textSurfaces(theme), TEXT_TARGET);
  const tinted = [mix(card, first.rgb, 0.12), mix(card, first.rgb, 0.15)];
  const second = ensureContrast(first.rgb, [...textSurfaces(theme), ...tinted], TEXT_TARGET);
  return { ...second, adjusted: first.adjusted || second.adjusted };
}

export function computeAppearanceVars(a: Appearance, theme: ThemeId): ComputedAppearance {
  const vars: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  const report: GuardReport = {};
  const light = isLightTheme(theme);
  const card = surfaceRgb(theme, "card");

  // Text tone (light themes only; the dark themes keep their near-white text).
  let fg: Rgb = surfaceRgb(theme, "foreground");
  const toneRaw = toneHex(a.textTone);
  const toneRgb = toneRaw ? hexToRgb(toneRaw) : null;
  if (light && toneRgb) {
    const tone = ensureContrast(toneRgb, textSurfaces(theme), TEXT_TARGET);
    report.tone = tone;
    fg = tone.rgb;
    for (const k of FG_KEYS) vars[k] = toTriplet(fg);
    vars["--muted-foreground"] = toTriplet(ensureContrast(mix(fg, card, 0.4), textSurfaces(theme), TEXT_TARGET).rgb);
  }

  // Accent (buttons, active segments, focus ring, active page). Ink + a text tone: the ink follows the tone.
  const accentRaw = accentHex(a.accent);
  const accentBase = accentRaw ? hexToRgb(accentRaw) : light && toneRgb ? fg : null;
  let accent: Rgb = surfaceRgb(theme, "primary");
  if (accentBase) {
    const { solid, fg: label } = accentColours(accentBase, theme);
    if (accentRaw) report.accent = solid;
    accent = solid.rgb;
    for (const k of ["--primary", "--primary-solid", "--ring", "--sidebar-primary", "--sidebar-ring"]) vars[k] = toTriplet(accent);
    vars["--primary-foreground"] = toTriplet(label);
    vars["--sidebar-primary-foreground"] = toTriplet(label);
    vars["--accent-soft"] = toTriplet(ensureContrast(accent, [mix(card, accent, 0.12), ...textSurfaces(theme)], TEXT_TARGET).rgb);
  }

  // Hairlines.
  const lineRgb = a.lines === "theme" ? null : a.lines === "text" ? fg : a.lines === "accent" ? accent : hexToRgb(a.lines);
  if (lineRgb) {
    const strong = a.lines !== "text"; // coloured lines need more weight to read as lines
    vars["--border"] = toTriplet(mix(card, lineRgb, strong ? 0.34 : 0.16));
    vars["--card-border"] = toTriplet(mix(card, lineRgb, strong ? 0.36 : 0.18));
    vars["--sidebar-border"] = vars["--border"];
    vars["--popover-border"] = toTriplet(mix(card, lineRgb, strong ? 0.4 : 0.2));
    vars["--glass-border"] = toRgba(lineRgb, strong ? 0.3 : 0.12);
    vars["--field-border"] = toRgba(lineRgb, strong ? 0.42 : 0.2);
    vars["--tile-border"] = toRgba(lineRgb, strong ? 0.2 : 0.08);
  }

  // Money colours (P&L, win rate, calendars, result badges, charts).
  const money: ["win" | "loss" | "be", string | null, string][] = [["win", a.money.win, "--up"], ["loss", a.money.loss, "--down"], ["be", a.money.be, "--be"]];
  for (const [key, hex, token] of money) {
    if (!hex) continue;
    const g = moneyColour(hex, theme);
    if (!g) continue;
    report[key] = g;
    vars[token] = toTriplet(g.rgb);
  }

  // Guardrail meter fill (non-text: 3:1 against the panel and the canvas).
  const guardRgb = a.guard.color ? hexToRgb(a.guard.color) : null;
  if (guardRgb) {
    const g = ensureContrast(guardRgb, [card, surfaceRgb(theme, "background")], AA_UI);
    report.guard = g;
    vars["--guard"] = toTriplet(g.rgb);
  }

  // Journal chips: a group switched off reads neutral; custom colours are text-safe on the chip's own tint.
  for (const group of CHIP_GROUP_IDS) {
    const g = a.chips[group];
    for (const key of CHIP_GROUPS[group]) {
      const token = chipToken(group, key);
      if (!g.on) { vars[token] = "var(--muted-foreground)"; continue; }
      const hex = g.colors[key];
      const guarded = hex ? moneyColour(hex, theme) : null;
      if (!guarded) continue;
      vars[token] = toTriplet(guarded.rgb);
      if (guarded.adjusted) (report.chips ??= {})[token] = guarded;
    }
  }

  // A scene / your image behind the canvas: its visibility from «Яркость фона», panels as translucent as their muted
  // text allows (solid when even near-opaque glass would fail). Dark themes lift muted text so panels stay glassy.
  const src = sceneSource(a.bg.kind, theme);
  if (src) {
    if (!light && isScene(a.bg.kind) && !vars["--muted-foreground"]) vars["--muted-foreground"] = PHOTO_MUTED_DARK;
    const lv = sceneLevels(theme, src, a.bg.brightness);
    vars["--scene-vis"] = String(lv.visibility);
    if (a.bg.kind === "ridge") vars["--ridge-k"] = String(Math.round((lv.visibility / RIDGE_ALPHA_AT_K1) * 100) / 100);
    const panels = lv.solid ? "solid" : a.bg.panels;
    if (panels === "glass" || panels === "frosted") {
      const p = panels === "glass" ? lv.glass : lv.frosted;
      vars["--glass-bg"] = `color-mix(in srgb, hsl(var(--card)) ${Math.round(p * 100)}%, transparent)`;
      vars["--glass-thick-bg"] = `color-mix(in srgb, hsl(var(--popover)) ${Math.min(100, Math.round(p * 100) + 8)}%, transparent)`;
    }
    attrs["data-scene-panels"] = panels;
  }

  const stack = FONT_STACKS[a.font];
  if (stack) { vars["--app-font-sans"] = stack; attrs["data-font"] = a.font; }
  if (a.density !== "compact") attrs["data-density"] = a.density;
  if (a.bg.kind !== "none") attrs["data-bg"] = a.bg.kind;
  if (a.bg.panels !== "glass") attrs["data-panels"] = a.bg.panels;
  if (attrs["data-scene-panels"] === "solid") attrs["data-panels"] = "solid";

  return { vars, attrs, report };
}
