/**
 * The hero moments shared by the screen lock (components/lock) and the sign-in page (pages/login, components/auth):
 *
 *   <SuccessDisc motion onDrawn={…} />   the glass disc with a check that draws itself (a right code / a right PIN)
 *   <RimSweep ref={…} /> + playRimSweep  a light that runs along a glass rim once (a field or a card appearing)
 *   playShake(el)                         a damped, designed «no» (wrong secret)
 *   rippleFrom(e)                         a soft press ripple from the pointer inside a button
 *   playHeroExit({…})                     the exit: content floats up and out, a ring opens from the check, the scene
 *                                         moves toward you; resolves when the ring is out (~700 ms)
 *
 * Everything takes the caller's `motion` (the lock reads the account's «Движение фона», the sign-in page this
 * browser's last look, both through lib/motion) and does nothing at all without it. Pure Web Animations: no layout
 * property is animated, nothing blocks input.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export const HERO_EASE = "cubic-bezier(0.2, 0.9, 0.2, 1)";
const finished = (a: Animation | undefined | null) => (a ? a.finished.then(() => undefined, () => undefined) : Promise.resolve());

/**
 * The glass disc with the self-drawing check. Plays on mount: the disc rises out of a blur with a slight overshoot,
 * then the tick draws itself; `onDrawn` fires when the tick is complete (at once without motion).
 */
export function SuccessDisc({
  motion, onDrawn, delay = 140, size = 56, className,
}: { motion: boolean; onDrawn?: () => void; delay?: number; size?: number; className?: string }) {
  const discRef = React.useRef<HTMLSpanElement>(null);
  const tickRef = React.useRef<SVGPathElement>(null);
  const onDrawnRef = React.useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  React.useEffect(() => {
    if (!motion || !discRef.current?.animate) { onDrawnRef.current?.(); return; }
    const disc = discRef.current.animate(
      [
        { transform: "scale(0.4)", opacity: 0, filter: "blur(8px)" },
        { transform: "scale(1.08)", opacity: 1, filter: "blur(0px)", offset: 0.65 },
        { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
      ],
      { duration: 520, delay, easing: HERO_EASE, fill: "backwards" },
    );
    const tick = tickRef.current?.animate?.(
      [{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }],
      { duration: 380, delay: delay + 280, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "backwards" },
    );
    let alive = true;
    void finished(tick).then(() => { if (alive) onDrawnRef.current?.(); });
    return () => { alive = false; disc.cancel(); tick?.cancel(); };
  }, [motion, delay]);
  return (
    <span
      ref={discRef}
      data-success-disc=""
      className={cn("grid place-items-center rounded-full border border-white/35 bg-white/10 backdrop-blur-xl", className)}
      style={{ width: size, height: size, boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset, 0 10px 40px rgba(0,0,0,0.45), 0 0 36px rgba(255,255,255,0.22)" }}
    >
      <svg viewBox="0 0 24 24" style={{ width: size / 2, height: size / 2 }} fill="none" aria-hidden="true">
        <path ref={tickRef} d="M5.5 12.5l4.2 4.2L18.5 7.8" stroke="white" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={24} />
      </svg>
    </span>
  );
}

/** The rim light: put it inside a `relative` glass surface; `playRimSweep` runs it once. */
export const RimSweep = React.forwardRef<HTMLSpanElement, { className?: string; tone?: "light" | "dark" }>(function RimSweep({ className, tone = "light" }, ref) {
  const c = tone === "light" ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.08)";
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}>
      <span ref={ref} className="absolute inset-y-0 left-0 w-1/2 opacity-0" style={{ background: `linear-gradient(100deg, transparent, ${c}, transparent)` }} />
    </span>
  );
});

export function playRimSweep(el: HTMLElement | null | undefined, opts: { delay?: number; duration?: number } = {}): void {
  el?.animate?.(
    [{ transform: "translateX(-120%)", opacity: 0 }, { opacity: 0.9, offset: 0.35 }, { transform: "translateX(220%)", opacity: 0 }],
    { duration: opts.duration ?? 900, delay: opts.delay ?? 0, easing: "ease-in-out" },
  );
}

