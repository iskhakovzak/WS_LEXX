/**
 * «Найди вход» drills — pure rules (no I/O): the bars a drill shows, the answer window, the score and the verdict.
 *
 * A drill = one real entry on a playbook setup (a playbook example, or a desk trade linked to the setup with R ≥ 0)
 * on its archived 1-minute day. The player sees the day from the premarket up to the end of the answer window (fake
 * date, real New York wall clock — like the simulator), clicks the bar and the price of the entry, and gets the real
 * entry, the bars after the window and the ticker/date only in the answer.
 *
 *   window    trainer.drillWindowBars bars; the real entry bar sits k bars after its start, k ∈ [2, W − 3] from a hash
 *             of the drill id (stable for a drill, different between drills — the entry is never always at the same
 *             place);
 *   context   up to LEAD_BARS bars before the window (from 04:00 NY), at least MIN_CONTEXT;
 *   score     0..100 = 50 × max(0, 1 − bars off / trainer.drillBarTolerance) + 50 × max(0, 1 − price off in ATR /
 *             trainer.drillAtrTolerance); ATR = the 14-bar 1-minute ATR of the bars before the window;
 *   verdict   exact (right bar, ≤ ¼ ATR) · close (score ≥ trainer.drillPassScore) · early · late · price (right bar,
 *             price too far).
 */
import type { SimBar } from "../sim/engine";
import { PRE_OPEN, atr, etOf, fakeTimes } from "../sim/scenario";
import { barIndexAt } from "../sim/own";
import { hash32 } from "./dailyPick";

export const LEAD_BARS = 150;
export const MIN_CONTEXT = 20;
export const AFTER_BARS = 45;
const POST_END = 20 * 60;

export type BuiltDrill = {
  /** Bars shown (real values) and their fake times. */
  bars: SimBar[];
  times: number[];
  window: { from: number; to: number };
  ideal: { barIndex: number; price: number };
  atr: number;
  after: SimBar[];
  afterTimes: number[];
};

/** Where the real entry sits inside the window (bars after the window start). */
export function entryOffset(drillId: number, windowBars: number): number {
  const lo = 2, hi = Math.max(lo, windowBars - 3);
  return lo + (hash32(`drill:${drillId}`) % (hi - lo + 1));
}

/** Builds a drill from the archived day; null when the bars cannot carry it (no bar at the fill, too little context). */
export function buildDrill(input: {
  drillId: number;
  day: string;
  dayBars: readonly SimBar[];
  entryAt: number;
  entryPrice: number;
  windowBars: number;
}): BuiltDrill | null {
  const bars = input.dayBars.filter((b) => { const e = etOf(b.t); return e.date === input.day && e.min >= PRE_OPEN && e.min < POST_END; });
  const entryIdx = barIndexAt(bars, input.entryAt);
  if (entryIdx == null || input.entryAt >= bars[entryIdx].t + 60) return null;
  const from = entryIdx - entryOffset(input.drillId, input.windowBars);
  if (from < MIN_CONTEXT) return null;
  const to = Math.min(bars.length - 1, from + input.windowBars - 1);
  if (to < entryIdx) return null;
  const start = Math.max(0, from - LEAD_BARS);
  const shown = bars.slice(start, to + 1);
  const after = bars.slice(to + 1, to + 1 + AFTER_BARS);
  const times = fakeTimes([...shown, ...after], "intraday");
  const before = shown.slice(0, from - start + 1);
  const a = atr(before, 14);
  return {
    bars: shown,
    times: times.slice(0, shown.length),
    window: { from: from - start, to: to - start },
    ideal: { barIndex: entryIdx - start, price: input.entryPrice },
    atr: Math.max(a ?? input.entryPrice * 0.002, 0.01),
    after,
    afterTimes: times.slice(shown.length),
  };
}

export type Tolerances = { bars: number; atr: number };

/** 0..100 from the bar distance and the price distance in ATR units. */
export function scoreAnswer(ideal: { barIndex: number; price: number }, yours: { barIndex: number; price: number }, atrUnit: number, tol: Tolerances): number {
  const barsOff = Math.abs(yours.barIndex - ideal.barIndex);
  const atrOff = Math.abs(yours.price - ideal.price) / (atrUnit > 0 ? atrUnit : 0.01);
  const b = Math.max(0, 1 - barsOff / Math.max(1, tol.bars));
  const p = Math.max(0, 1 - atrOff / Math.max(0.01, tol.atr));
  return Math.round(50 * b + 50 * p);
}

export type Verdict = "exact" | "close" | "early" | "late" | "price";

export function verdictOf(ideal: { barIndex: number; price: number }, yours: { barIndex: number; price: number }, atrUnit: number, score: number, passScore: number): Verdict {
  const d = yours.barIndex - ideal.barIndex;
  const atrOff = Math.abs(yours.price - ideal.price) / (atrUnit > 0 ? atrUnit : 0.01);
  if (d === 0 && atrOff <= 0.25) return "exact";
  if (score >= passScore) return "close";
  if (d < 0) return "early";
  if (d > 0) return "late";
  return "price";
}

/** «1.3 ORB 5 минут» → { code: "1.3", name: "ORB 5 минут" }. */
export function splitSetupName(full: string): { code: string | null; name: string } {
  const m = /^(\d+\.\d+)\s+(.+)$/.exec(full.trim());
  return m ? { code: m[1], name: m[2] } : { code: null, name: full.trim() };
}
