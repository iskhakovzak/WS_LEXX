/**
 * The theme tokens in src/index.css, checked for WCAG AA (the repo's contrast check for themes): every text token of
 * every theme against every surface text sits on, labels on solid fills, plus the copy of the surfaces in themes.ts
 * that the «Вид» contrast guard uses must match the stylesheet.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AA_TEXT, contrast, minContrast, mix, tripletToRgb, type Rgb } from "./color";
import { THEME_IDS, type ThemeId } from "./model";
import { THEME_SURFACES } from "./themes";

const css = readFileSync(path.resolve(import.meta.dirname, "../../index.css"), "utf8").replace(/\r\n/g, "\n");

/** Custom properties of a top-level rule (`selector {` at column 0), comments stripped. */
function block(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{\\n([\\s\\S]*?)^\\}`, "gm");
  for (const m of css.matchAll(re)) {
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, "");
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

const CHAIN: Record<ThemeId, string[]> = { light: [":root"], dark: [":root", ".dark"], dim: [":root", ".dark", ".dim"], platinum: [":root", ".platinum"] };

function tokens(theme: ThemeId): Record<string, string> {
  const merged = Object.assign({}, ...CHAIN[theme].map(block)) as Record<string, string>;
  // var(--x) references resolve on the same element (the theme classes sit on <html> with :root).
  for (const [k, v] of Object.entries(merged)) {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (m && merged[m[1]]) merged[k] = merged[m[1]];
  }
  return merged;
}

const rgbOf = (tk: Record<string, string>, name: string): Rgb => {
  const v = tripletToRgb(tk[name] ?? "");
  if (!v) throw new Error(`token ${name} is not an HSL triplet: ${tk[name]}`);
  return v;
};

const SURFACES = ["--background", "--card", "--popover", "--muted", "--secondary", "--sidebar"];
const TEXT = ["--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground", "--muted-foreground", "--up", "--down", "--warn", "--be", "--purple", "--medal-bronze", "--medal-silver", "--medal-gold", "--medal-platinum"];

describe.each(THEME_IDS as readonly ThemeId[])("theme tokens: %s", (theme) => {
  const tk = tokens(theme);
  const surfaces = SURFACES.map((s) => rgbOf(tk, s));

  it.each(TEXT)("%s clears 4.5:1 on every surface", (name) => {
    expect(minContrast(rgbOf(tk, name), surfaces)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("semantic tones also read on their 12% tinted pills (bg-up/12 …)", () => {
    const card = rgbOf(tk, "--card");
    for (const name of ["--up", "--down", "--warn", "--purple"]) {
      const c = rgbOf(tk, name);
      expect(contrast(c, mix(card, c, 0.12)), name).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("labels on solid fills (buttons, active segments, the sidebar's active item)", () => {
    expect(contrast(rgbOf(tk, "--primary-foreground"), rgbOf(tk, "--primary-solid"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(rgbOf(tk, "--primary-foreground"), rgbOf(tk, "--primary"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(rgbOf(tk, "--sidebar-primary-foreground"), rgbOf(tk, "--sidebar-primary"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the contrast guard's copy of the surfaces matches index.css", () => {
    const s = THEME_SURFACES[theme];
    for (const key of ["background", "card", "popover", "muted", "secondary", "sidebar", "foreground", "primary"] as const) {
      expect(tk[`--${key}`], `${theme} --${key}`).toBe(s[key]);
    }
  });
});
