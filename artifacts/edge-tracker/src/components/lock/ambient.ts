/**
 * The lock screen's slow life: a drift loop and a breathing glow. Under prefers-reduced-motion nothing moves (a still
 * frame). Both pause while the tab is hidden and keep going while the window is merely unfocused (the lock screen is
 * meant for a monitor nobody is clicking on).
 *
 *   drift — ~20 fps loop writing on the root: --px / --py (−1…1, the scene layers' parallax, the same variables the
 *           «Вид» scenes read) and --dx / --dy (−1…1, the clock block's drift, which also keeps a static clock from
 *           burning into an OLED panel). Periods of 70–110 s: you notice it has moved, never that it moves.
 *   glow  — the halo behind the clock breathes (opacity and scale, 9 s per breath).
 */
import * as React from "react";

const FRAME_MS = 50;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Position of the drift at time `t` (seconds): two incommensurate sines per axis, so the path never repeats exactly. */
export function driftAt(t: number): { px: number; py: number; dx: number; dy: number } {
  const w = (period: number) => (2 * Math.PI) / period;
  return {
    px: Math.sin(t * w(97)) * 0.7 + Math.sin(t * w(41)) * 0.15,
    py: Math.sin(t * w(113) + 1.3) * 0.5 + Math.sin(t * w(53)) * 0.1,
    dx: Math.sin(t * w(71) + 0.4),
    dy: Math.sin(t * w(89) + 2.1),
  };
}

export function useAmbientDrift(root: React.RefObject<HTMLElement | null>, glow: React.RefObject<HTMLElement | null>): void {
  React.useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const start = performance.now() - Math.random() * 60_000;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      if (now - last >= FRAME_MS) {
        last = now;
        const d = driftAt((now - start) / 1000);
        el.style.setProperty("--px", d.px.toFixed(4));
        el.style.setProperty("--py", d.py.toFixed(4));
        el.style.setProperty("--dx", d.dx.toFixed(4));
        el.style.setProperty("--dy", d.dy.toFixed(4));
      }
      raf = requestAnimationFrame(tick);
    };
    const anim = glow.current?.animate?.(
      [{ opacity: 0.55, transform: "scale(0.94)" }, { opacity: 1, transform: "scale(1.06)" }],
      { duration: 9000, direction: "alternate", iterations: Number.POSITIVE_INFINITY, easing: "ease-in-out" },
    );
    const onVisible = () => {
      if (document.hidden) { anim?.pause(); return; }
      anim?.play();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      anim?.cancel();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [root, glow]);
}
