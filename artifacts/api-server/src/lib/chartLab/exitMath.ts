/**
 * «Где лучше выходить» — exit analysis of the lab (/chart-lab): per trade, what it would have made had it exited at a
 * fixed R multiple, after a fixed time, or at the first VWAP touch — then aggregated per setup with honest statistics.
 * Pure, no I/O, no clock, seeded randomness.
 *
 * No look-ahead beyond the bars that existed:
 *   - only bars that START at or after the minute following the entry are walked (the entry bar itself mixes moments
 *     before and after the fill);
 *   - an R bracket (target +kR, stop −1R on the recorded stop distance) checks the bar's low / high; when one bar
 *     touches both, the STOP counts (we cannot know the order inside a bar — the conservative choice);
 *   - VWAP is cumulative from the day's first bar and the touch test of bar i uses VWAP through bar i − 1 (what was on
 *     the screen when bar i opened); the exit price is that VWAP;
 *   - a time stop exits at the last price known at that moment (the close of the last bar that had ended by then);
 *   - a variant still open at the regular close exits at the close of the last regular-session bar of the day; when the
 *     archive's bars stop before the variant resolves (a missing tail), the variant is UNKNOWN for that trade and the
 *     trade leaves that variant's statistics (never filled in).
 * Result per variant = side · (exit − entry) · qty, gross; fees are the trade's own in every variant, so the difference
 * against the actual exit is a pure price difference.
 * Statistics per setup and variant: n, mean Δ vs the actual exit ($ per trade), a paired bootstrap 95% interval of the
 * mean, a Gaussian p from the bootstrap se and Benjamini–Hochberg q over the variants of that setup. «Лучше» needs
 * n ≥ MIN_N, the interval above zero and q < Q_MAX; «хуже» the mirror; else «не отличить».
 */
import { mulberry32, quantileSorted } from "../whatIfTypes";
import { bhQ, normalTail } from "../whatIfStepdown";

export interface LabBar { t: number; o: number; h: number; l: number; c: number; v: number }

export interface ExitTrade {
  id: number;
  setup: string | null;
  side: 1 | -1;
  qty: number;
  /** Average entry price. */
  entry: number;
  /** First entry fill, unix seconds. */
  entryAt: number;
  /** Average exit price of the real trade; null = unknown (then no Δ). */
  exit: number | null;
  /** Stop distance per share (|entry − stop|, or risk $ / qty); null = no R variants. */
  riskPerShare: number | null;
}

export type ExitVariant = "actual" | `r${string}` | `t${number}` | "vwap";

export const R_TARGETS = [1, 1.5, 2, 3] as const;
export const TIME_STOPS_MIN = [5, 15, 30, 60] as const;
export const MIN_N = 20;
export const Q_MAX = 0.1;

export const VARIANTS: ExitVariant[] = ["actual", ...R_TARGETS.map((k) => `r${k}` as ExitVariant), ...TIME_STOPS_MIN.map((m) => `t${m}` as ExitVariant), "vwap"];

/** Seconds since NY midnight → used only through `sessionEnd` (the caller passes the day's regular close in unix s). */
export interface DayBars {
  bars: LabBar[];
  /** Bar size, seconds. */
  barSec: number;
  /** Unix seconds of the regular close (16:00 NY) of the trade day. */
  closeAt: number;
}

