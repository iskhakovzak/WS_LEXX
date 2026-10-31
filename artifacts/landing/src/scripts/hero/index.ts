// Hero background: a GPU particle cloud shaped like the WS_DeskOS mark, stirred by the cursor through a fluid sim.
// Loaded lazily after first paint (Home.astro). Throws when WebGL2 or float render targets are missing, so the
// caller keeps the static fallback.
import * as THREE from "three";
import { Cloud } from "./cloud";
import { Fluid } from "./fluid";

export interface HeroOptions {
  canvas: HTMLCanvasElement;
  /** The hero section: rendering pauses while it is off-screen. */
  hero: HTMLElement;
  /** Where the mark should sit (a CSS box clear of the hero columns); without it the mark is centred. */
  stage?: HTMLElement | null;
  reducedMotion: boolean;
  onReady: () => void;
  onLost: () => void;
}

const clampMap = (v: number, a: number, b: number, c: number, d: number) => c + (d - c) * Math.min(1, Math.max(0, (v - a) / (b - a)));

export function startHero(o: HeroOptions): () => void {
  const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 760;
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  const fail = (why: string) => { renderer.dispose(); throw new Error(why); };
  if (!renderer.capabilities.isWebGL2) fail("WebGL2 unavailable");
  if (!renderer.extensions.has("EXT_color_buffer_float")) fail("float render targets unavailable");
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 1);

  const cloud = new Cloud(renderer, mobile ? 128 : 512, dpr);
  const fluid = o.reducedMotion ? null : new Fluid(renderer, { simSize: mobile ? 128 : 256, dyeSize: mobile ? 256 : 512, type: THREE.HalfFloatType });

  let width = 0, height = 0, gain = 0;
  // Brightness: the desktop cloud has 16x the points of the mobile one on the same surface. A smaller mark packs the
  // same points into less area, so the gain falls with the mark's on-screen area (else it saturates into a solid shape).
  const baseGain = mobile ? 0.85 : 0.38;
  const refPx = mobile ? 260 : 533;
  const resize = () => {
    width = o.canvas.clientWidth || window.innerWidth;
    height = o.canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    const r = o.stage?.getBoundingClientRect();
    // The canvas is fixed and the hero starts at the top of the page: stage coordinates as if scrolled to the top.
    const box = r && r.width > 40 && r.height > 40 ? { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height } : null;
    const markPx = cloud.resize(width, height, box);
    gain = baseGain * Math.min(1, Math.max(0.3, (markPx / refPx) ** 2));
  };
  resize();

  // Pointer (mouse, pen and touch feed the same input).
  const now = { x: -1, y: -1 }, prev = { x: -1, y: -1 };
  let hasPointer = false, lastSplat = 0;
  const move = (x: number, y: number) => { now.x = x; now.y = y; if (!hasPointer) { prev.x = x; prev.y = y; hasPointer = true; } };
  const onPointer = (e: PointerEvent) => move(e.clientX, e.clientY);
  const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); };
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("touchmove", onTouch, { passive: true });

  const a = new THREE.Vector2(), b = new THREE.Vector2(), force = new THREE.Vector2(), gazePt = new THREE.Vector2();
  function feedFluid(t: number) {
    if (!fluid || !hasPointer) return;
    const dx = now.x - prev.x, dy = now.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.01) {
      const radius = clampMap(len, 0, 5, 0, 60) * 0.6 * (mobile ? 0.8 : 1);
      const mult = clampMap(len, 0, 15, 0, 10);
      b.set(now.x / width, 1 - now.y / height);
      if (t - lastSplat > 50) a.copy(b); else a.set(prev.x / width, 1 - prev.y / height);
      force.set(dx * mult, -dy * mult);
      fluid.splat(a, b, force, (radius / 200) * 0.35, width / height);
      lastSplat = t;
    }
    prev.x = now.x; prev.y = now.y;
  }

  // Lifecycle: run only while the tab is visible and the hero is on screen.
  let visible = !document.hidden, onScreen = true, raf = 0, last = 0, time = 0, frames = 0, ready = false;
  const speed = o.reducedMotion ? 0.15 : 1;
  if (o.reducedMotion) {
    // Settle the cloud before the first frame, then let it drift very slowly with no cursor input.
    for (let i = 0; i < 240; i++) cloud.step({ dt: 1 / 60, time: i / 60, fluid: null, pointer: null, gain });
  }
  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((t - last) / 1000, 1 / 20) : 1 / 60;
    last = t;
    time += dt * speed;
    feedFluid(t);
    if (fluid) fluid.step(1 / 60);
    gazePt.set((now.x / width) * 2 - 1, -((now.y / height) * 2 - 1));
    cloud.step({
      dt: dt * speed, time, pointer: hasPointer && !o.reducedMotion ? gazePt : null, gain,
      fluid: fluid ? { velocity: fluid.velocity.read.texture, density: fluid.density.read.texture } : null,
    });
    cloud.render();
    if (!ready && ++frames > 2) { ready = true; o.onReady(); }
  }
  const sync = () => {
    const run = visible && onScreen;
    if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  const onVisibility = () => { visible = !document.hidden; sync(); };
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); });
  io.observe(o.hero);
  const onResize = () => { resize(); if (!raf) cloud.render(); };
  window.addEventListener("resize", onResize);
  const onLost = (e: Event) => { e.preventDefault(); stop(); o.onLost(); };
  o.canvas.addEventListener("webglcontextlost", onLost);
  sync();

  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    io.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointer);
    window.removeEventListener("touchmove", onTouch);
    o.canvas.removeEventListener("webglcontextlost", onLost);
  }
  return () => { stop(); fluid?.dispose(); cloud.dispose(); renderer.dispose(); };
}
