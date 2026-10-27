/**
 * «Что окупается» — juniors who used a desk practice early vs those who did not, on price and time to breakeven
 * (pure, seeded; tests in lib/__tests__/juniorCost.test.ts). A correlation between groups, never a cause: juniors who
 * choose the trainer or meet their mentor may differ in other ways — the web says so next to every number.
 *
 * Exposure window: [start, start + EXPOSURE_DAYS] cut at the outcome (breakeven day, last trade of a stopped junior,
 * asOf) — practice after breakeven cannot explain reaching it, and a fixed early window keeps a slow junior from
 * collecting more sessions just by being slow. Rates are per month of that window; a window shorter than
 * MIN_EXPOSURE_DAYS leaves the junior out of every factor.
 *
 *   trainer   simulator games finished + days with «Найди вход» answers; yes = rate ≥ T sessions a month, T = the median
 *             rate of the juniors compared (at least 1), so both groups have members.
 *   exams     academy quizzes passed in the window; yes = at least one.
 *   oneOnOne  1:1 meetings; yes = at least one a month (the cabinet's ONE_ON_ONE_DAYS = 30 rhythm).
 *   plans     «по плану» answers (journal day + evening trade review); yes = ≥ PLAN_SHARE followed, among juniors with
 *             ≥ PLAN_MIN_ANSWERS answers (the rest are left out of this factor).
 *
 * Price: median total cost among those who reached breakeven in each group. Time: Kaplan–Meier median weekdays (the
 * ones still on the way are censored, not dropped). Differences yes − no with a percentile bootstrap 80% interval
 * (juniors resampled within each group). Honesty (the repo's «Мой edge» statuses): «low» when a group has fewer than
 * MIN_GROUP juniors or fewer than MIN_REACHED at breakeven; otherwise Benjamini–Hochberg q across the factors on the price
 * difference: q ≤ Q_RELIABLE «reliable», else «hypothesis».
 */
import { bhQValues, randInt, rngFor, STATS_SEED } from "../stats";
import { addDays } from "../tradingDate";
import { kmMedian, median, survivalObs } from "./cohorts";
import { DAYS_PER_MONTH, type JuniorPath } from "./path";

export const EXPOSURE_DAYS = 60;
export const MIN_EXPOSURE_DAYS = 14;
export const PLAN_SHARE = 0.7;
export const PLAN_MIN_ANSWERS = 5;
export const MIN_GROUP = 5;
export const MIN_REACHED = 3;
export const Q_RELIABLE = 0.1;

export const FACTORS = ["trainer", "exams", "oneOnOne", "plans"] as const;
export type FactorKey = (typeof FACTORS)[number];

export type Activity = {
  /** One entry per session day (a finished game; a day with drill answers). */
  trainer: readonly string[];
  /** First pass day per quiz. */
  exams: readonly string[];
  oneOnOnes: readonly string[];
  plans: readonly { day: string; followed: boolean }[];
};

export type Exposure = { windowDays: number; trainerPerMonth: number; exams: number; oneOnOnePerMonth: number; planAnswers: number; planShare: number | null };

export type GroupStat = { juniors: number; reached: number; reachedShare: number; medianCost: number | null; medianDays: number | null };
export type Diff = { point: number; lo: number; hi: number };
export type Status = "reliable" | "hypothesis" | "low";

