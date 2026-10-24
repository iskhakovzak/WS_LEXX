/**
 * The lock screen's slow life: a drift loop and a breathing glow, plus the 3D parallax under the pointer. `allowed`
 * is the viewer's «Движение фона» (auto = prefers-reduced-motion, on, off); without it nothing moves (a still frame).
 * Both pause while the tab is hidden and keep going while the window is merely unfocused (the lock screen is meant for
 * a monitor nobody is clicking on).
 *
 *   drift — ~20 fps loop writing on the root: --px / --py (−1…1, the scene layers' parallax, the same variables the
 *           «Вид» scenes read) and --dx / --dy (−1…1, the clock block's drift, which also keeps a static clock from
 *           burning into an OLED panel). Periods of 70–110 s: you notice it has moved, never that it moves.
 *   pointer — the cursor (or the phone's tilt) leans the scene like the «Вид» 3D scenes: eased toward the pointer and
 *           added on top of the drift, so a still mouse leaves the slow drift going.
 *   glow  — the halo behind the clock breathes (opacity and scale, 9 s per breath).
 */
import * as React from "react";
import { motionReduced } from "@/lib/motion";

const FRAME_MS = 50;

/** The app's motion setting (lib/motion.ts: «Движение и анимации», auto = the OS). */
export function prefersReducedMotion(): boolean {
  return motionReduced();
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

/** Drift share once the pointer leans the scene (the pointer gets the rest of the ±1 travel). */
const DRIFT_UNDER_POINTER = 0.3;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

export function useAmbientDrift(root: React.RefObject<HTMLElement | null>, glow: React.RefObject<HTMLElement | null>, allowed: boolean): void {
  React.useEffect(() => {
    const el = root.current;
    if (!el || !allowed) return;
    const start = performance.now() - Math.random() * 60_000;
    let raf = 0;
    let last = 0;
    // Pointer target (tx, ty) and its eased value (cx, cy); `lean` fades the pointer in on first move.
    let tx = 0, ty = 0, cx = 0, cy = 0, lean = 0, leanTo = 0;
    const tick = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      if (now - last >= FRAME_MS) {
        last = now;
        const d = driftAt((now - start) / 1000);
        cx += (tx - cx) * 0.14;
        cy += (ty - cy) * 0.14;
        lean += (leanTo - lean) * 0.08;
        const k = 1 - lean * (1 - DRIFT_UNDER_POINTER);
        el.style.setProperty("--px", clamp1(d.px * k + cx * lean).toFixed(4));
        el.style.setProperty("--py", clamp1(d.py * k + cy * lean).toFixed(4));
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
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      leanTo = 1;
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      tx = clamp1(e.gamma / 30);
      ty = clamp1((e.beta - 45) / 30);
      leanTo = 1;
    };
    // The pointer leaving the window hands the scene back to the drift.
    const onLeave = () => { leanTo = 0; };
    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("deviceorientation", onTilt);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      anim?.cancel();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [root, glow, allowed]);
}
