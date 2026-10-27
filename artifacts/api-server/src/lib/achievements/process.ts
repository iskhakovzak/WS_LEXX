/**
 * Achievements v2 — the process lines (PURE, no I/O). Every series answers «how far now» and «the first day a count was
 * reached», like lib/quests/achievements countSeries / runSeries. They reward only what the trader controls: the stop
 * respected, no violations, the review done, the plan made, no re-entry right after a loss, lower fees, a better
 * discipline index than his own recent past. Never P&L, trade count or green days. Catalog: docs/achievements/CATALOG.md.
 *
 *   stop_respected   traded days with the daily stop known and the day's worst running net above −stop
 *   contract_days    kept contract days (all time, not in a row)
 *   guard_respected  leak-guard pauses respected (leak_guard_events outcome «complied»)
 *   no_revenge       losing intraday trades in a row NOT followed by an entry within `revengeMinutes` (a run)
 *   clean_week       finished weeks with ≥ cleanWeekMinDays traded days: every stop known and kept, no rule violation /
 *                    logged error, no broken contract, no risk-desk stop
 *   better_week      finished weeks whose mean discipline index beats the trader's own previous 4 weeks by ≥ 5 points
 *                    (≥ 3 scored days in the week, ≥ 8 in the 4 weeks before)
 *   review_week      finished weeks with ≥ cleanWeekMinDays traded days, every one fully reviewed on time
 *   review_month     finished months with ≥ 10 traded days and ≥ 90 % of them fully reviewed on time
 *   plan_month       finished months with ≥ 10 traded days and a plan before the open on ≥ 80 % of them
 *   record_fees      personal-record months: fees per trade below every earlier qualifying month (≥ 50 trades on ≥ 10
 *                    days; needs ≥ 2 earlier qualifying months)
 *   record_r         the same for the mean R per trade (≥ 20 trades with R, ≥ 80 % of the month's trades carry R)
 *   record_discipline the same for the mean discipline index (≥ 10 scored days)
 *   stop_comeback    after a stop day (the daily stop reached or the risk desk's breach), the next `comebackDays` traded
 *                    days all inside the limits and without violations
 *   quiet_comeback   (secret) a comeback whose every day was also fully reviewed on time
 *   clean_quarter    (secret) three clean months in a row
 *   iron_week        (secret) a clean week with a plan before the open and an on-time full review on every traded day
 */
import { addDays } from "../tradingDate";
import { asFullReview, reviewedOnTime, type ReviewDay, type StopDay } from "../daily/badges";
import type { LedgerDay } from "../daily/discipline";

export type ProcTrade = {
  day: string;
  /** Minutes since NY midnight of the entry / the same-day exit; null when unknown. */
  entryMin: number | null;
  exitMin: number | null;
  net: number | null;
  fees: number;
  r: number | null;
  intraday: boolean;
};

export type ScoreDay = { date: string; score: number };

export type ProcessInput = {
  asOf: string;
  ledger: readonly LedgerDay[];
  reviews: readonly ReviewDay[];
  stops: readonly StopDay[];
  plansBeforeOpen: readonly string[];
  violationDays: readonly string[];
  breachDays: readonly string[];
  guardComplied: readonly string[];
  trades: readonly ProcTrade[];
  disciplineDays: readonly ScoreDay[];
  cleanMonths: readonly string[];
  rules: { cleanWeekMinDays: number; revengeMinutes: number; comebackDays: number };
};

export type Series = { current: number; reach: (n: number) => string | null };

const sorted = (a: readonly string[]) => [...a].filter(Boolean).sort();
export function countOf(dates: readonly string[]): Series {
  const d = sorted(dates);
  return { current: d.length, reach: (n) => (n >= 1 ? (d[n - 1] ?? null) : null) };
}

