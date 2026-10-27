/**
 * What the guard is worth in $ (pure): settled events → «сэкономлено / потеряно» over time.
 *
 *   saved     Σ estimated $ kept by complying (each complied event: the trader's own expected cost of that trigger)
 *   lost      Σ actual $ lost on trades taken against the guard (ignored events)
 *   compliance complied / (complied + ignored); late, no_trades and unknown events are counted apart (late = the data
 *             arrived after the at-risk trade — the PropReports polling delay, not the trader)
 *   lagSec    median seconds from the trigger (loss exit, violation, warn) to the guard seeing it — the real latency
 */
import type { GuardOutcome, GuardPattern } from "./types";

export type ImpactEvent = {
  day: string;
  pattern: GuardPattern;
  outcome: GuardOutcome | null;
  saved: number | null;
  lost: number | null;
  /** detected − triggered, seconds (null for first_trade: its trigger is the scan itself). */
  lagSec: number | null;
};

export type ImpactTotals = {
  events: number;
  settled: number;
  complied: number;
  ignored: number;
  late: number;
  noTrades: number;
  saved: number;
  lost: number;
  compliance: number | null;
};

export type ImpactSummary = ImpactTotals & {
  medianLagSec: number | null;
  byPattern: Array<{ pattern: GuardPattern } & ImpactTotals>;
  /** ISO week (Monday date) → saved / lost, oldest first. */
  weekly: Array<{ week: string; saved: number; lost: number; complied: number; ignored: number }>;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Monday of the date's week (YYYY-MM-DD). */
export function weekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
}

function totals(list: readonly ImpactEvent[]): ImpactTotals {
  let complied = 0, ignored = 0, late = 0, noTrades = 0, settled = 0, saved = 0, lost = 0;
  for (const e of list) {
    if (!e.outcome) continue;
    settled++;
    if (e.outcome === "complied") complied++;
    else if (e.outcome === "ignored") ignored++;
    else if (e.outcome === "late") late++;
    else if (e.outcome === "no_trades") noTrades++;
    saved += e.saved ?? 0;
    lost += e.lost ?? 0;
  }
  return {
    events: list.length, settled, complied, ignored, late, noTrades, saved: round2(saved), lost: round2(lost),
    compliance: complied + ignored ? round2(complied / (complied + ignored)) : null,
  };
}

function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
}

export function summarize(events: readonly ImpactEvent[]): ImpactSummary {
  const patterns = [...new Set(events.map((e) => e.pattern))];
  const weeks = new Map<string, { saved: number; lost: number; complied: number; ignored: number }>();
  for (const e of events) {
    if (!e.outcome) continue;
    const k = weekOf(e.day);
    const w = weeks.get(k) ?? { saved: 0, lost: 0, complied: 0, ignored: 0 };
    w.saved = round2(w.saved + (e.saved ?? 0));
    w.lost = round2(w.lost + (e.lost ?? 0));
    if (e.outcome === "complied") w.complied++;
    if (e.outcome === "ignored") w.ignored++;
    weeks.set(k, w);
  }
  return {
    ...totals(events),
    medianLagSec: medianOf(events.map((e) => e.lagSec).filter((v): v is number => v != null && v >= 0)),
    byPattern: patterns.map((pattern) => ({ pattern, ...totals(events.filter((e) => e.pattern === pattern)) })),
    weekly: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, w]) => ({ week, ...w })),
  };
}
