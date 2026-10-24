/**
 * «Наложение входов» of the lab (/chart-lab): every entry of a setup or ticker aligned at its entry minute, the move
 * after it side-adjusted (in % of the entry price, or in R when the stop distance is known), the average path and the
 * quantile clouds of the running MAE / MFE — «куда обычно идёт сетап после входа». Pure, no I/O.
 *
 * Minute k after the entry = the last price known at entry + k minutes: the close of the last bar that had ENDED by
 * then (k = 0: the entry price itself) — never the close of a bar still open at that moment, which would be a later
 * price (an hourly bar would put the 14:59 close at «+5 min»). MFE_k / MAE_k = the best / worst side-adjusted high / low
 * over the bars after the entry minute that had ended by minute k. A trade whose bars stop early (a missing archive tail) leaves the statistics of
 * the later minutes (n per minute is reported), never padded.
 */
import { quantileSorted } from "../whatIfTypes";
import type { LabBar } from "./exitMath";

/** Days archived only in bars coarser than this are left out (an hourly bar says nothing about minute 5). */
export const MAX_BAR_SEC = 300;
export const PRE_MIN = 10;
export const POST_MIN = 60;

export interface OverlayTrade {
  id: number;
  side: 1 | -1;
  entry: number;
  entryAt: number;
  riskPerShare: number | null;
  /** Real result in the same unit (for colouring the path); null = unknown. */
  result: number | null;
}

export type OverlayUnit = "pct" | "r";

export interface OverlayPath {
  id: number;
  /** Values for minutes −PRE_MIN … POST_MIN (null = no bar). */
  values: (number | null)[];
  win: boolean | null;
}

export interface OverlayResult {
  unit: OverlayUnit;
  minutes: number[];
  paths: OverlayPath[];
  mean: (number | null)[];
  p25: (number | null)[];
  p75: (number | null)[];
  p10: (number | null)[];
  p90: (number | null)[];
  /** Running MFE / MAE quantiles (median and the 25–75 band). */
  mfe: { p25: (number | null)[]; p50: (number | null)[]; p75: (number | null)[] };
  mae: { p25: (number | null)[]; p50: (number | null)[]; p75: (number | null)[] };
  n: number[];
  /** Trades without bars for their day, or without a stop distance in R mode. */
  missing: number;
  /** Trades whose day is archived only in bars coarser than MAX_BAR_SEC (left out). */
  coarse: number;
  /** Trades drawn (the paths list may be capped). */
  trades: number;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * The last price KNOWN at unix second `at`: the close of the last bar that had already ended by then (end ≤ at), and
 * only when it ended within the last bar (end > at − barSec: a missing bar is never replaced by an older one) and after
 * `after` (end > after). Never a bar still open at `at` — its close lies in the future of that moment.
 */
export function closeAt(bars: LabBar[], barSec: number, at: number, after = -Infinity): number | null {
  let lo = 0, hi = bars.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t + barSec <= at) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (hit < 0) return null;
  const end = bars[hit].t + barSec;
  return end > at - barSec && end > after ? bars[hit].c : null;
}

/** One trade's path and running excursions in `unit`; null when the unit cannot be computed (R without a stop). */
export function tradePath(t: OverlayTrade, bars: LabBar[], barSec: number, unit: OverlayUnit): { values: (number | null)[]; mfe: (number | null)[]; mae: (number | null)[] } | null {
  const scale = unit === "r" ? t.riskPerShare : t.entry / 100;
  if (scale == null || !(scale > 0)) return null;
  const conv = (px: number) => r4((t.side * (px - t.entry)) / scale);
  const values: (number | null)[] = [], mfe: (number | null)[] = [], mae: (number | null)[] = [];
  let best = 0, worst = 0, k0 = -1, anySeen = false;
  const entryMinute = Math.floor(t.entryAt / 60) * 60;
  for (let k = -PRE_MIN; k <= POST_MIN; k++) {
    if (k === 0) { values.push(0); mfe.push(0); mae.push(0); continue; }
    // After the entry only a bar that closed after the fill counts (its close is a price the trade lived through).
    const px = closeAt(bars, barSec, t.entryAt + k * 60, k > 0 ? t.entryAt : -Infinity);
    values.push(px == null ? null : conv(px));
    if (k < 0) { mfe.push(null); mae.push(null); continue; }
    // Excursions over the bars that start after the entry minute and had ENDED by entry + k minutes.
    let seen = false;
    for (let i = k0 < 0 ? 0 : k0; i < bars.length && bars[i].t + barSec <= t.entryAt + k * 60; i++) {
      if (bars[i].t < entryMinute + 60) continue;
      k0 = i + 1;
      seen = true;
      anySeen = true;
      const hi = conv(t.side > 0 ? bars[i].h : bars[i].l), lo = conv(t.side > 0 ? bars[i].l : bars[i].h);
      if (hi > best) best = hi;
      if (lo < worst) worst = lo;
    }
    // Until a whole bar after the entry minute has ended, the excursion is unknown (not 0).
    const alive = anySeen && (px != null || seen);
    mfe.push(alive ? best : null);
    mae.push(alive ? worst : null);
  }
  return { values, mfe, mae };
}

function quant(cols: number[][], q: number): (number | null)[] {
  return cols.map((c) => (c.length ? r4(quantileSorted([...c].sort((a, b) => a - b), q)) : null));
}

/** The overlay of a group of trades; `maxPaths` caps the drawn paths (the statistics use every trade). */
export function overlayOf(items: { trade: OverlayTrade; bars: LabBar[] | null; barSec: number }[], unit: OverlayUnit, maxPaths = 80): OverlayResult {
  const minutes = Array.from({ length: PRE_MIN + POST_MIN + 1 }, (_, i) => i - PRE_MIN);
  const cols: number[][] = minutes.map(() => []), mfeCols: number[][] = minutes.map(() => []), maeCols: number[][] = minutes.map(() => []);
  const paths: OverlayPath[] = [];
  let missing = 0, coarse = 0;
  for (const it of items) {
    if (it.bars && it.bars.length && it.barSec > MAX_BAR_SEC) { coarse++; continue; }
    const p = it.bars && it.bars.length ? tradePath(it.trade, it.bars, it.barSec, unit) : null;
    if (!p) { missing++; continue; }
    p.values.forEach((v, i) => { if (v != null) cols[i].push(v); });
    p.mfe.forEach((v, i) => { if (v != null) mfeCols[i].push(v); });
    p.mae.forEach((v, i) => { if (v != null) maeCols[i].push(v); });
    if (paths.length < maxPaths) paths.push({ id: it.trade.id, values: p.values, win: it.trade.result == null ? null : it.trade.result > 0 });
  }
  const mean = cols.map((c) => (c.length ? r4(c.reduce((s, v) => s + v, 0) / c.length) : null));
  return {
    unit, minutes, paths, mean,
    p25: quant(cols, 0.25), p75: quant(cols, 0.75), p10: quant(cols, 0.1), p90: quant(cols, 0.9),
    mfe: { p25: quant(mfeCols, 0.25), p50: quant(mfeCols, 0.5), p75: quant(mfeCols, 0.75) },
    mae: { p25: quant(maeCols, 0.25), p50: quant(maeCols, 0.5), p75: quant(maeCols, 0.75) },
    n: cols.map((c) => c.length), missing, coarse, trades: items.length - missing - coarse,
  };
}
