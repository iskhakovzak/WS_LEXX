/**
 * Smooth monotone curves for hand-drawn charts (SVG sparklines, the canvas equity engine). Monotone-x cubic
 * (Fritsch–Carlson, the same curve as d3 `curveMonotoneX` / recharts `type="monotone"`): it passes through every point
 * and never overshoots, so highs and lows stay true. No imports — safe to use from any layer.
 *
 *   <path d={smoothPath(points)} />            // SVG
 *   monotoneCurve(path2d, points)              // canvas Path2D / ctx (anything with moveTo / lineTo / bezierCurveTo)
 */

export type Pt = readonly [number, number];

export interface CurveSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
}

/** Draws the curve into `sink`, starting with a moveTo (`join` — continue the current path with a lineTo instead). */
export function monotoneCurve(sink: CurveSink, pts: readonly Pt[], join = false) {
  const n = pts.length;
  if (!n) return;
  if (join) sink.lineTo(pts[0][0], pts[0][1]);
  else sink.moveTo(pts[0][0], pts[0][1]);
  if (n < 3) {
    for (let k = 1; k < n; k++) sink.lineTo(pts[k][0], pts[k][1]);
    return;
  }
  const h = new Array<number>(n - 1);
  const d = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1][0] - pts[i][0];
    d[i] = h[i] ? (pts[i + 1][1] - pts[i][1]) / h[i] : 0;
  }
  const m = new Array<number>(n);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const p = (d[i - 1] * h[i] + d[i] * h[i - 1]) / (h[i - 1] + h[i] || 1);
    m[i] = (Math.sign(d[i - 1]) + Math.sign(d[i])) * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]), 0.5 * Math.abs(p));
  }
  const end = (i: number, t: number) => (h[i] ? (3 * d[i] - t) / 2 : t);
  m[0] = end(0, m[1]);
  m[n - 1] = end(n - 2, m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    const dx = h[i] / 3;
    sink.bezierCurveTo(pts[i][0] + dx, pts[i][1] + m[i] * dx, pts[i + 1][0] - dx, pts[i + 1][1] - m[i + 1] * dx, pts[i + 1][0], pts[i + 1][1]);
  }
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** SVG path data of the smooth curve through `pts` (x ascending). */
export function smoothPath(pts: readonly Pt[]): string {
  let d = "";
  monotoneCurve({
    moveTo: (x, y) => { d += `M${f(x)},${f(y)}`; },
    lineTo: (x, y) => { d += `L${f(x)},${f(y)}`; },
    bezierCurveTo: (a, b, c, e, x, y) => { d += `C${f(a)},${f(b)} ${f(c)},${f(e)} ${f(x)},${f(y)}`; },
  }, pts);
  return d;
}
