/**
 * «Desk saved $» — PURE estimate (no I/O), unit-tested. An ESTIMATE vs the trader's own history, never a fact.
 *
 * Method (one alert):
 *   rest      what the rest of the session did after the alert: the day's final realized net − the realized net at
 *             the trigger time (lib/riskSignals/detect restAfter; unrealized is not known for past days, so both sides
 *             use realized numbers).
 *   cases     the same detector (detect.ts detectDay, same signal and level) replayed over the trader's own past days
 *             in the lookback that had NO alert of this signal; each day where the situation happened gives one
 *             «rest of the session after it» number. Past days use today's daily limit, plan picks and size baseline
 *             (approximation, kept simple on purpose).
 *   baseline  mean of the cases;  saved = rest − baseline  (positive: after the alert the trader did better than they
 *             usually do after the same situation; negative: worse — shown as is).
 *   honesty   fewer than `minSample` cases → no number (`saved` null), the sample size is still shown. Nothing is
 *             attributed to an alert that has no history to compare with.
 * Totals (day / week / month) add up the alerts that have a number and report how many were hidden.
 */
import type { Signal } from "./types";

export type SavedEstimate = { rest: number; baselineRest: number | null; cases: number; saved: number | null };

const round2 = (v: number) => Math.round(v * 100) / 100;

export function estimateSaved(rest: number, cases: readonly number[], minSample: number): SavedEstimate {
  if (!cases.length) return { rest: round2(rest), baselineRest: null, cases: 0, saved: null };
  const mean = cases.reduce((a, b) => a + b, 0) / cases.length;
  return {
    rest: round2(rest),
    baselineRest: round2(mean),
    cases: cases.length,
    saved: cases.length >= minSample ? round2(rest - mean) : null,
  };
}

export type SavedRow = { day: string; signal: Signal; settled: boolean; saved: number | null; cases: number | null };

export type SavedTotals = {
  /** Alerts in the period. */
  alerts: number;
  /** Alerts whose session is over and compared. */
  settled: number;
  /** Settled alerts with a number (enough history). */
  estimated: number;
  /** Settled alerts without a number: fewer past cases than the minimum. */
  hidden: number;
  /** Σ saved over the estimated alerts (null when none). */
  saved: number | null;
  /** Σ past cases behind the estimated alerts (the sample size). */
  cases: number;
};

function totals(rows: readonly SavedRow[]): SavedTotals {
  let settled = 0, estimated = 0, hidden = 0, saved = 0, cases = 0;
  for (const r of rows) {
    if (!r.settled) continue;
    settled++;
    if (r.saved == null) {
      hidden++;
      continue;
    }
    estimated++;
    saved += r.saved;
    cases += r.cases ?? 0;
  }
  return { alerts: rows.length, settled, estimated, hidden, saved: estimated ? round2(saved) : null, cases };
}

export function summarizeSaved(rows: readonly SavedRow[]): SavedTotals & { bySignal: Array<{ signal: Signal } & SavedTotals> } {
  const signals = [...new Set(rows.map((r) => r.signal))];
  return { ...totals(rows), bySignal: signals.map((signal) => ({ signal, ...totals(rows.filter((r) => r.signal === signal)) })) };
}
