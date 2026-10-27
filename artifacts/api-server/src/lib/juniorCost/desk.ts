/**
 * Desk view of «Цена джуна до безубытка» (pure): every junior's path, the cohort tables (academy cohort, start month,
 * curator / mentor) and «что окупается». Definitions: path.ts (one junior), cohorts.ts (groups), attribution.ts
 * (practices). I/O and caching: store.ts; per-viewer scope: the route.
 */
import { attribution, exposureOf, type Activity, type Exposure, type FactorResult } from "./attribution";
import { cohortTable, countable, GROUP_BY, type CohortRow, type GroupBy, type GroupKeys } from "./cohorts";
import { juniorPath, type JuniorInput, type JuniorPath } from "./path";

/** `keys.month` is ignored: the start month comes from the path. */
export type DeskJuniorInput = { input: JuniorInput; keys: GroupKeys; activity: Activity };

export type DeskInput = {
  asOf: string;
  deskFirstDay: string | null;
  seatUsdMonth: number;
  stableDays: number;
  juniors: readonly DeskJuniorInput[];
  B?: number;
};

/** A list row: the path without its curve, with its group keys. */
export type JuniorRow = Omit<JuniorPath, "curve"> & { keys: GroupKeys; exposure: Exposure | null };

export type DeskResult = {
  asOf: string;
  settings: { seatUsdMonth: number; stableDays: number };
  deskFirstDay: string | null;
  counts: { juniors: number; countable: number; truncated: number };
  juniors: JuniorRow[];
  cohorts: Record<GroupBy, { desk: CohortRow; rows: CohortRow[] }>;
  attribution: FactorResult[];
};

const STATUS_ORDER: Record<JuniorPath["status"], number> = { below: 0, provisional: 1, insufficient: 2, reached: 3, stopped: 4 };

export function buildDesk(x: DeskInput): DeskResult {
  const opts = { asOf: x.asOf, stableDays: x.stableDays, seatUsdMonth: x.seatUsdMonth, deskFirstDay: x.deskFirstDay, B: x.B };
  const paths = x.juniors.map((j) => ({ j, p: juniorPath(j.input, opts) })).filter(({ p }) => p.start != null);
  // The start month comes from the path (min of academy start and first trade), whatever the loader sent.
  const keys = new Map<string, GroupKeys>(paths.map(({ j, p }) => [p.name, { ...j.keys, month: p.start!.slice(0, 7) }]));
  const exposures = new Map<string, Exposure>();
  for (const { j, p } of paths) {
    if (!countable(p)) continue;
    const e = exposureOf(p, j.activity, x.asOf);
    if (e) exposures.set(p.name, e);
  }
  const all = paths.map(({ p }) => p);
  const cohorts = Object.fromEntries(GROUP_BY.map((by) => [by, cohortTable(all, keys, by)])) as DeskResult["cohorts"];
  const juniors: JuniorRow[] = paths
    .map(({ p }) => {
      const { curve: _curve, ...row } = p;
      return { ...row, keys: keys.get(p.name)!, exposure: exposures.get(p.name) ?? null };
    })
    .sort((a, b) => Number(a.truncated) - Number(b.truncated) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.cost.total - a.cost.total || a.name.localeCompare(b.name));
  return {
    asOf: x.asOf,
    settings: { seatUsdMonth: x.seatUsdMonth, stableDays: x.stableDays },
    deskFirstDay: x.deskFirstDay,
    counts: { juniors: all.length, countable: all.filter(countable).length, truncated: all.filter((p) => p.truncated).length },
    juniors,
    cohorts,
    attribution: attribution(all.filter(countable), exposures, { B: x.B }),
  };
}

/** The desk benchmark a junior sees next to their own numbers: anonymous, only with ≥ minReached juniors at breakeven. */
export function deskBenchmark(d: DeskResult, minReached: number): { medianCost: number | null; medianDays: number | null; reached: number; juniors: number } | null {
  const row = d.cohorts.cohort.desk;
  if (row.reached < minReached) return null;
  return { medianCost: row.medianCost, medianDays: row.medianDays, reached: row.reached, juniors: row.juniors };
}

/** The desk result as a viewer with `scope` may see it: every aggregate, but junior rows only of readable traders. */
export function scopeDesk(d: DeskResult, scope: readonly string[] | null): DeskResult {
  if (scope == null) return d;
  const ok = new Set(scope);
  return { ...d, juniors: d.juniors.filter((j) => ok.has(j.name)) };
}
