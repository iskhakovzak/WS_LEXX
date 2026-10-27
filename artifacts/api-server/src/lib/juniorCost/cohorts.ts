/**
 * Cohort comparison of junior paths (pure; tests in lib/__tests__/juniorCost.test.ts).
 *
 * Every statistic leaves out truncated paths (the real start lies before the data) — they are counted apart.
 *
 *   Time to breakeven   Kaplan–Meier median in weekdays from start: a junior still on the way (or stopped) is censored
 *                       at their tenure instead of being dropped, so the median is not flattered by survivors only.
 *                       null when fewer than half of the group reached breakeven yet — shown as «больше N дней».
 *   Cost                median total price among those who reached breakeven (the ones still under water have only paid
 *                       part of it — their spend is in «where the money went»).
 *   Survival            counts by outcome: reached / on the way (below, provisional, insufficient) / stopped.
 *   Where the money went  Σ of every path's price so far, split by kind (fees paid and the gross trading result at the
 *                       deepest point — trading = fees − gross — and seats) and by outcome (reached / on the way / sunk
 *                       in the ones who stopped).
 */
import type { JuniorPath } from "./path";

export const GROUP_BY = ["cohort", "month", "curator"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

/** Junior → group label per grouping (cohort name, start month YYYY-MM, curator name; null = none). */
export type GroupKeys = Record<GroupBy, string | null>;

export type Money = { total: number; fees: number; gross: number; seat: number; reached: number; onTheWay: number; stopped: number };

export type CohortRow = {
  key: string | null;
  juniors: number;
  reached: number;
  onTheWay: number;
  stopped: number;
  /** reached / juniors (0…1). */
  reachedShare: number;
  medianCost: number | null;
  /** Kaplan–Meier median weekdays to breakeven; null = not reached by half the group. */
  medianDays: number | null;
  /** Median calendar days among those who reached (for reading; the KM median is the honest one). */
  medianCalendarDays: number | null;
  /** The longest tenure in the group (for «больше N дней» when medianDays is null). */
  maxTenure: number;
  money: Money;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Kaplan–Meier median: smallest event time t with S(t) ≤ 0.5; null when the curve never gets there. */
export function kmMedian(obs: readonly { t: number; event: boolean }[]): number | null {
  const s = [...obs].sort((a, b) => a.t - b.t || Number(b.event) - Number(a.event));
  let atRisk = s.length;
  let surv = 1;
  let i = 0;
  while (i < s.length) {
    const t = s[i].t;
    let d = 0, n = 0;
    while (i < s.length && s[i].t === t) { if (s[i].event) d++; n++; i++; }
    if (d > 0) {
      surv *= 1 - d / atRisk;
      if (surv <= 0.5 + 1e-12) return t;
    }
    atRisk -= n;
  }
  return null;
}

/** Time-to-breakeven observation of a path (weekdays; event = reached). */
export function survivalObs(p: JuniorPath): { t: number; event: boolean } {
  return p.breakeven ? { t: p.breakeven.tradingDays, event: true } : { t: p.tenureTradingDays, event: false };
}

/** Paths that enter desk statistics: a known start, not truncated. */
export function countable(p: JuniorPath): boolean {
  return !p.truncated && p.start != null;
}

function moneyOf(paths: readonly JuniorPath[]): Money {
  const m: Money = { total: 0, fees: 0, gross: 0, seat: 0, reached: 0, onTheWay: 0, stopped: 0 };
  for (const p of paths) {
    m.total += p.cost.total; m.fees += p.cost.fees; m.gross += p.cost.gross; m.seat += p.cost.seat;
    if (p.status === "reached") m.reached += p.cost.total;
    else if (p.status === "stopped") m.stopped += p.cost.total;
    else m.onTheWay += p.cost.total;
  }
  return { total: r2(m.total), fees: r2(m.fees), gross: r2(m.gross), seat: r2(m.seat), reached: r2(m.reached), onTheWay: r2(m.onTheWay), stopped: r2(m.stopped) };
}

function summarizeGroup(key: string | null, paths: readonly JuniorPath[]): CohortRow {
  const reached = paths.filter((p) => p.status === "reached");
  const stopped = paths.filter((p) => p.status === "stopped").length;
  const mc = median(reached.map((p) => p.cost.total));
  const mcal = median(reached.map((p) => p.breakeven!.calendarDays));
  return {
    key,
    juniors: paths.length,
    reached: reached.length,
    onTheWay: paths.length - reached.length - stopped,
    stopped,
    reachedShare: paths.length ? r2(reached.length / paths.length) : 0,
    medianCost: mc == null ? null : r2(mc),
    medianDays: kmMedian(paths.map(survivalObs)),
    medianCalendarDays: mcal == null ? null : Math.round(mcal),
    maxTenure: paths.reduce((m, p) => Math.max(m, survivalObs(p).t), 0),
    money: moneyOf(paths),
  };
}

/** Groups by one key (countable paths only), biggest first, «none» last; plus the desk row. */
export function cohortTable(paths: readonly JuniorPath[], keys: ReadonlyMap<string, GroupKeys>, by: GroupBy): { desk: CohortRow; rows: CohortRow[] } {
  const used = paths.filter(countable);
  const groups = new Map<string | null, JuniorPath[]>();
  for (const p of used) {
    const k = keys.get(p.name)?.[by] ?? null;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const rows = [...groups.entries()].map(([k, ps]) => summarizeGroup(k, ps));
  rows.sort((a, b) => (a.key == null ? 1 : 0) - (b.key == null ? 1 : 0)
    || (by === "month" ? String(b.key).localeCompare(String(a.key)) : b.juniors - a.juniors || String(a.key).localeCompare(String(b.key))));
  return { desk: summarizeGroup(null, used), rows };
}
