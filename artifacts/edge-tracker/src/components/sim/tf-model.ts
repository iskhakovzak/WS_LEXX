/**
 * Simulator timeframes — pure client logic (no React, no DOM). Intraday games stream bars at a base timeframe
 * (`meta.baseTf`, 1m when the day has minute bars); the player watches any display timeframe the game allows
 * (`meta.displayTfs`), aggregated here from the base bars already revealed. The last display bar is therefore always
 * «forming»: it holds only the base bars up to the cursor, never a peek ahead. Old games (no baseTf / displayTfs) fall
 * back to their own tf. The daily candle of the play day is built the same way from the bars seen.
 */
import type { Candle } from "@/components/chart-engine";
import { fakeClock } from "./model";

export type DisplayTf = "1m" | "2m" | "5m" | "10m" | "15m" | "30m";
export const TF_MINUTES: Record<DisplayTf, number> = { "1m": 1, "2m": 2, "5m": 5, "10m": 10, "15m": 15, "30m": 30 };
export const isDisplayTf = (v: unknown): v is DisplayTf => typeof v === "string" && Object.prototype.hasOwnProperty.call(TF_MINUTES, v);

/** What the player may switch to when the server does not say (old games, or a server without displayTfs). */
const DEFAULT_DISPLAY: Record<string, DisplayTf[]> = {
  "1m": ["1m", "2m", "5m", "15m"],
  "2m": ["2m", "10m", "30m"],
  "5m": ["5m", "15m", "30m"],
};

type TfMeta = { mode: string; tf: string; baseTf?: string | null; displayTfs?: readonly string[] | null };

/** The timeframe of the bars on the wire: `baseTf`, else the game tf (old games). */
export function baseTfOf(meta: TfMeta): string {
  return meta.baseTf ?? meta.tf;
}

/** Minutes of a tf string ("1m" → 1); null for daily / unknown. */
export function tfMinutes(tf: string): number | null {
  return isDisplayTf(tf) ? TF_MINUTES[tf] : null;
}

/**
 * Display timeframes of a game in switcher order: the server's list (unknown values and ones that are not a whole
 * multiple of the base dropped), else the defaults for the base. Swing games and unknown bases: none (no switcher).
 */
export function displayTfsOf(meta: TfMeta): DisplayTf[] {
  if (meta.mode !== "intraday") return [];
  const base = tfMinutes(baseTfOf(meta));
  if (base == null) return [];
  const raw = meta.displayTfs && meta.displayTfs.length ? meta.displayTfs : DEFAULT_DISPLAY[baseTfOf(meta)] ?? [];
  const out: DisplayTf[] = [];
  for (const v of raw) {
    if (!isDisplayTf(v) || out.includes(v)) continue;
    const m = TF_MINUTES[v];
    if (m >= base && m % base === 0) out.push(v);
  }
  return out;
}

/** The display tf to use: the player's choice when this game allows it, else the game's default tf, else the base. */
export function pickDisplayTf(tfs: readonly DisplayTf[], preferred: unknown, meta: TfMeta): DisplayTf | null {
  if (!tfs.length) return null;
  if (isDisplayTf(preferred) && tfs.includes(preferred)) return preferred;
  if (isDisplayTf(meta.tf) && tfs.includes(meta.tf)) return meta.tf;
  return tfs[0];
}

export type Aggregated = {
  bars: Candle[];
  /** Base index → display index. */
  map: number[];
  /** Display index → its first base index. */
  first: number[];
};

/**
 * Base bars → display bars. Buckets are aligned to the clock (a 5m bar starts at :00, :05 …; the session opens at
 * 9:30 so every bucket lines up with it), consecutive base bars in the same bucket merge, a gap starts a new bucket.
 * A display tf not above the base is the identity (same bar objects).
 */
