/**
 * Motion for the «WS originals» scenes. One requestAnimationFrame loop per scene, throttled (~30 fps), that runs only
 * while something moves and stops itself when idle; it pauses while the tab is hidden or the window is not focused.
 * «Движение и анимации» (bg.motion): on by default whatever the OS says; «off» is always still.
 *   parallax — writes --px / --py (−1…1, eased) on the scene root; layers translate by depth in CSS.
 *              Phones: the device's tilt, only when that permission is already granted (never prompts).
 *   trail    — a soft smoke trail behind the pointer on a half-resolution canvas, fading out.
 */

const FRAME_MS = 33;

export const isPaused = () => (typeof document !== "undefined" && (document.hidden || !document.hasFocus()));

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whether motion runs for the «Движение и анимации» choice (on unless switched off; an old «auto» = on). */
export function bgMotionAllowed(pref: "auto" | "on" | "off"): boolean {
  return pref !== "off";
}

/** Parallax follows the pointer even while another window has focus (a second monitor); only a hidden tab pauses it. */
const isHidden = () => typeof document !== "undefined" && document.hidden;

/** Device tilt without ever asking: iOS fires the events only if access was granted before; elsewhere check first. */
async function tiltAllowed(): Promise<boolean> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return false;
  if (typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === "function") return true;
  try {
    const st = await navigator.permissions?.query({ name: "accelerometer" as PermissionName });
    return st?.state === "granted";
  } catch {
    return false;
  }
}

export type Trail = { point: (x: number, y: number) => void; frame: () => boolean; resize: () => void };

/** Trail painter: `frame()` fades and draws pending points; returns false once fully faded (idle). */
export function createTrail(canvas: HTMLCanvasElement, light: boolean): Trail {
  const ctx = canvas.getContext("2d");
  const scale = 0.5;
  let pending: [number, number][] = [];
  let energy = 0;
  const resize = () => {
    canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
    canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
  };
  resize();
  return {
    point(x, y) { pending.push([x * scale, y * scale]); if (pending.length > 24) pending = pending.slice(-24); },
    resize,
    frame() {
      if (!ctx) return false;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      for (const [x, y] of pending) {
        const r = 46;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, light ? "rgba(30,30,30,0.5)" : "rgba(255,255,255,0.5)");
        g.addColorStop(1, light ? "rgba(30,30,30,0)" : "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      energy = pending.length ? 1 : energy * 0.93;
      pending = [];
      return energy > 0.02;
    },
  };
}

/**
 * Wires pointer / tilt input to a scene root. `onTick` runs inside the single loop (trail drawing); `parallax`
 * toggles the --px / --py easing. Returns the cleanup.
 */
export function startSceneMotion(root: HTMLElement, opts: { parallax: boolean; allowed: boolean; trail?: Trail | null; externalLoop?: boolean }): () => void {
  if (!opts.allowed) return () => {};
  let raf = 0, last = 0, tx = 0, ty = 0, cx = 0, cy = 0, alive = true, trailBusy = false;
  const tick = (now: number) => {
    raf = 0;
    if (!alive || (opts.parallax ? isHidden() : isPaused())) return;
    if (now - last < FRAME_MS) { raf = requestAnimationFrame(tick); return; }
    last = now;
    let busy = false;
    if (opts.parallax) {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      root.style.setProperty("--px", cx.toFixed(3));
      root.style.setProperty("--py", cy.toFixed(3));
      busy = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002;
    }
    if (opts.trail && !opts.externalLoop) { trailBusy = opts.trail.frame(); busy ||= trailBusy; }
    if (busy) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf && alive) raf = requestAnimationFrame(tick); };
  const onMove = (e: PointerEvent) => {
    tx = (e.clientX / window.innerWidth) * 2 - 1;
    ty = (e.clientY / window.innerHeight) * 2 - 1;
    opts.trail?.point(e.clientX, e.clientY);
    kick();
  };
  const onTilt = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    tx = Math.max(-1, Math.min(1, e.gamma / 30));
    ty = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
    kick();
  };
  const onResize = () => opts.trail?.resize();
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", kick);
  let tiltOn = false;
  if (opts.parallax && matchMedia("(pointer: coarse)").matches) {
    void tiltAllowed().then((ok) => { if (ok && alive) { tiltOn = true; window.addEventListener("deviceorientation", onTilt); } });
  }
  return () => {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("focus", kick);
    document.removeEventListener("visibilitychange", kick);
    if (tiltOn) window.removeEventListener("deviceorientation", onTilt);
  };
}
