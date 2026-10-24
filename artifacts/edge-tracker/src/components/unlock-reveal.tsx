/**
 * The moment after a right unlock code: the site opens through an iris from the point where the check was (the lock
 * screen hands it over with `setRevealOrigin`), the page under it settling from a slight zoom. One shot, ~800 ms, no
 * pointer events; nothing at all without «Движение фона» (the site just appears).
 * Lives at the top of components/ next to lock-screen.tsx, which it continues.
 */
import * as React from "react";

let origin: { x: number; y: number } | null = null;

/** Where the iris opens from (viewport px); set by the lock screen right before the lock goes away. */
export function setRevealOrigin(p: { x: number; y: number }): void {
  origin = p;
}

const DURATION_MS = 820;

export function UnlockReveal({ motion, onDone }: { motion: boolean; onDone: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!motion || !el?.animate) { onDone(); return; }
    const p = origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    origin = null;
    // The farthest corner, so the circle ends past every edge.
    const r = Math.hypot(Math.max(p.x, window.innerWidth - p.x), Math.max(p.y, window.innerHeight - p.y)) + 40;
    const at = `${Math.round(p.x)}px ${Math.round(p.y)}px`;
    const mask = (rad: number, soft: number) => `radial-gradient(circle at ${at}, transparent ${rad}px, black ${rad + soft}px)`;
    const a = el.animate(
      [
        { maskImage: mask(0, 2), WebkitMaskImage: mask(0, 2), opacity: 1 },
        { maskImage: mask(r * 0.55, 120), WebkitMaskImage: mask(r * 0.55, 120), opacity: 1, offset: 0.6 },
        { maskImage: mask(r, 160), WebkitMaskImage: mask(r, 160), opacity: 0 },
      ] as Keyframe[],
      { duration: DURATION_MS, easing: "cubic-bezier(0.3, 0.6, 0.2, 1)", fill: "forwards" },
    );
    const main = document.getElementById("main-content") ?? document.querySelector("main");
    main?.animate?.(
      [{ transform: "scale(1.035)", filter: "blur(6px)" }, { transform: "scale(1)", filter: "blur(0px)" }],
      { duration: DURATION_MS, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" },
    );
    let done = false;
    const finish = () => { if (!done) { done = true; onDone(); } };
    a.finished.then(finish, finish);
    return () => { a.cancel(); finish(); };
  }, [motion, onDone]);
  return <div ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-tooltip bg-black print:hidden" />;
}