export type FactorResult = {
  factor: FactorKey;
  /** trainer: sessions a month; exams: passed; oneOnOne: meetings a month; plans: share followed. */
  threshold: number;
  yes: GroupStat;
  no: GroupStat;
  /** Countable juniors without a usable exposure for this factor. */
  excluded: number;
  costDiff: Diff | null;
  daysDiff: Diff | null;
  q: number | null;
  status: Status;
  /** pays = cheaper and not slower; costs = dearer; unclear otherwise (or status low). */
  verdict: "pays" | "costs" | "unclear";
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const inWindow = (day: string, from: string, to: string) => day.slice(0, 10) >= from && day.slice(0, 10) <= to;

/** The exposure window end: the outcome day, or start + EXPOSURE_DAYS, whichever is first. */
export function exposureOf(p: JuniorPath, a: Activity, asOf: string): Exposure | null {
  if (!p.start) return null;
  const outcome = p.breakeven?.day ?? (p.status === "stopped" ? p.lastTrade ?? p.start : asOf);
  const cap = addDays(p.start, EXPOSURE_DAYS);
  const to = outcome < cap ? outcome : cap;
  const windowDays = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${p.start}T12:00:00Z`)) / 86_400_000) + 1;
  if (windowDays < MIN_EXPOSURE_DAYS) return null;
  const months = windowDays / DAYS_PER_MONTH;
  const plans = a.plans.filter((x) => inWindow(x.day, p.start!, to));
  return {
    windowDays,
    trainerPerMonth: r2(a.trainer.filter((d) => inWindow(d, p.start!, to)).length / months),
    exams: a.exams.filter((d) => inWindow(d, p.start!, to)).length,
    oneOnOnePerMonth: r2(a.oneOnOnes.filter((d) => inWindow(d, p.start!, to)).length / months),
    planAnswers: plans.length,
    planShare: plans.length ? r2(plans.filter((x) => x.followed).length / plans.length) : null,
  };
}

/** yes / no / null (left out) of one junior for one factor. */
function sideOf(f: FactorKey, e: Exposure, threshold: number): boolean | null {
  switch (f) {
    case "trainer": return e.trainerPerMonth >= threshold;
    case "exams": return e.exams >= 1;
    case "oneOnOne": return e.oneOnOnePerMonth >= 1;
    case "plans": return e.planAnswers >= PLAN_MIN_ANSWERS && e.planShare != null ? e.planShare >= PLAN_SHARE : null;
  }
}

function groupStat(ps: readonly JuniorPath[]): GroupStat {
  const reached = ps.filter((p) => p.status === "reached");
  const mc = median(reached.map((p) => p.cost.total));
  return {
    juniors: ps.length, reached: reached.length, reachedShare: ps.length ? r2(reached.length / ps.length) : 0,
    medianCost: mc == null ? null : r2(mc), medianDays: kmMedian(ps.map(survivalObs)),
  };
}

const costMedian = (ps: readonly JuniorPath[]) => median(ps.filter((p) => p.status === "reached").map((p) => p.cost.total));
const daysMedian = (ps: readonly JuniorPath[]) => kmMedian(ps.map(survivalObs));

function pct(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Bootstrap of `stat(yes) − stat(no)` (juniors resampled within each group); null without a point estimate. */
function bootDiff(
  yes: readonly JuniorPath[], no: readonly JuniorPath[], stat: (ps: readonly JuniorPath[]) => number | null, seed: string, B: number,
): { diff: Diff; p: number } | null {
  const a = stat(yes), b = stat(no);
  if (a == null || b == null) return null;
  const point = a - b;
  const rng = rngFor(STATS_SEED, "juniorCost", seed);
  const draw = (ps: readonly JuniorPath[]) => Array.from({ length: ps.length }, () => ps[randInt(rng, ps.length)]);
  const draws: number[] = [];
  for (let i = 0; i < B; i++) {
    const x = stat(draw(yes)), y = stat(draw(no));
    if (x != null && y != null) draws.push(x - y);
  }
  if (draws.length < B / 4) return { diff: { point: r2(point), lo: r2(point), hi: r2(point) }, p: 1 };
  draws.sort((u, v) => u - v);
  const opposite = draws.filter((d) => (point < 0 ? d >= 0 : point > 0 ? d <= 0 : true)).length / draws.length;
  return { diff: { point: r2(point), lo: r2(pct(draws, 0.1)), hi: r2(pct(draws, 0.9)) }, p: Math.min(1, 2 * opposite) };
}

/** Every factor for the countable juniors with an exposure (`exposures`: name → exposure). */
export function attribution(paths: readonly JuniorPath[], exposures: ReadonlyMap<string, Exposure>, opts: { B?: number } = {}): FactorResult[] {
  const B = opts.B ?? 1000;
  const used = paths.filter((p) => exposures.has(p.name));
  const trainerT = Math.max(1, Math.round(median(used.map((p) => exposures.get(p.name)!.trainerPerMonth)) ?? 1));
  const raw = FACTORS.map((f) => {
    const threshold = f === "trainer" ? trainerT : f === "plans" ? PLAN_SHARE : 1;
    const yes: JuniorPath[] = [], no: JuniorPath[] = [];
    let excluded = paths.length - used.length;
    for (const p of used) {
      const s = sideOf(f, exposures.get(p.name)!, threshold);
      if (s == null) excluded++; else (s ? yes : no).push(p);
    }
    const gy = groupStat(yes), gn = groupStat(no);
    const low = Math.min(gy.juniors, gn.juniors) < MIN_GROUP || Math.min(gy.reached, gn.reached) < MIN_REACHED;
    const cost = bootDiff(yes, no, costMedian, `${f}:cost`, B);
    const days = bootDiff(yes, no, daysMedian, `${f}:days`, B);
    return { f, threshold, gy, gn, excluded, low, cost, days };
  });
  const tested = raw.filter((x) => !x.low && x.cost);
  const q = bhQValues(tested.map((x) => x.cost!.p));
  const qOf = new Map(tested.map((x, i) => [x.f, q[i]]));
  return raw.map((x): FactorResult => {
    const qv = qOf.get(x.f) ?? null;
    const status: Status = x.low || qv == null ? "low" : qv <= Q_RELIABLE ? "reliable" : "hypothesis";
    const c = x.cost?.diff.point ?? null, d = x.days?.diff.point ?? null;
    const verdict = status === "low" || c == null ? "unclear" : c < 0 && (d == null || d <= 0) ? "pays" : c > 0 && (d == null || d >= 0) ? "costs" : "unclear";
    return {
      factor: x.f, threshold: x.threshold, yes: x.gy, no: x.gn, excluded: x.excluded,
      costDiff: x.cost?.diff ?? null, daysDiff: x.days?.diff ?? null, q: qv == null ? null : Math.round(qv * 1000) / 1000, status, verdict,
    };
  });
}