/** A wrong answer: a quick damped shake (it decays like a head shaking «no», not a buzzer), with an optional red glow. */
export function playShake(el: HTMLElement | null | undefined, opts: { glow?: boolean } = {}): void {
  if (!el?.animate) return;
  el.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-10px) rotate(-0.4deg)", offset: 0.14 },
      { transform: "translateX(9px) rotate(0.35deg)", offset: 0.3 },
      { transform: "translateX(-6px)", offset: 0.48 },
      { transform: "translateX(4px)", offset: 0.66 },
      { transform: "translateX(-1.5px)", offset: 0.84 },
      { transform: "translateX(0)" },
    ],
    { duration: 460, easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)", composite: "add" },
  );
  if (opts.glow) {
    el.animate(
      [{ boxShadow: "0 0 0 1px hsl(var(--down) / 0.55), 0 0 32px hsl(var(--down) / 0.28)" }, { boxShadow: "0 0 0 1px hsl(var(--down) / 0), 0 0 32px hsl(var(--down) / 0)" }],
      { duration: 900, easing: "ease-out" },
    );
  }
}

/**
 * A soft ripple from the press point (the button needs `relative overflow-hidden`). Pointer events only: the
 * keyboard's Enter has no point, the button's own press scale answers it.
 */
export function rippleFrom(e: React.PointerEvent<HTMLElement>, motion: boolean): void {
  const host = e.currentTarget;
  if (!motion || !host.animate || e.button !== 0) return;
  const box = host.getBoundingClientRect();
  const size = Math.hypot(box.width, box.height) * 2;
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  Object.assign(dot.style, {
    position: "absolute", left: `${e.clientX - box.left - size / 2}px`, top: `${e.clientY - box.top - size / 2}px`,
    width: `${size}px`, height: `${size}px`, borderRadius: "9999px", pointerEvents: "none",
    background: "radial-gradient(closest-side, currentColor, transparent)", opacity: "0",
  });
  host.appendChild(dot);
  const a = dot.animate(
    [{ transform: "scale(0.05)", opacity: 0.22 }, { transform: "scale(1)", opacity: 0 }],
    { duration: 650, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
  );
  void finished(a).then(() => dot.remove());
}

/**
 * The exit after a right secret: `content` floats up and out of a blur, the ring opens from `origin` and the scene
 * moves toward you, brightening. Resolves when the ring has gone (or at once without motion).
 */
export async function playHeroExit({
  motion, origin, ring, scene, content,
}: {
  motion: boolean;
  origin: { x: number; y: number };
  ring: HTMLElement | null;
  scene: HTMLElement | null;
  content: (HTMLElement | null)[];
}): Promise<void> {
  if (!motion) return;
  if (ring) { ring.style.left = `${origin.x}px`; ring.style.top = `${origin.y}px`; }
  for (const el of content) {
    el?.animate?.(
      [{ transform: "translateY(0)", opacity: 1, filter: "blur(0px)" }, { transform: "translateY(-36px)", opacity: 0, filter: "blur(10px)" }],
      { duration: 520, easing: HERO_EASE, fill: "forwards" },
    );
  }
  scene?.animate?.(
    [{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.12)", filter: "brightness(1.35)" }],
    { duration: 700, easing: HERO_EASE, fill: "forwards" },
  );
  const a = ring?.animate?.(
    [{ transform: "translate(-50%, -50%) scale(0.2)", opacity: 0.9 }, { transform: "translate(-50%, -50%) scale(14)", opacity: 0 }],
    { duration: 700, easing: "cubic-bezier(0.1, 0.7, 0.3, 1)", fill: "forwards" },
  );
  await (a ? finished(a) : new Promise<void>((r) => window.setTimeout(r, 650)));
}

/** The ring `playHeroExit` opens (render once per screen, fixed, invisible until the exit). */
export const HeroRing = React.forwardRef<HTMLDivElement, { className?: string }>(function HeroRing({ className }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("pointer-events-none fixed h-24 w-24 rounded-full border border-white/70 opacity-0", className)}
      style={{ left: "50%", top: "50%", boxShadow: "0 0 40px rgba(255,255,255,0.35), inset 0 0 30px rgba(255,255,255,0.2)" }}
    />
  );
});

