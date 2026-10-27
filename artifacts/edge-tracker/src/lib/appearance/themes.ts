/**
 * The surfaces of each theme as the contrast guard sees them: a copy of the HSL triplets in src/index.css
 * (`:root` = light, `.dark`, `.dark.dim`, `.platinum`). appearance-tokens.test.ts parses index.css and fails when the
 * two drift apart, and checks every text token of every theme for WCAG AA against these surfaces.
 */
import { tripletToRgb, type Rgb } from "./color";
import type { ThemeId } from "./model";

export type ThemeSurfaces = {
  background: string;
  card: string;
  popover: string;
  muted: string;
  secondary: string;
  sidebar: string;
  /** Default text colour (lines «as text» start from it). */
  foreground: string;
  /** Default monochrome primary. */
  primary: string;
};

export const THEME_SURFACES: Record<ThemeId, ThemeSurfaces> = {
  light: { background: "0 0% 96%", card: "0 0% 100%", popover: "0 0% 100%", muted: "0 0% 93%", secondary: "0 0% 93%", sidebar: "0 0% 100%", foreground: "0 0% 9%", primary: "0 0% 9%" },
  dark: { background: "0 0% 4%", card: "0 0% 8%", popover: "0 0% 9%", muted: "0 0% 13%", secondary: "0 0% 13%", sidebar: "0 0% 6%", foreground: "0 0% 94%", primary: "0 0% 95%" },
  dim: { background: "0 0% 6%", card: "0 0% 16%", popover: "0 0% 17%", muted: "0 0% 20%", secondary: "0 0% 21%", sidebar: "0 0% 14%", foreground: "0 0% 93%", primary: "0 0% 94%" },
  platinum: { background: "0 0% 72%", card: "0 0% 81%", popover: "0 0% 85%", muted: "0 0% 76%", secondary: "0 0% 76%", sidebar: "0 0% 79%", foreground: "0 0% 8%", primary: "0 0% 8%" },
};

const rgb = (t: string): Rgb => tripletToRgb(t) ?? [128, 128, 128];

/** Every surface text can sit on in this theme (canvas, panels, popovers, muted chips). */
export function textSurfaces(theme: ThemeId): Rgb[] {
  const s = THEME_SURFACES[theme];
  return [s.background, s.card, s.popover, s.muted, s.secondary, s.sidebar].map(rgb);
}

export function surfaceRgb(theme: ThemeId, key: keyof ThemeSurfaces): Rgb {
  return rgb(THEME_SURFACES[theme][key]);
}