export interface TradeExits {
  id: number;
  setup: string | null;
  /** Per-share result of each variant (side-adjusted); null = unknown / not applicable. */
  perShare: Record<ExitVariant, number | null>;
  qty: number;
  riskPerShare: number | null;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Index of the first bar starting at or after `t`. */
function firstAtOrAfter(bars: LabBar[], t: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** The last regular-session bar (starting before the close) at or after `from`; −1 when there is none. */
function lastRegular(bars: LabBar[], from: number, closeAt: number): number {
  let k = -1;
  for (let i = from; i < bars.length && bars[i].t < closeAt; i++) k = i;
  return k;
}

/**
 * The archive covers the day up to the close when its last bar reaches the final minute(s) before 16:00
 * (within one bar). A shorter archive = a missing tail: unresolved variants are unknown.
 */
function coversClose(bars: LabBar[], barSec: number, closeAt: number): boolean {
  const k = lastRegular(bars, 0, closeAt);
  return k >= 0 && bars[k].t + barSec >= closeAt;
}

/** One R bracket: per-share result, or null when the bars stop before it resolves. */
export function bracketExit(t: ExitTrade, day: DayBars, k: number): number | null {
  if (t.riskPerShare == null || !(t.riskPerShare > 0)) return null;
  const { bars, barSec, closeAt } = day;
  const start = firstAtOrAfter(bars, Math.floor(t.entryAt / 60) * 60 + 60);
  const tgt = t.entry + t.side * k * t.riskPerShare;
  const stop = t.entry - t.side * t.riskPerShare;
  for (let i = start; i < bars.length && bars[i].t < closeAt; i++) {
    const b = bars[i];
    const stopHit = t.side > 0 ? b.l <= stop : b.h >= stop;
    const tgtHit = t.side > 0 ? b.h >= tgt : b.l <= tgt;
    if (stopHit) return r6(-t.riskPerShare); // both in one bar → the stop (conservative)
    if (tgtHit) return r6(k * t.riskPerShare);
  }
  if (!coversClose(bars, barSec, closeAt)) return null;
  const last = lastRegular(bars, start, closeAt);
  return last < 0 ? null : r6(t.side * (bars[last].c - t.entry));
}

/**
 * Exit `minutes` after the entry (at most at the regular close) at the last price known then: the close of the last bar
 * that had ENDED by that moment, ended after the fill and within one bar of the moment. Null when that bar is missing —
 * never the close of a bar still open at the moment (a later price) nor an older bar standing in for a missing one.
 */
export function timeExit(t: ExitTrade, day: DayBars, minutes: number): number | null {
  const { bars, barSec, closeAt } = day;
  const at = Math.min(t.entryAt + minutes * 60, closeAt);
  let hit = -1;
  for (let i = 0; i < bars.length && bars[i].t + barSec <= at; i++) hit = i;
  if (hit < 0) return null;
  const end = bars[hit].t + barSec;
  if (end <= at - barSec || end <= t.entryAt) return null;
  return r6(t.side * (bars[hit].c - t.entry));
}

/** First touch of the prior-bar VWAP after the entry; the close when none; null without volume or with a missing tail. */
export function vwapExit(t: ExitTrade, day: DayBars): number | null {
  const { bars, barSec, closeAt } = day;
  const start = firstAtOrAfter(bars, Math.floor(t.entryAt / 60) * 60 + 60);
  let pv = 0, vol = 0;
  for (let i = 0; i < start && i < bars.length; i++) { pv += ((bars[i].h + bars[i].l + bars[i].c) / 3) * bars[i].v; vol += bars[i].v; }
  for (let i = start; i < bars.length && bars[i].t < closeAt; i++) {
    const b = bars[i];
    if (vol > 0) {
      const vwap = pv / vol;
      if (b.l <= vwap && vwap <= b.h) return r6(t.side * (vwap - t.entry));
    }
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    vol += b.v;
  }
  if (!(vol > 0) || !coversClose(bars, barSec, closeAt)) return null;
  const last = lastRegular(bars, start, closeAt);
  return last < 0 ? null : r6(t.side * (bars[last].c - t.entry));
}

/** Every variant of one trade (null = unknown). */
export function tradeExits(t: ExitTrade, day: DayBars | null): TradeExits {
  const perShare = Object.fromEntries(VARIANTS.map((v) => [v, null])) as Record<ExitVariant, number | null>;
  perShare.actual = t.exit != null ? r6(t.side * (t.exit - t.entry)) : null;
  if (day && day.bars.length) {
    for (const k of R_TARGETS) perShare[`r${k}` as ExitVariant] = bracketExit(t, day, k);
    for (const m of TIME_STOPS_MIN) perShare[`t${m}` as ExitVariant] = timeExit(t, day, m);
    perShare.vwap = vwapExit(t, day);
  }
  return { id: t.id, setup: t.setup, perShare, qty: t.qty, riskPerShare: t.riskPerShare };
}

export type Verdict = "better" | "worse" | "same" | "few";

export interface VariantStat {
  variant: ExitVariant;
  n: number;
  /** Mean of (variant − actual) $ per trade. */
  meanDelta: number | null;
  totalDelta: number | null;
  ci: { lo: number; hi: number } | null;
  /** Mean result of the variant in R (trades with a stop distance), null without. */
  meanR: number | null;
  /** Share of the trades the variant closes in profit. */
  winRate: number | null;
  q: number | null;
  verdict: Verdict;
}

export interface SetupExits {
  setup: string;
  trades: number;
  /** Trades without archived bars for the day. */
  missing: number;
  /** Trades whose day is archived only in bars coarser than 5 minutes (left out: an hour bar cannot place a 5-minute exit). */
  coarse: number;
  variants: VariantStat[];
  /** The variant with the best mean Δ among the «better» ones; null = none beats the actual exits. */
  best: ExitVariant | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Paired bootstrap of a mean (seeded). */
export function bootMean(values: number[], iters = 1000, seed = 20260103): { lo: number; hi: number; se: number } {
  const n = values.length;
  const rnd = mulberry32(seed);
  const means = new Float64Array(iters);
  for (let k = 0; k < iters; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[(rnd() * n) | 0];
    means[k] = s / n;
  }
  let m = 0;
  for (const x of means) m += x;
  m /= iters;
  let ss = 0;
  for (const x of means) ss += (x - m) ** 2;
  const sorted = Array.from(means).sort((a, b) => a - b);
  return { lo: quantileSorted(sorted, 0.025), hi: quantileSorted(sorted, 0.975), se: Math.sqrt(ss / Math.max(1, iters - 1)) };
}

/** Statistics of one group of trades (a setup, or all). `missing` = trades of the group without bars. */
export function aggregateExits(setup: string, rows: TradeExits[], missing: number, opts: { iters?: number; seed?: number; coarse?: number } = {}): SetupExits {
  const stats: VariantStat[] = [];
  const pRaw: number[] = [];
  const idx: number[] = [];
  for (const v of VARIANTS) {
    const deltas: number[] = [];
    const rs: number[] = [];
    let wins = 0, n = 0;
    for (const r of rows) {
      const x = r.perShare[v];
      if (x == null) continue;
      n++;
      if (x > 0) wins++;
      if (r.riskPerShare != null && r.riskPerShare > 0) rs.push(x / r.riskPerShare);
      if (v !== "actual" && r.perShare.actual != null) deltas.push((x - r.perShare.actual) * r.qty);
    }
    const mean = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null;
    const st: VariantStat = {
      variant: v, n: v === "actual" ? n : deltas.length, meanDelta: mean == null ? null : round2(mean), totalDelta: mean == null ? null : round2(mean * deltas.length),
      ci: null, meanR: rs.length ? round2(rs.reduce((s, x) => s + x, 0) / rs.length) : null, winRate: n ? round2(wins / n) : null, q: null,
      verdict: v === "actual" ? "same" : deltas.length < MIN_N ? "few" : "same",
    };
    if (v !== "actual" && deltas.length >= MIN_N && mean != null) {
      const b = bootMean(deltas, opts.iters ?? 1000, (opts.seed ?? 20260103) + stats.length);
      st.ci = { lo: round2(b.lo), hi: round2(b.hi) };
      // A difference with no spread at all (every trade moved the same) is certain unless it is zero.
      pRaw.push(b.se > 0 ? Math.min(1, 2 * normalTail(Math.abs(mean) / b.se)) : mean !== 0 ? 0 : 1);
      idx.push(stats.length);
    }
    stats.push(st);
  }
  const q = pRaw.length ? bhQ(pRaw) : [];
  idx.forEach((i, k) => {
    const s = stats[i];
    s.q = round2(q[k]);
    if (s.ci && s.ci.lo > 0 && q[k] < Q_MAX) s.verdict = "better";
    else if (s.ci && s.ci.hi < 0 && q[k] < Q_MAX) s.verdict = "worse";
  });
  const better = stats.filter((s) => s.verdict === "better").sort((a, b) => (b.meanDelta ?? 0) - (a.meanDelta ?? 0));
  const coarse = opts.coarse ?? 0;
  return { setup, trades: rows.length + missing + coarse, missing, coarse, variants: stats, best: better[0]?.variant ?? null };
}