/**
 * A soft light ring that follows keyboard / tap focus between the fields of a form: one element glides from field to
 * field (transform), takes the focused field's size and radius, and fades out when focus leaves the form. Put it as
 * the first child of the `relative` form; a field may mark a wider box to ring with `data-glow`.
 */
export function FocusGlow({ container, motion }: { container: React.RefObject<HTMLElement | null>; motion: boolean }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const root = container.current;
    const glow = ref.current;
    if (!root || !glow) return;
    let shown = false;
    const place = (target: Element | null, instant = false) => {
      if (!(target instanceof HTMLInputElement) || !root.contains(target) || target.hidden) return;
      const field = target.closest<HTMLElement>("[data-glow]") ?? target;
      const r = root.getBoundingClientRect();
      const b = field.getBoundingClientRect();
      const glide = shown && motion && !instant;
      glow.style.transition = glide
        ? "transform var(--dur-4) var(--ease), width var(--dur-4) var(--ease), height var(--dur-4) var(--ease), opacity var(--dur-3) var(--ease)"
        : "opacity var(--dur-3) var(--ease)";
      glow.style.width = `${b.width}px`;
      glow.style.height = `${b.height}px`;
      glow.style.borderRadius = getComputedStyle(target).borderRadius;
      // Relative to the form's padding box (where an absolute child starts).
      glow.style.transform = `translate3d(${b.left - r.left - root.clientLeft}px, ${b.top - r.top - root.clientTop}px, 0)`;
      glow.style.opacity = "1";
      shown = true;
    };
    const onIn = (e: FocusEvent) => place(e.target as Element);
    const onOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return;
      glow.style.opacity = "0";
      shown = false;
    };
    // The form resized (viewport, a hint line appearing): follow the focused field at once, no glide.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (shown) place(document.activeElement, true); }) : null;
    ro?.observe(root);
    // The fields rise in with an animation: a field focused on load is measured mid-way, so settle on it once any
    // entrance animation / transition inside the form (or of the card around it) ends — no ring left offset.
    const settle = () => { if (shown) place(document.activeElement, true); };
    const host = root.parentElement ?? root;
    root.addEventListener("focusin", onIn);
    root.addEventListener("focusout", onOut);
    host.addEventListener("animationend", settle);
    host.addEventListener("transitionend", settle);
    window.addEventListener("resize", settle);
    place(document.activeElement);
    const late = window.setTimeout(settle, 1200);
    return () => {
      ro?.disconnect();
      window.clearTimeout(late);
      root.removeEventListener("focusin", onIn);
      root.removeEventListener("focusout", onOut);
      host.removeEventListener("animationend", settle);
      host.removeEventListener("transitionend", settle);
      window.removeEventListener("resize", settle);
    };
  }, [container, motion]);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-focus-glow=""
      className="pointer-events-none absolute left-0 top-0 opacity-0"
      style={{ boxShadow: "0 0 0 1px hsl(var(--foreground) / 0.28), 0 0 0 5px hsl(var(--foreground) / 0.06), 0 0 28px 2px hsl(var(--foreground) / 0.16)" }}
    />
  );
}

/** A light sweeping across a busy button (inside a `relative overflow-hidden` button, while it waits). */
export function BusyShimmer() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <span className="ws-shimmer absolute inset-y-0 -left-1/2 w-1/2" style={{ background: "linear-gradient(100deg, transparent, hsl(var(--background) / 0.35), transparent)" }} />
    </span>
  );
}
