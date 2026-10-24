/**
 * «Рынок и мой edge» — market context of a trade from data the app already stores (no provider calls). Pure.
 *
 * Index day (SPY / QQQ), from daily bars (analyst_bars_cache) or regular-hours bars of the intraday caches:
 *   gap      open vs the previous close: up ≥ +GAP_FLAT_PCT %, down ≤ −GAP_FLAT_PCT %, else flat      (known at the open)
 *   trend    body |close − open| ≥ TREND_BODY of the day's range and a range ≥ TREND_MIN_ATR × ATR20 ⇒ trendUp /
 *            trendDown, else range                                                                     (known at the close)
 *   vol      true range ÷ ATR20 of the previous days: high ≥ VOL_HIGH, low ≤ VOL_LOW, else normal       (known at the close)
 *   prevVol  the previous session's vol                                                               (known before the open)
 * ATR20 needs ATR_MIN previous days; a previous day further than PREV_MAX_GAP_DAYS back is not «previous».
 *
 * Ticker day, from its daily bars (prev close also from candle_archive.prev_close):
 *   tkGap    gap % in bands dn5 | dn1 | flat | up1 | up5 | up15                                       (known at the open)
 *   tkRvol   day volume ÷ mean of the previous 20 days: low | normal | high | extreme                 (known at the close)
 *   tkAtr    ATR14 of the previous days in % of the previous close: calm | normal | wild | extreme    (known before the open)
 *   earnings report within ±1 business day of the entry (Finviz calendar); before its coverage → nodata
 *   analyst  the day's analyst action: up | down | other | none; a ticker never fetched → nodata
 *   sector / theme   Finviz sector of the ticker; the first desk market theme that lists it (none)
 * Missing data is the bucket «nodata» (coverage shown), never a guess.
 */

import { parseDateStrict, rthBounds } from "../candleDay";

export const NODATA = "nodata";
export const GAP_FLAT_PCT = 0.3;
export const TREND_BODY = 0.6;
export const TREND_MIN_ATR = 0.7;
export const VOL_HIGH = 1.25;
export const VOL_LOW = 0.75;
export const ATR_DAYS = 20;
export const ATR_MIN = 10;
export const PREV_MAX_GAP_DAYS = 5;

export type MeDailyBar = { day: string; o: number; h: number; l: number; c: number; v: number; prevClose?: number | null };
export type MeIntradayBar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type IndexTrend = "trendUp" | "trendDown" | "range";
export type IndexGap = "up" | "down" | "flat";
export type IndexVol = "high" | "normal" | "low";
export type IndexDay = {
  day: string;
  gapPct: number | null;
  gap: IndexGap | null;
  trend: IndexTrend | null;
  vol: IndexVol | null;
  prevVol: IndexVol | null;
  rangeAtr: number | null;
};

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Date.parse(`${d}T12:00:00Z`) / DAY_MS;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** One daily bar from intraday bars: regular hours (09:30–16:00 NY) only; null without such a bar. */
export function dailyFromIntraday(day: string, bars: readonly MeIntradayBar[], prevClose: number | null = null): MeDailyBar | null {
  if (!parseDateStrict(day)) return null;
  const { open, close } = rthBounds(day);
  const rth = bars.filter((b) => b.t >= open && b.t < close && Number.isFinite(b.o) && Number.isFinite(b.c) && b.h >= b.l).sort((a, b) => a.t - b.t);
  if (!rth.length) return null;
  return {
    day,
    o: rth[0]!.o,
    c: rth[rth.length - 1]!.c,
    h: Math.max(...rth.map((b) => b.h)),
    l: Math.min(...rth.map((b) => b.l)),
    v: rth.reduce((s, b) => s + (b.v || 0), 0),
    prevClose,
  };
}

/** The previous close of bar i: the previous bar when it is recent enough, else the bar's own prevClose. */
function prevCloseOf(bars: readonly MeDailyBar[], i: number): number | null {
  const prev = bars[i - 1];
  if (prev && dayNum(bars[i]!.day) - dayNum(prev.day) <= PREV_MAX_GAP_DAYS) return prev.c;
  const own = bars[i]!.prevClose;
  return own != null && own > 0 ? own : null;
}

function trueRange(bar: MeDailyBar, prevC: number | null): number {
  const hl = bar.h - bar.l;
  return prevC == null ? hl : Math.max(hl, Math.abs(bar.h - prevC), Math.abs(bar.l - prevC));
}

/** Mean true range of up to `n` bars before i that are within 2·n calendar days; null below `min`. */
function atrBefore(bars: readonly MeDailyBar[], i: number, n: number, min: number): number | null {
  const lim = dayNum(bars[i]!.day) - 2 * n;
  const trs: number[] = [];
  for (let k = i - 1; k >= 0 && trs.length < n; k--) {
    if (dayNum(bars[k]!.day) < lim) break;
    trs.push(trueRange(bars[k]!, prevCloseOf(bars, k)));
  }
  return trs.length >= min ? trs.reduce((s, v) => s + v, 0) / trs.length : null;
}

export function gapKeyOf(gapPct: number | null): IndexGap | null {
  if (gapPct == null) return null;
  return gapPct >= GAP_FLAT_PCT ? "up" : gapPct <= -GAP_FLAT_PCT ? "down" : "flat";
}

