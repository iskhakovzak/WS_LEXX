/**
 * The drifting smoke behind the opening intro: domain-warped value noise drawn into a ~10k-pixel canvas (CSS scales
 * it to the screen and blurs it), monochrome. ~7 noise lookups per pixel → ~3 ms per frame on a desktop; if frames
 * average more than 8 ms (weak laptop) the field is only redrawn every other frame (the drift is slow, so it reads
 * the same). Plain 2D canvas, no WebGL. `startSmoke` returns the stop function; nothing runs after it is called.
 */

const PIXELS = 10_000;

/** Seeded permutation table (the same smoke shape on every load). */
function makePerm(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
}

const PERM = makePerm(0x5eed);

function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const X = xi & 255, Y = yi & 255;
  const a = PERM[PERM[X] + Y], b = PERM[PERM[X + 1] + Y];
  const c = PERM[PERM[X] + Y + 1], d = PERM[PERM[X + 1] + Y + 1];
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const top = a + (b - a) * u, bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) / 255;
}

/** Two octaves (warp) / three octaves (final field), each normalised to 0…1. */
function fbm2(x: number, y: number): number {
  return (noise(x, y) * 2 + noise(x * 2.03 + 17.1, y * 2.03 - 9.7)) / 3;
}
function fbm3(x: number, y: number): number {
  return (noise(x, y) * 4 + noise(x * 2.01 + 5.3, y * 2.01 + 1.7) * 2 + noise(x * 4.03 - 7.9, y * 4.03 + 3.1)) / 7;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface SmokeOptions {
  /** Light theme: grey smoke on near-white. Dark: white-grey smoke on black. */
  light: boolean;
  /** prefers-reduced-motion: draw one still frame, no loop. */
  still: boolean;
  /** Time scale of the drift (1 = the intro's pace). The «Вид» background runs it slower. */
  speed?: number;
  /** Frame cap (the «Вид» background is on screen all session long, so it redraws at ~15 fps; the drift is slow). */
  fps?: number;
  /** Seconds into the drift to start from (2.4+ skips the opening glow and starts fully spread). */
  startAt?: number;
  /** While true the loop draws nothing (the frame on screen stays). */
  paused?: () => boolean;
  /** Called on every drawn frame of this loop (the «Вид» smoke draws its cursor trail here: one loop for both). */
  onFrame?: (now: number) => void;
}

export function startSmoke(canvas: HTMLCanvasElement, opts: SmokeOptions): () => void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return () => {};
  const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
  const W = Math.max(24, Math.round(Math.sqrt(PIXELS * (vw / vh))));
  const H = Math.max(24, Math.round(PIXELS / W));
  canvas.width = W;
  canvas.height = H;
  const img = ctx.createImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  // Coordinates in units of the shorter side, centred, so the cloud stays round on a phone too.
  const unit = Math.min(W, H);
  const xs = new Float32Array(W), ys = new Float32Array(H);
  for (let i = 0; i < W; i++) xs[i] = (i - W / 2) / unit;
  for (let j = 0; j < H; j++) ys[j] = (j - H / 2) / unit;
  // Palette: 256 grey levels, ABGR (little-endian ImageData).
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const k = i / 255;
    const g = opts.light ? Math.round(245 - k * 105) : Math.round(k * 205);
    lut[i] = (255 << 24) | (g << 16) | (g << 8) | g;
  }

  const draw = (t: number) => {
    // The cloud starts as a glow behind the words and spreads to the whole screen over ~2 s.
    const grow = 1 - Math.pow(1 - Math.min(1, t / 2.4), 3);
    const radius = 0.3 + grow * 0.9;
    const core = 0.35 * (1 - grow * 0.6);
    const s = t * 0.22;
    let k = 0;
    for (let j = 0; j < H; j++) {
      const y = ys[j];
      for (let i = 0; i < W; i++) {
        const x = xs[i];
        const r = Math.sqrt(x * x + y * y);
        const env = 1 - smooth(radius * 0.25, radius, r);
        let level = core * Math.exp(-r * r * 9);
        if (env > 0.004) {
          const nx = x * 1.7, ny = y * 1.7;
          const qx = fbm2(nx + s * 0.6, ny - s * 0.45);
          const qy = fbm2(nx + 5.2 - s * 0.5, ny + 1.3 + s * 0.35);
          const f = fbm3(nx + 2.6 * qx + s * 0.25, ny + 2.6 * qy - s * 0.2);
          // Soft body plus a thin brighter rim where the field crosses one level: the wisps.
          const rim = 1 - smooth(0, 0.07, Math.abs(f - 0.6));
          level += (smooth(0.4, 0.8, f) * 0.6 + rim * 0.4) * env;
        }
        px[k++] = lut[Math.min(255, (level * 255) | 0)];
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  if (opts.still) {
    draw(1.6);
    return () => {};
  }

  let raf = 0;
  let stopped = false;
  let frame = 0;
  let cost = 0; // moving average of the draw time, ms
  let t0 = -1; // the first frame actually drawn (a busy first load must not skip the opening glow)
  let last = -Infinity;
  const speed = opts.speed ?? 1;
  const minGap = opts.fps ? 1000 / opts.fps : 0;
  const loop = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (now - last < minGap) return;
    // Paused (window not focused, …): keep the last frame on screen, do no work. The first frame always draws.
    if (frame > 0 && opts.paused?.()) return;
    last = now;
    frame++;
    if (t0 < 0) t0 = now;
    opts.onFrame?.(now);
    // Weak machine: redraw every other frame (30 Hz is plenty for a drift this slow; CSS keeps the rest at 60).
    if (cost > 8 && frame % 2) return;
    const a = performance.now();
    draw(((now - t0) / 1000) * speed + (opts.startAt ?? 0));
    const dt = performance.now() - a;
    cost = frame <= 2 ? 0 : cost ? cost * 0.8 + dt * 0.2 : dt;
  };
  raf = requestAnimationFrame(loop);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
