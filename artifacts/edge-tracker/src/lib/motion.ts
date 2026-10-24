/**
 * One answer to «may things move?» for the whole app. The viewer's «Движение и анимации» (appearance `bg.motion`,
 * mirrored on <html data-motion> by lib/appearance and the boot script before first paint):
 *   on   — animate, even when the OS asks to reduce motion (Windows «Animation effects» off);
 *   off  — never animate;
 *   auto — follow the OS (prefers-reduced-motion).
 * The CSS side reads the same attribute (index.css: the global kill-switch and the motion-safe / motion-reduce
 * variants), framer-motion through <MotionConfig> in App.tsx, and JS through `motionReduced()` / `useReducedMotion()`.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function attr(): string | null {
  return typeof document === "undefined" ? null : document.documentElement.getAttribute("data-motion");
}

/** True when nothing should move right now. */
export function motionReduced(): boolean {
  const pref = attr();
  if (pref === "on") return false;
  if (pref === "off") return true;
  return typeof matchMedia !== "undefined" && matchMedia(QUERY).matches;
}

export const motionAllowed = (): boolean => !motionReduced();

function subscribe(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  const mq = typeof matchMedia !== "undefined" ? matchMedia(QUERY) : null;
  mq?.addEventListener?.("change", cb);
  return () => { mo.disconnect(); mq?.removeEventListener?.("change", cb); };
}

/** Drop-in for framer-motion's `useReducedMotion`, but following the app setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, () => false);
}

/** `behavior` for scrollIntoView / scrollTo. */
export const scrollBehavior = (): ScrollBehavior => (motionReduced() ? "auto" : "smooth");
