/**
 * The price line of an image card (pure, unit-tested in components/trades/share-card/model.test.ts):
 *   cardSeries     the bars around the trade (padding grows with the hold), downsampled, entry / exit marked
 *   fallbackSeries no bars: a clean line from the entry price to the exit price
 *   chartPoints    screen points inside a rectangle
 *   pillBox        where an Entry / Exit pill sits for a point
 */
import type { Pt, Rect } from "./canvas";

export type BarLite = { t: number; c: number };

export interface CardSeries {
  closes: number[];
  /** Index into `closes` of the first entry fill / the last exit fill (null = unknown). */
  entryIdx: number | null;
  exitIdx: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  min: number;
  max: number;
  /** True for the plain entry → exit line drawn when the day has no bars. */
  synthetic: boolean;
}

/** Last bar with t ≤ time (−1 when time is before every bar). */
function barAt(bars: readonly BarLite[], time: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.t <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * The price path around the trade: the bars from a little before the entry to a little after the exit (padding grows
 * with the hold, 15…90 bars), downsampled to at most `maxPoints` closes. Entry / exit land on the sampled point
 * nearest to their bar. Null without usable bars or without an entry time inside them.
 */
export function cardSeries(
  bars: readonly BarLite[], entryTime: number | null, exitTime: number | null,
  entryPrice: number | null, exitPrice: number | null, maxPoints = 240,
): CardSeries | null {
  const clean = bars.filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c));
  if (clean.length < 2 || entryTime == null || !Number.isFinite(entryTime)) return null;
  const e = barAt(clean, entryTime);
  if (e < 0 || entryTime > clean[clean.length - 1]!.t + 86_400) return null;
  const x = exitTime != null && Number.isFinite(exitTime) ? Math.max(e, barAt(clean, exitTime)) : null;
  const span = (x ?? e) - e;
  const pad = Math.max(15, Math.min(90, Math.round(span * 0.6)));
  const from = Math.max(0, e - pad);
  const to = Math.min(clean.length - 1, (x ?? e) + pad);
  const count = to - from + 1;
  const n = Math.max(2, Math.min(maxPoints, count));
  const src: number[] = [];
  for (let k = 0; k < n; k++) src.push(Math.min(to, from + Math.round((k * (count - 1)) / (n - 1))));
  const nearest = (idx: number) => {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < src.length; k++) { const d = Math.abs(src[k]! - idx); if (d < bestD) { bestD = d; best = k; } }
    return best;
  };
  const closes = src.map((i) => clean[i]!.c);
  const entryIdx = nearest(e);
  const exitIdx = x != null ? Math.max(entryIdx, nearest(x)) : null;
  return withRange({ closes, entryIdx, exitIdx, entryPrice: entryPrice ?? closes[entryIdx]!, exitPrice: exitPrice ?? (exitIdx != null ? closes[exitIdx]! : null), synthetic: false });
}

/** No bars: a clean line from the entry price to the exit price (null without both prices). */
export function fallbackSeries(entryPrice: number | null, exitPrice: number | null): CardSeries | null {
  if (entryPrice == null || exitPrice == null || !Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) return null;
  const n = 24;
  const closes = Array.from({ length: n }, (_, k) => {
    const f = k <= 3 ? 0 : k >= n - 4 ? 1 : (k - 3) / (n - 7);
    return entryPrice + (exitPrice - entryPrice) * f;
  });
  return withRange({ closes, entryIdx: 3, exitIdx: n - 4, entryPrice, exitPrice, synthetic: true });
}

function withRange(s: Omit<CardSeries, "min" | "max">): CardSeries {
  let min = Infinity, max = -Infinity;
  for (const c of s.closes) { if (c < min) min = c; if (c > max) max = c; }
  for (const p of [s.entryPrice, s.exitPrice]) if (p != null && Number.isFinite(p)) { if (p < min) min = p; if (p > max) max = p; }
  return { ...s, min, max };
}

/** Screen points of the line inside `rect`; a flat series sits in the middle. */
export function chartPoints(s: CardSeries, r: Rect): { line: Pt[]; entry: Pt | null; exit: Pt | null } {
  const n = s.closes.length;
  const span = s.max - s.min;
  const y = (p: number) => (span > 0 ? r.y + (1 - (p - s.min) / span) * r.h : r.y + r.h / 2);
  const x = (i: number) => r.x + (n > 1 ? (i / (n - 1)) * r.w : r.w / 2);
  const line = s.closes.map((c, i) => ({ x: x(i), y: y(c) }));
  const at = (i: number | null, p: number | null): Pt | null => (i == null ? null : { x: x(i), y: y(p != null && Number.isFinite(p) ? p : s.closes[i]!) });
  return { line, entry: at(s.entryIdx, s.entryPrice), exit: at(s.exitIdx, s.exitPrice) };
}

/**
 * Where a pill (w × h) sits for a point: above it by default, below when there is no room above, kept inside `bounds`
 * horizontally; `avoid` (the other pill) pushes it to the other side when the two would overlap.
 */
export function pillBox(p: Pt, w: number, h: number, bounds: Rect, avoid?: Rect | null, gap = 18): Rect {
  const clampX = (x: number) => Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, x));
  const above = { x: clampX(p.x - w / 2), y: p.y - gap - h, w, h };
  const below = { x: clampX(p.x - w / 2), y: p.y + gap, w, h };
  const fitsAbove = above.y >= bounds.y;
  const fitsBelow = below.y + h <= bounds.y + bounds.h;
  const hits = (a: Rect) => !!avoid && a.x < avoid.x + avoid.w && avoid.x < a.x + a.w && a.y < avoid.y + avoid.h && avoid.y < a.y + a.h;
  if (fitsAbove && !hits(above)) return above;
  if (fitsBelow && !hits(below)) return below;
  return fitsAbove ? above : below;
}