export function volKeyOf(rangeAtr: number | null): IndexVol | null {
  if (rangeAtr == null) return null;
  return rangeAtr >= VOL_HIGH ? "high" : rangeAtr <= VOL_LOW ? "low" : "normal";
}

/** Regime of every index day (bars ascending by day, one per day). */
export function classifyIndexDays(input: readonly MeDailyBar[]): Map<string, IndexDay> {
  const bars = [...input].sort((a, b) => (a.day < b.day ? -1 : 1));
  const out = new Map<string, IndexDay>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const prevC = prevCloseOf(bars, i);
    const gapPct = prevC ? r3(((b.o - prevC) / prevC) * 100) : null;
    const atr = atrBefore(bars, i, ATR_DAYS, ATR_MIN);
    const tr = trueRange(b, prevC);
    const rangeAtr = atr && atr > 0 ? r3(tr / atr) : null;
    const range = b.h - b.l;
    let trend: IndexTrend | null = null;
    if (range > 0) {
      const strong = Math.abs(b.c - b.o) / range >= TREND_BODY && (rangeAtr == null || rangeAtr >= TREND_MIN_ATR);
      trend = strong ? (b.c > b.o ? "trendUp" : "trendDown") : "range";
    }
    const prev = bars[i - 1];
    const prevDay = prev && dayNum(b.day) - dayNum(prev.day) <= PREV_MAX_GAP_DAYS ? out.get(prev.day) : undefined;
    out.set(b.day, { day: b.day, gapPct, gap: gapKeyOf(gapPct), trend, vol: volKeyOf(rangeAtr), prevVol: prevDay?.vol ?? null, rangeAtr });
  }
  return out;
}

export type TickerDay = { gapPct: number | null; rvol: number | null; atrPct: number | null };

/** Gap, relative volume and prior ATR % of a ticker on `day` from its daily bars (ascending); null without the day. */
export function tickerDayContext(input: readonly MeDailyBar[], day: string): TickerDay | null {
  const i = input.findIndex((b) => b.day === day);
  if (i < 0) return null;
  const b = input[i]!;
  const prevC = prevCloseOf(input, i);
  const gapPct = prevC ? r3(((b.o - prevC) / prevC) * 100) : null;
  const lim = dayNum(day) - 40;
  const vols: number[] = [];
  for (let k = i - 1; k >= 0 && vols.length < 20; k--) {
    if (dayNum(input[k]!.day) < lim) break;
    if (input[k]!.v > 0) vols.push(input[k]!.v);
  }
  const avgV = vols.length >= 5 ? vols.reduce((s, v) => s + v, 0) / vols.length : null;
  const atr = atrBefore(input, i, 14, 5);
  return {
    gapPct,
    rvol: avgV && b.v > 0 ? r3(b.v / avgV) : null,
    atrPct: atr && prevC ? r3((atr / prevC) * 100) : null,
  };
}

export function tkGapKeyOf(gapPct: number | null): string {
  if (gapPct == null) return NODATA;
  if (gapPct <= -5) return "dn5";
  if (gapPct <= -1) return "dn1";
  if (gapPct < 1) return "flat";
  if (gapPct < 5) return "up1";
  if (gapPct < 15) return "up5";
  return "up15";
}

export function tkRvolKeyOf(rvol: number | null): string {
  if (rvol == null) return NODATA;
  return rvol < 0.8 ? "low" : rvol < 1.5 ? "normal" : rvol < 3 ? "high" : "extreme";
}

export function tkAtrKeyOf(atrPct: number | null): string {
  if (atrPct == null) return NODATA;
  return atrPct < 2 ? "calm" : atrPct < 5 ? "normal" : atrPct < 10 ? "wild" : "extreme";
}

/** Business days between two YYYY-MM-DD days (absolute; weekends skipped). */
export function businessDaysApart(a: string, b: string): number {
  const hi = Math.max(dayNum(a), dayNum(b));
  let x = Math.min(dayNum(a), dayNum(b));
  let n = 0;
  while (x < hi) {
    x += 1;
    const dow = new Date(x * DAY_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** near | far | nodata: a report within ±1 business day; `coveredFrom` = the first day of the calendar's data. */
export function earningsKeyOf(day: string, reportDays: readonly string[] | undefined, coveredFrom: string | null): string {
  if (!coveredFrom || day < coveredFrom) return NODATA;
  return (reportDays ?? []).some((d) => businessDaysApart(d, day) <= 1) ? "near" : "far";
}

/** up | down | other | none | nodata — the analyst action(s) of the ticker on that NY day (downgrade wins a tie). */
export function analystKeyOf(day: string, actions: ReadonlyMap<string, readonly string[]> | undefined): string {
  if (!actions) return NODATA;
  const list = actions.get(day);
  if (!list?.length) return "none";
  if (list.includes("down")) return "down";
  if (list.includes("up")) return "up";
  return "other";
}

export const MARKET_DIMS = ["spyTrend", "spyGap", "spyVol", "spyPrevVol", "qqqTrend", "qqqGap", "tkGap", "tkAtr", "tkRvol", "earnings", "analyst", "sector", "theme"] as const;
export type MarketDim = (typeof MARKET_DIMS)[number];
/** Known only at the close of the day (an honest «по итогам дня» label; never an entry rule). */
export const MARKET_EOD_DIMS: ReadonlySet<string> = new Set(["spyTrend", "spyVol", "qqqTrend", "tkRvol"]);
