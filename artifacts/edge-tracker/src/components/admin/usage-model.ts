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

/** PILOT §3 weekly summary rows (docs/PILOT.md): metric → how many of the cohort hit the «хорошо» threshold. */
export type PilotRowKey = "plan" | "today" | "reviewed" | "focus" | "trainer" | "inactive";
export type PilotRow = {
  key: PilotRowKey;
  /** People who hit the threshold (inactive: how many are inactive); null = not measured by the usage log. */
  value: number | null;
  /** Denominator (cohort, or traders who traded for «разбор»). */
  total: number;
  /** true = «хорошо», false = «плохо», null = no verdict (no data / low data). */
  good: boolean | null;
};
export const PILOT_WEEK_DAYS = 5;
const lastN = (xs: readonly boolean[], n = PILOT_WEEK_DAYS) => xs.slice(-n).filter(Boolean).length;

/**
 * The six PILOT §3 lines over the last 5 trading days for `cohort` (pilot list → trainees → everyone, as the funnel
 * filter): plan before 09:30 ≥ 4/5, playbook «Сегодня» before the open ≥ 3/5, evening review on ≥ 4 of 5 (or every
 * traded day when fewer), trainer ≥ 2 days — «хорошо» when most of the cohort does it; the focus mistake is not in
 * the usage log (value null); inactive 3+ trading days: 0–1 person is «хорошо».
 */
export function pilotSummary(cohort: readonly FunnelTrader[], inactiveNames: readonly string[], lowData: boolean): PilotRow[] {
  const n = cohort.length;
  const majority = (hit: number, of: number): boolean | null => (of ? hit * 2 > of : null);
  const count = (pred: (t: FunnelTrader) => boolean) => cohort.filter(pred).length;
  const plan = count((t) => lastN(t.cells.plan) >= 4);
  const today = count((t) => lastN(t.cells.today) >= 3);
  const traded = cohort.filter((t) => lastN(t.cells.traded) > 0);
  const reviewed = traded.filter((t) => lastN(t.cells.reviewed) >= Math.min(4, lastN(t.cells.traded))).length;
  const trainer = count((t) => lastN(t.cells.trainer) >= 2);
  const names = new Set(cohort.map((t) => t.name));
  const idle = inactiveNames.filter((x) => names.has(x)).length;
  return [
    { key: "plan", value: plan, total: n, good: majority(plan, n) },
    { key: "today", value: today, total: n, good: majority(today, n) },
    { key: "reviewed", value: reviewed, total: traded.length, good: majority(reviewed, traded.length) },
    { key: "focus", value: null, total: n, good: null },
    { key: "trainer", value: trainer, total: n, good: majority(trainer, n) },
    { key: "inactive", value: lowData ? null : idle, total: n, good: lowData || !n ? null : idle <= 1 },
  ];
}

/**
 * Menu screens nobody opened (PILOT §3 «кандидаты на скрытие»): `items` = the trader menu (href + also prefixes),
 * `opened` = route patterns from the usage log. A screen counts as opened when any pattern is it or a sub-route.
 */
export function neverOpened<T extends { href: string; also?: readonly string[] }>(items: readonly T[], opened: readonly string[]): T[] {
  const hit = (prefix: string) => opened.some((k) => (prefix === "/" ? k === "/" : k === prefix || k.startsWith(prefix + "/")));
  return items.filter((i) => !hit(i.href) && !(i.also ?? []).some(hit));
}

/** "playbook.today" → "playbook_today" (the dictionary key under actions.keys). */
export function actionDictKey(key: string): string {
  return key.replace(/\./g, "_");
}

/** Bar height in % of the tallest day (at least 1 so an empty chart still has a scale). */
export function barScale(values: readonly number[]): number {
  return Math.max(1, ...values);
}