export function aggregate(base: readonly Candle[], baseMin: number, dispMin: number): Aggregated {
  if (!(dispMin > baseMin)) return { bars: base.slice(), map: base.map((_, i) => i), first: base.map((_, i) => i) };
  const sec = dispMin * 60;
  const bars: Candle[] = [];
  const map: number[] = new Array(base.length);
  const first: number[] = [];
  let key = Number.NaN;
  for (let i = 0; i < base.length; i++) {
    const b = base[i];
    const k = Math.floor(b.t / sec);
    if (k !== key) {
      key = k;
      bars.push({ t: k * sec, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      first.push(i);
    } else {
      const d = bars[bars.length - 1];
      if (b.h > d.h) d.h = b.h;
      if (b.l < d.l) d.l = b.l;
      d.c = b.c;
      d.v += b.v;
    }
    map[i] = bars.length - 1;
  }
  return { bars, map, first };
}

/** Display index of a base index (clamped to the bars there are). */
export function toDisplayIdx(agg: Pick<Aggregated, "map">, baseIdx: number): number {
  const n = agg.map.length;
  if (!n) return baseIdx;
  const i = Math.max(0, Math.min(n - 1, Math.floor(baseIdx)));
  return agg.map[i];
}

/** Last base index inside display bar `j`. */
export function lastBaseOf(agg: Pick<Aggregated, "first" | "map">, j: number): number {
  return j + 1 < agg.first.length ? agg.first[j + 1] - 1 : agg.map.length - 1;
}

/**
 * Axis time of display bar `j`: the fake bucket start before the reveal; after it the real time of the bucket start
 * (the real time of its first base bar shifted back by the same offset inside the bucket).
 */
export function displayTime(agg: Aggregated, j: number, base: readonly Candle[], realTimes: readonly number[] | null): number {
  const d = agg.bars[j];
  if (!realTimes) return d.t;
  const f = agg.first[j];
  const real = realTimes[f];
  return real == null ? d.t : real - (base[f].t - d.t);
}

/**
 * How far the forming (last) display bar is, by the clock: minutes of the bucket covered by the bars seen (a thin
 * premarket with missing minutes still reads «5 of 5» at the bucket's last minute). Null when the display tf is the
 * base.
 */
export function formingInfo(base: readonly Candle[], baseMin: number, dispMin: number): { have: number; need: number } | null {
  if (!(dispMin > baseMin) || !base.length) return null;
  const sec = dispMin * 60;
  const need = Math.round(dispMin / baseMin);
  const last = base[base.length - 1].t;
  const start = Math.floor(last / sec) * sec;
  const have = Math.floor((last - start) / (baseMin * 60)) + 1;
  return { have: Math.max(1, Math.min(have, need)), need };
}

/** Base bars that «→» asks for: to the close of the forming display bar, or a whole one when it is complete. */
export function stepToClose(info: { have: number; need: number } | null): number {
  if (!info) return 1;
  return info.have >= info.need ? info.need : info.need - info.have;
}

const RTH_OPEN = 570;
const RTH_CLOSE = 960;

/** Regular-session bars of the play day seen so far (fake intraday clock: day ≥ 0, 9:30–16:00 New York). */
function playDayRth(base: readonly Candle[]): Candle[] {
  return base.filter((b) => {
    const c = fakeClock(b.t);
    return c.day >= 0 && c.min >= RTH_OPEN && c.min < RTH_CLOSE;
  });
}

/** Today's daily candle from the bars seen (regular session only); null before the open. */
export function todayCandle(base: readonly Candle[]): Candle | null {
  const rth = playDayRth(base);
  if (!rth.length) return null;
  let h = -Infinity, l = Infinity, v = 0;
  for (const b of rth) { if (b.h > h) h = b.h; if (b.l < l) l = b.l; v += b.v; }
  return { t: rth[0].t, o: rth[0].o, h, l, c: rth[rth.length - 1].c, v };
}

/** High / low of the play day's session so far (levels for the automatic stop); null before the open. */
export function dayHiLo(base: readonly Candle[]): { hod: number; lod: number } | null {
  const c = todayCandle(base);
  return c ? { hod: c.h, lod: c.l } : null;
}
