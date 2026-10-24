/**
 * One answer to «may things move?» for the whole app. The viewer's «Движение и анимации» (appearance `bg.motion`):
 * on by default — even when the OS asks to reduce motion (Windows «Animation effects» off) — and off only when the
 * viewer switched it off, which lib/appearance and the boot script mirror as <html data-motion="off"> before first
 * paint (owner, 2026-10-25: «пусть всегда будут анимации по умолчанию, но можно выключить»).
 * The CSS side reads the same attribute (index.css: the global kill-switch and the motion-safe / motion-reduce
 * variants), framer-motion through <MotionConfig> in App.tsx, and JS through `motionReduced()` / `useReducedMotion()`.
 */
import { useSyncExternalStore } from "react";

function attr(): string | null {
  return typeof document === "undefined" ? null : document.documentElement.getAttribute("data-motion");
}

/** True when nothing should move right now. */
export function motionReduced(): boolean {
  return attr() === "off";
}

export const motionAllowed = (): boolean => !motionReduced();

function subscribe(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => mo.disconnect();
}

/** Drop-in for framer-motion's `useReducedMotion`, but following the app setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, () => false);
}

/** `behavior` for scrollIntoView / scrollTo. */
export const scrollBehavior = (): ScrollBehavior => (motionReduced() ? "auto" : "smooth");
