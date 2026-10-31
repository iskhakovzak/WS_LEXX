// The cloud's form: the WS_DeskOS "one line" mark (components/Mark.astro), turned into a 3D tube SDF. The SVG path
// is flattened to a polyline here and inlined into the shader as constants.
type P = [number, number];

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function cubic(p0: P, p1: P, p2: P, p3: P, n: number): P[] {
  const out: P[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
    out.push(lerp(lerp(a, b, t), lerp(b, c, t), t));
  }
  return out;
}

// M6.5 17 L15.5 46 L24.5 23.5 L33.5 46 C38 50.5 56 50 56.5 40.5 C57 31.5 40.5 34 40.5 25.5 C40.5 16.5 54.5 15.5 57.5 21
const path: P[] = [
  [6.5, 17], [15.5, 46], [24.5, 23.5], [33.5, 46],
  ...cubic([33.5, 46], [38, 50.5], [56, 50], [56.5, 40.5], 7),
  ...cubic([56.5, 40.5], [57, 31.5], [40.5, 34], [40.5, 25.5], 7),
  ...cubic([40.5, 25.5], [40.5, 16.5], [54.5, 15.5], [57.5, 21], 6),
];

/** Mark units -> shape space: centred, y up, about 1.0 wide. */
const SCALE = 1 / 51;
const CX = 32, CY = 32.75;
const pts = path.map(([x, y]) => [(x - CX) * SCALE, (CY - y) * SCALE] as P);
const f = (n: number) => n.toFixed(5);
const BEND = 0.35, LIFT = 0.04;

/** Tube radius in shape space: a little thinner than the logo stroke, so the cloud draws a crisp line. */
const RADIUS = 2.2 * SCALE;

const lengths = pts.slice(1).map((b, i) => Math.hypot(b[0] - pts[i][0], b[1] - pts[i][1]));
const total = lengths.reduce((s, l) => s + l, 0);

/** A random point on the tube surface (inverse of sdfShape), used as a particle's home. */
export function sampleSurface(): [number, number, number] {
  let r = Math.random() * total, i = 0;
  while (i < lengths.length - 1 && r > lengths[i]) r -= lengths[i++];
  const a = pts[i], b = pts[i + 1];
  const t = r / lengths[i];
  const dx = (b[0] - a[0]) / lengths[i], dy = (b[1] - a[1]) / lengths[i];
  const th = Math.random() * Math.PI * 2;
  const x = a[0] + (b[0] - a[0]) * t - dy * RADIUS * Math.cos(th);
  const y = a[1] + (b[1] - a[1]) * t + dx * RADIUS * Math.cos(th);
  return [x, y, RADIUS * Math.sin(th) + BEND * x * x - LIFT];
}

export const SDF_GLSL = /* glsl */ `
const int MARK_N = ${pts.length};
const vec2 MARK[${pts.length}] = vec2[${pts.length}](${pts.map(([x, y]) => `vec2(${f(x)}, ${f(y)})`).join(", ")});

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdfShape(vec3 p) {
  if (length(p) > 0.8) return length(p) - 0.7;
  // A gentle bend so the flat mark reads as a sculpted object when the camera drifts.
  p.z -= ${f(BEND)} * p.x * p.x - ${f(LIFT)};
  float d = 1e3;
  for (int i = 0; i < MARK_N - 1; i++) d = min(d, segDist(p.xy, MARK[i], MARK[i + 1]));
  return length(vec2(d, p.z)) - ${f(RADIUS)};
}

vec3 sdfNormal(vec3 p) {
  const float e = 0.001;
  const vec2 k = vec2(1.0, -1.0);
  return (k.xyy * sdfShape(p + k.xyy * e) + k.yyx * sdfShape(p + k.yyx * e)
        + k.yxy * sdfShape(p + k.yxy * e) + k.xxx * sdfShape(p + k.xxx * e)) / (4.0 * e);
}
`;
