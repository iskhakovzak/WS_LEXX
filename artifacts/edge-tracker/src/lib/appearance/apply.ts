/**
 * Puts a computed appearance on <html> (inline custom properties + data attributes) and caches it in localStorage,
 * so the inline script in index.html can replay it before the first paint (no flash of the default look).
 * The cache is keyed by theme: computed colours depend on the theme's surfaces, so a cache for another theme is
 * ignored by the boot script and recomputed by the app.
 */
import { APPEARANCE_ATTRS, type ComputedAppearance } from "./vars";
import type { ThemeId } from "./model";

/** localStorage: { theme, vars, attrs } — read by the boot script in index.html (keep the two in sync). */
export const LOOK_CACHE_KEY = "ws_lexx_look";

let applied: string[] = [];

export function applyComputedAppearance(c: Pick<ComputedAppearance, "vars" | "attrs">, theme: ThemeId, root: HTMLElement = document.documentElement): void {
  const style = root.style;
  // Variables set by the boot script are not in `applied` yet: clear every custom property this module owns.
  const owned = new Set([...applied, ...readCachedKeys()]);
  for (const k of owned) if (!(k in c.vars)) style.removeProperty(k);
  for (const [k, v] of Object.entries(c.vars)) if (style.getPropertyValue(k) !== v) style.setProperty(k, v);
  applied = Object.keys(c.vars);
  for (const a of APPEARANCE_ATTRS) {
    const v = c.attrs[a];
    if (v == null) root.removeAttribute(a);
    else if (root.getAttribute(a) !== v) root.setAttribute(a, v);
  }
  try {
    localStorage.setItem(LOOK_CACHE_KEY, JSON.stringify({ theme, vars: c.vars, attrs: c.attrs }));
  } catch { /* storage full / private mode: the app still applies it after boot */ }
}

function readCachedKeys(): string[] {
  try {
    const raw = localStorage.getItem(LOOK_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { vars?: Record<string, string> }) : null;
    return parsed?.vars ? Object.keys(parsed.vars) : [];
  } catch {
    return [];
  }
}

/** Sign-out / another account on this browser: drop the cached look so the next person starts from the default. */
export function clearAppearanceCache(): void {
  try { localStorage.removeItem(LOOK_CACHE_KEY); } catch { /* ignore */ }
}
