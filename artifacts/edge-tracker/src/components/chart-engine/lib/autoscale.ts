/**
 * Price-scale range that ignores bad prints (MAKSIM-19): a single tick far away from the market (an after-hours spike
 * to $615 on a $700 stock) used to stretch the scale, so the real candles took a third of the pane. Pure.
 *
 *   1. A wick longer than WICK_K typical bar ranges is cut back to its body.
 *   2. A bar whose (cut) high / low sits further than BAND_K robust deviations (MAD of closes, floored by the typical
 *      bar range) from the median close is left out of the range.
 * The bars themselves are drawn untouched; only the autoscale ignores the outliers.
 */
import type { Candle } from "../types";

const WICK_K = 15;
const BAND_K = 12;
/** Fewer bars than this in view: no statistics, the plain min / max. */
const MIN_BARS = 8;

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Min / max price of bars[from..to] without bad prints; null when there are no bars. */
export function robustPriceRange(bars: readonly Candle[], from: number, to: number): { min: number; max: number } | null {
  const a = Math.max(0, Math.floor(from)), b = Math.min(bars.length - 1, Math.ceil(to));
  if (b < a) return null;
  const view = bars.slice(a, b + 1).filter((x) => Number.isFinite(x.h) && Number.isFinite(x.l));
  if (!view.length) return null;
  if (view.length < MIN_BARS) {
    let lo = Infinity, hi = -Infinity;
    for (const x of view) { lo = Math.min(lo, x.l); hi = Math.max(hi, x.h); }
    return { min: lo, max: hi };
  }
  const closes = view.map((x) => x.c);
  const mid = median(closes);
  const typical = Math.max(median(view.map((x) => x.h - x.l)), Math.abs(mid) * 1e-4, 1e-9);
  const mad = median(closes.map((c) => Math.abs(c - mid)));
  const band = BAND_K * Math.max(mad, typical);
  let lo = Infinity, hi = -Infinity;
  for (const x of view) {
    const top = Math.max(x.o, x.c), bottom = Math.min(x.o, x.c);
    const h = x.h - top > WICK_K * typical ? top : x.h;
    const l = bottom - x.l > WICK_K * typical ? bottom : x.l;
    if (h > mid + band || l < mid - band) continue;
    lo = Math.min(lo, l);
    hi = Math.max(hi, h);
  }
  if (!Number.isFinite(lo)) {
    // Everything looked like an outlier (a gap day): fall back to the plain range.
    for (const x of view) { lo = Math.min(lo, x.l); hi = Math.max(hi, x.h); }
  }
  return { min: lo, max: hi };
}
