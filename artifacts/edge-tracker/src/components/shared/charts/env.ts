/**
 * Chart environment: may charts animate, is the theme dark. Both read <html> only.
 *
 *   motion — the app-wide «Движение» setting (lib/motion.ts: `data-motion="on|off|auto"` on <html>).
 *   dark   — the `dark` class on <html> (Полночь / Оникс); Платина / Светлая are light.
 */
import { useSyncExternalStore } from "react";
import { motionAllowed, useReducedMotion } from "@/lib/motion";

export { motionAllowed };

/** motionAllowed() as React state (re-renders when the setting or the OS preference changes). */
export function useMotionAllowed(): boolean {
  return !useReducedMotion();
}

/** Dark theme (glow and alpha steps differ). */
export function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function subDark(cb: () => void) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

/** isDarkTheme() as React state. */
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subDark, isDarkTheme, () => true);
}