/** Monday of the week of `day` (UTC calendar arithmetic on the NY date). */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}
const fridayOf = (monday: string) => addDays(monday, 4);
const monthOf = (day: string) => day.slice(0, 7);
function lastDayOfMonth(key: string): string {
  const x = new Date(`${key}-01T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + 1, 0);
  return x.toISOString().slice(0, 10);
}

const stopKept = (s: StopDay) => s.limit != null && s.limit > 0 && s.trough > -s.limit;
const stopHit = (s: StopDay) => s.limit != null && s.limit > 0 && s.trough <= -s.limit;

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))!).push(x);
  return m;
}

type Ctx = {
  viol: Set<string>;
  breach: Set<string>;
  broken: Set<string>;
  early: Set<string>;
  onTime: Set<string>;
};
function ctxOf(i: ProcessInput): Ctx {
  return {
    viol: new Set(i.violationDays),
    breach: new Set(i.breachDays),
    broken: new Set(i.ledger.filter((d) => d.outcome === "broken").map((d) => d.date)),
    early: new Set(i.plansBeforeOpen),
    onTime: new Set(i.reviews.map(asFullReview).filter(reviewedOnTime).map((r) => r.date)),
  };
}

/** A traded day inside the limits: stop known and kept, no violation, no broken contract, no risk-desk stop. */
const cleanDay = (s: StopDay, c: Ctx) => stopKept(s) && !c.viol.has(s.date) && !c.broken.has(s.date) && !c.breach.has(s.date);

/** Finished weeks (Friday ≤ asOf) with ≥ minDays traded days, as [friday, days]. */
function finishedWeeks(stops: readonly StopDay[], asOf: string, minDays: number): [string, StopDay[]][] {
  const out: [string, StopDay[]][] = [];
  for (const [mon, days] of [...groupBy(stops, (s) => mondayOf(s.date))].sort(([a], [b]) => a.localeCompare(b))) {
    const fri = fridayOf(mon);
    if (fri > asOf || days.length < minDays) continue;
    out.push([fri, days]);
  }
  return out;
}

export function cleanWeeks(i: ProcessInput, c = ctxOf(i)): string[] {
  return finishedWeeks(i.stops, i.asOf, i.rules.cleanWeekMinDays).filter(([, days]) => days.every((d) => cleanDay(d, c))).map(([fri]) => fri);
}

export function ironWeeks(i: ProcessInput, c = ctxOf(i)): string[] {
  return finishedWeeks(i.stops, i.asOf, i.rules.cleanWeekMinDays)
    .filter(([, days]) => days.every((d) => cleanDay(d, c) && c.early.has(d.date) && c.onTime.has(d.date)))
    .map(([fri]) => fri);
}

export function reviewWeeks(i: ProcessInput, c = ctxOf(i)): string[] {
  return finishedWeeks(i.stops, i.asOf, i.rules.cleanWeekMinDays).filter(([, days]) => days.every((d) => c.onTime.has(d.date))).map(([fri]) => fri);
}

/** Weeks whose mean index beats the previous 4 weeks' daily mean by ≥ margin. */
export function betterWeeks(days: readonly ScoreDay[], asOf: string, margin = 5): string[] {
  const out: string[] = [];
  const weeks = [...groupBy(days, (d) => mondayOf(d.date))].sort(([a], [b]) => a.localeCompare(b));
  for (const [mon, list] of weeks) {
    const fri = fridayOf(mon);
    if (fri > asOf || list.length < 3) continue;
    const from = addDays(mon, -28);
    const prev = days.filter((d) => d.date >= from && d.date < mon);
    if (prev.length < 8) continue;
    const m = list.reduce((s, d) => s + d.score, 0) / list.length;
    const p = prev.reduce((s, d) => s + d.score, 0) / prev.length;
    if (m >= p + margin) out.push(fri);
  }
  return out;
}

/** Finished months with ≥ minDays traded days where `share(days)` ≥ min: the month's last calendar day. */
function goodMonths(stops: readonly StopDay[], asOf: string, ok: (d: StopDay) => boolean, minShare: number, minDays = 10): string[] {
  const out: string[] = [];
  for (const [m, list] of [...groupBy(stops, (s) => monthOf(s.date))].sort(([a], [b]) => a.localeCompare(b))) {
    if (m >= monthOf(asOf) || list.length < minDays) continue;
    if (list.filter(ok).length / list.length >= minShare) out.push(lastDayOfMonth(m));
  }
  return out;
}

export function reviewMonths(i: ProcessInput, c = ctxOf(i)): string[] {
  return goodMonths(i.stops, i.asOf, (d) => c.onTime.has(d.date), 0.9);
}

export function planMonths(i: ProcessInput, c = ctxOf(i)): string[] {
  return goodMonths(i.stops, i.asOf, (d) => c.early.has(d.date), 0.8);
}

/** Three consecutive clean months (the third month's day). */
export function cleanQuarters(cleanMonthDays: readonly string[]): string[] {
  const keys = [...new Set(cleanMonthDays.map(monthOf))].sort();
  const out: string[] = [];
  const next = (k: string) => monthOf(addDays(lastDayOfMonth(k), 1));
  for (let j = 2; j < keys.length; j++) {
    if (next(keys[j - 2]!) === keys[j - 1] && next(keys[j - 1]!) === keys[j]) out.push(cleanMonthDays.find((d) => monthOf(d) === keys[j])!);
  }
  return out;
}

export type MonthStat = { month: string; value: number };

/**
 * Personal records: months (finished) whose value beats every EARLIER qualifying month, once at least `minPrior`
 * earlier months qualify. `better(a, b)` = a is a new record against b.
 */
export function recordMonths(stats: readonly MonthStat[], better: (a: number, b: number) => boolean, minPrior = 2): string[] {
  const out: string[] = [];
  const seen: number[] = [];
  for (const s of [...stats].sort((a, b) => a.month.localeCompare(b.month))) {
    if (seen.length >= minPrior && seen.every((v) => better(s.value, v))) out.push(lastDayOfMonth(s.month));
    seen.push(s.value);
  }
  return out;
}

/** Fees per trade of each finished month with ≥ 50 trades on ≥ 10 days. */
export function feeMonths(trades: readonly ProcTrade[], asOf: string): MonthStat[] {
  const out: MonthStat[] = [];
  for (const [m, list] of groupBy(trades, (t) => monthOf(t.day))) {
    if (m >= monthOf(asOf) || list.length < 50 || new Set(list.map((t) => t.day)).size < 10) continue;
    out.push({ month: m, value: list.reduce((s, t) => s + Math.abs(t.fees), 0) / list.length });
  }
  return out;
}

/** Mean R per trade of each finished month with ≥ 20 R trades that are ≥ 80 % of the month's trades. */
export function rMonths(trades: readonly ProcTrade[], asOf: string): MonthStat[] {
  const out: MonthStat[] = [];
  for (const [m, list] of groupBy(trades, (t) => monthOf(t.day))) {
    const rs = list.map((t) => t.r).filter((r): r is number => r != null && Number.isFinite(r));
    if (m >= monthOf(asOf) || rs.length < 20 || rs.length < 0.8 * list.length) continue;
    out.push({ month: m, value: rs.reduce((s, r) => s + r, 0) / rs.length });
  }
  return out;
}

export function disciplineMonths(days: readonly ScoreDay[], asOf: string): MonthStat[] {
  const out: MonthStat[] = [];
  for (const [m, list] of groupBy(days, (d) => monthOf(d.date))) {
    if (m >= monthOf(asOf) || list.length < 10) continue;
    out.push({ month: m, value: list.reduce((s, d) => s + d.score, 0) / list.length });
  }
  return out;
}

/** Losing intraday trades in a row with no entry within `minutes` after their exit (same day). */
export function noRevengeSeries(trades: readonly ProcTrade[], minutes: number): Series {
  const byDay = groupBy(trades, (t) => t.day);
  const losses = trades
    .filter((t) => t.intraday && t.net != null && t.net < 0 && t.exitMin != null)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.exitMin! - b.exitMin!));
  const points: { date: string; run: number }[] = [];
  let run = 0;
  for (const l of losses) {
    const re = (byDay.get(l.day) ?? []).some((o) => o !== l && o.entryMin != null && o.entryMin > l.exitMin! && o.entryMin <= l.exitMin! + minutes);
    run = re ? 0 : run + 1;
    points.push({ date: l.day, run });
  }
  return { current: run, reach: (n) => points.find((p) => p.run >= n)?.date ?? null };
}

export type Comebacks = {
  /** Day each comeback was completed (the N-th clean day after a stop). */
  done: string[];
  /** …of them, the ones whose every day was also fully reviewed on time. */
  quiet: string[];
  /** The latest stop not yet answered by a comeback: clean days since then (null = none open). */
  open: { since: string; days: number; need: number } | null;
};

/** Stop days and the comeback after each: the next `need` traded days clean; a new stop restarts the count. */
export function comebacksAfterStops(i: ProcessInput, c = ctxOf(i)): Comebacks {
  const need = Math.max(1, i.rules.comebackDays);
  const days = [...i.stops].sort((a, b) => a.date.localeCompare(b.date));
  const done: string[] = [];
  const quiet: string[] = [];
  let since: string | null = null;
  let run = 0;
  let allReviewed = true;
  for (const d of days) {
    const stopped = stopHit(d) || c.breach.has(d.date);
    if (stopped) { since = d.date; run = 0; allReviewed = true; continue; }
    if (since == null) continue;
    if (!cleanDay(d, c)) { run = 0; allReviewed = true; continue; }
    run++;
    allReviewed &&= c.onTime.has(d.date);
    if (run >= need) {
      done.push(d.date);
      if (allReviewed) quiet.push(d.date);
      since = null;
      run = 0;
    }
  }
  return { done, quiet, open: since ? { since, days: run, need } : null };
}

/** Every process series by line id. */
export function processSeries(i: ProcessInput): { series: Record<string, Series>; comebackOpen: Comebacks["open"] } {
  const c = ctxOf(i);
  const cb = comebacksAfterStops(i, c);
  const series: Record<string, Series> = {
    stop_respected: countOf(i.stops.filter(stopKept).map((s) => s.date)),
    contract_days: countOf(i.ledger.filter((d) => d.outcome === "kept").map((d) => d.date)),
    guard_respected: countOf(i.guardComplied),
    no_revenge: noRevengeSeries(i.trades, i.rules.revengeMinutes),
    clean_week: countOf(cleanWeeks(i, c)),
    better_week: countOf(betterWeeks(i.disciplineDays, i.asOf)),
    review_week: countOf(reviewWeeks(i, c)),
    review_month: countOf(reviewMonths(i, c)),
    plan_month: countOf(planMonths(i, c)),
    record_fees: countOf(recordMonths(feeMonths(i.trades, i.asOf), (a, b) => a < b)),
    record_r: countOf(recordMonths(rMonths(i.trades, i.asOf), (a, b) => a > b)),
    record_discipline: countOf(recordMonths(disciplineMonths(i.disciplineDays, i.asOf), (a, b) => a > b)),
    stop_comeback: countOf(cb.done),
    quiet_comeback: countOf(cb.quiet),
    clean_quarter: countOf(cleanQuarters(i.cleanMonths)),
    iron_week: countOf(ironWeeks(i, c)),
  };
  return { series, comebackOpen: cb.open };
}
