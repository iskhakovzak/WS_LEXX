/**
 * «Использование» — pure helpers (unit-tested in usage-model.test.ts): which traders the funnel shows, the default
 * filter, a funnel cell as a mark, the action-key → dictionary key map.
 */
import type { FunnelStep, FunnelTrader, TagState, UsageOverview } from "./usage-api";

export type FunnelFilter = "pilot" | "trainees" | "all";
export const STEPS: readonly FunnelStep[] = ["visit", "plan", "today", "traded", "reviewed", "tagged", "trainer"];

export function isTrainee(t: Pick<FunnelTrader, "tier">): boolean {
  return t.tier === "trainee";
}

/** Pilot when the list has anyone, else interns when there are any, else everyone. */
export function defaultFilter(o: Pick<UsageOverview, "pilot" | "funnel">): FunnelFilter {
  if (o.pilot.names.length) return "pilot";
  return o.funnel.traders.some(isTrainee) ? "trainees" : "all";
}

export function filterTraders<T extends Pick<FunnelTrader, "pilot" | "tier">>(rows: readonly T[], f: FunnelFilter): T[] {
  if (f === "pilot") return rows.filter((r) => r.pilot);
  if (f === "trainees") return rows.filter(isTrainee);
  return [...rows];
}

export type Mark = "yes" | "no" | "part" | "none";

/** One cell: tagged has partial / no-trades states; reviewed and tagged on a day without trades are «none». */
export function cellMark(step: FunnelStep, t: FunnelTrader, i: number): Mark {
  if (step === "tagged") {
    const v: TagState | null = t.cells.tagged[i] ?? null;
    return v == null ? "none" : v === "all" ? "yes" : v === "part" ? "part" : "no";
  }
  const v = t.cells[step][i] ?? false;
  if (!v && step === "reviewed" && !t.cells.traded[i]) return "none";
  return v ? "yes" : "no";
}

/** Denominator of a step's total: traded days for review / tagging (nothing to review without trades), else all days. */
export function stepBase(step: FunnelStep, t: FunnelTrader): number {
  if (step === "reviewed" || step === "tagged") return t.cells.traded.filter(Boolean).length;
  return t.cells.visit.length;
}

/** Pilot participants first, the server order (most missed days first) kept inside each part. */
export function pilotFirst<T extends { pilot: boolean }>(rows: readonly T[]): T[] {
  return [...rows.filter((r) => r.pilot), ...rows.filter((r) => !r.pilot)];
}

/** "playbook.today" → "playbook_today" (the dictionary key under actions.keys). */
export function actionDictKey(key: string): string {
  return key.replace(/\./g, "_");
}

/** Bar height in % of the tallest day (at least 1 so an empty chart still has a scale). */
export function barScale(values: readonly number[]): number {
  return Math.max(1, ...values);
}
