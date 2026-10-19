/**
 * «Найди вход» — pure client logic (no React): where a click lands inside the decision window, the run summary and
 * the fallback explanation when the server's text key is unknown to this build. The server scores; this only reads.
 */
import type { FindEntryAnswer, FindEntryDrill } from "@/lib/trainer/types";
import type { Tone } from "@/components/ds";
import { roundPrice } from "./model";

/** Drills per run and the soft time budget of one drill. */
export const RUN_LENGTH = 10;
export const DRILL_SECONDS = 30;
/** A drill «hit»: close enough to the reference entry. */
export const HIT_SCORE = 70;

/** A click / tap → the entry: the bar is kept inside the decision window, the price inside that bar's range. */
export function clampPick(drill: Pick<FindEntryDrill, "bars" | "window">, idx: number, price: number): { barIndex: number; price: number } | null {
  if (!drill.bars.length) return null;
  const last = drill.bars.length - 1;
  const from = Math.max(0, Math.min(drill.window.from, last));
  const to = Math.max(from, Math.min(drill.window.to, last));
  const i = Math.max(from, Math.min(to, Math.round(idx)));
  const b = drill.bars[i];
  if (!b || !Number.isFinite(price)) return null;
  return { barIndex: i, price: roundPrice(Math.max(b.l, Math.min(b.h, price))) };
}

/** One answered drill of a run; `ticker` / `date` are revealed with the answer (shown in the run summary). */
export type DrillResult = { drillId: number; setupName: string; score: number; masteryDelta: number; ticker?: string; date?: string };

export function runSummary(results: readonly DrillResult[]): { count: number; accuracy: number | null; hits: number; mastery: number; best: number | null } {
  if (!results.length) return { count: 0, accuracy: null, hits: 0, mastery: 0, best: null };
  const sum = results.reduce((s, r) => s + r.score, 0);
  return {
    count: results.length,
    accuracy: Math.round(sum / results.length),
    hits: results.filter((r) => r.score >= HIT_SCORE).length,
    mastery: Math.round(results.reduce((s, r) => s + r.masteryDelta, 0) * 100) / 100,
    best: Math.max(...results.map((r) => r.score)),
  };
}

export function scoreTone(score: number): Tone {
  return score >= HIT_SCORE ? "up" : score >= 40 ? "warn" : "down";
}

/** Timing and price of the pick vs the reference entry (used when the server's explanation key has no text here). */
export function pickDiff(a: Pick<FindEntryAnswer, "ideal" | "yours">): { when: "early" | "late" | "onTime"; bars: number; pricePct: number } {
  const bars = a.yours.barIndex - a.ideal.barIndex;
  const pricePct = a.ideal.price > 0 ? Math.round(((a.yours.price - a.ideal.price) / a.ideal.price) * 10000) / 100 : 0;
  return { when: bars < 0 ? "early" : bars > 0 ? "late" : "onTime", bars: Math.abs(bars), pricePct };
}
