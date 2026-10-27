/**
 * «Цена джуна до безубытка» — one junior's path (pure, seeded; tests in lib/__tests__/juniorCost.test.ts).
 *
 * Definitions (owner brief 2026-10-27):
 *   Start        min(first closed trade day, academy start); academy start = the earliest live enrolment's cohort
 *                starts_on or its joined_on (training time costs the desk a seat too). startSource says which won.
 *   Curve        cumulative NET P&L (pnl − |fees|) over the junior's own trading days (days with a closed trade).
 *   Breakeven    the first own trading day d_k on which the cumulative net is ≥ 0 AND it stays ≥ 0 on every own trading
 *                day of a window of `stableDays` (default 20) starting there. Own trading days, not calendar days: on a
 *                day without trades the curve cannot move, so it proves nothing. A curve that is ≥ 0 from day one breaks
 *                even on day one (cost 0). Breakeven is judged on the trading result alone — the seat cost below is a
 *                desk expense added to the price, not a bar the junior has to clear (it would make the definition
 *                depend on an admin setting).
 *   Provisional  the curve is ≥ 0 now but for fewer than `stableDays` own trading days — not confirmed yet.
 *   Relapsed     reached breakeven, but the curve is below 0 again today (shown, the breakeven stays).
 *   Cost         trading cost = the deepest cumulative net loss before breakeven (to date when not reached, 0 when the
 *                curve never went below 0); it splits exactly into the fees paid and the gross result at that deepest
 *                point (cost = fees − gross). Seat cost = seatUsdMonth × months from start to breakeven (to the last
 *                trade for a stopped junior, to asOf otherwise). Total = trading + seat.
 *   Days         calendar days and weekdays (holidays not excluded) from start to the breakeven day; own trading days.
 *   Stopped      not at breakeven and (deactivated / banned / enrolment dropped, or no trade for `stopDays` calendar
 *                days, default 30).
 *   Insufficient not at breakeven with fewer than MIN_ACTIVE_DAYS own trading days: «недостаточно данных».
 *   Truncated    the start comes from the first trade and that trade lies within TRUNCATE_GRACE_DAYS of the desk's first
 *                trade in the database: the real start is before the data, so the path is shown but left out of every
 *                desk statistic.
 *   Projection   (status «below» only) the mean daily net of the last PROJ_DAYS own trading days with a moving-block
 *                bootstrap 80% interval; own trading days to cover the deficit = deficit / mean, the interval from the
 *                bootstrap bounds (the upper bound is open when the lower mean is ≤ 0, or beyond PROJ_MAX_DAYS);
 *                converted to dates through the junior's own pace (own trading days per weekday since start).
 *                «notImproving» when the mean is ≤ 0, «insufficient» with fewer than PROJ_MIN_DAYS days in the window.
 *                Crossing zero is projected; the stable window still has to follow.
 */
import { addWeekdays, weekdaysBetween } from "../plateau";
import { blockBootstrapMean, rngFor, STATS_SEED } from "../stats";
import { addDays } from "../tradingDate";

export const STABLE_DAYS_DEFAULT = 20;
export const MIN_ACTIVE_DAYS = 5;
export const STOP_DAYS_DEFAULT = 30;
export const TRUNCATE_GRACE_DAYS = 7;
export const PROJ_DAYS = 20;
export const PROJ_MIN_DAYS = 10;
export const PROJ_MAX_DAYS = 750;
export const DAYS_PER_MONTH = 30.4375;

export type DayPnl = { day: string; net: number; fees: number; gross: number };

export type JuniorInput = {
  name: string;
  /** Own trading days (any order; one row per NY day). */
  days: readonly DayPnl[];
  /** Earliest academy start (cohort starts_on / joined_on), YYYY-MM-DD. */
  academyStart: string | null;
  /** Deactivated, banned or enrolment dropped. */
  deactivated: boolean;
};

export type PathOpts = {
  asOf: string;
  stableDays?: number;
  seatUsdMonth?: number;
  stopDays?: number;
  /** The desk's first trade day in the database (truncation check); null = never truncated. */
  deskFirstDay?: string | null;
  /** Bootstrap draws of the projection (tests use fewer). */
  B?: number;
};

export type JuniorStatus = "reached" | "provisional" | "below" | "stopped" | "insufficient";

export type CurvePoint = { day: string; net: number; cum: number };
export type Interval = { point: number; lo: number; hi: number };

export type Projection =
  | {
    kind: "eta";
    window: number;
    meanNet: Interval;
    /** Own trading days to cover the deficit; hi null = open. */
    days: { point: number; lo: number; hi: number | null };
    /** Calendar estimate through the junior's pace; to null = open. */
    eta: { from: string; point: string; to: string | null };
  }
  | { kind: "notImproving"; window: number; meanNet: Interval }
  | { kind: "insufficient"; window: number };

export type JuniorCost = { trading: number; fees: number; gross: number; seat: number; total: number; months: number };

export type JuniorPath = {
  name: string;
  start: string | null;
  startSource: "academy" | "trade" | null;
  firstTrade: string | null;
  lastTrade: string | null;
  status: JuniorStatus;
  truncated: boolean;
  /** Own trading days to breakeven (reached) or to date. */
  activeDays: number;
  breakeven: { day: string; confirmedOn: string; calendarDays: number; tradingDays: number; activeDays: number } | null;
  /** Own trading days ≥ 0 in the current run (provisional), of `stableDays`. */
  provisionalDays: number;
  stableDays: number;
  relapsed: boolean;
  /** Deepest point before breakeven (to date when not reached); null when the curve never went below 0. */
  trough: { day: string; cum: number; fees: number; gross: number } | null;
  cost: JuniorCost;
  /** Cumulative net today and fees paid so far (all days). */
  current: number;
  feesToDate: number;
  /** Weekdays from start to asOf (the censoring time of a junior not at breakeven). */
  tenureTradingDays: number;
  projection: Projection | null;
  curve: CurvePoint[];
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const calendarDaysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const minDay = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);

/** First index k where cum ≥ 0 on k … k + W − 1 (all present); the current non-negative run otherwise. */
export function findBreakeven(cum: readonly number[], W: number): { index: number | null; runStart: number | null; runLength: number } {
  let runStart: number | null = null;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] >= 0) {
      if (runStart == null) runStart = i;
      if (i - runStart + 1 >= W) return { index: runStart, runStart, runLength: i - runStart + 1 };
    } else {
      runStart = null;
    }
  }
  return { index: null, runStart, runLength: runStart == null ? 0 : cum.length - runStart };
}

function project(days: readonly DayPnl[], current: number, start: string, asOf: string, name: string, B: number): Projection {
  const recent = days.slice(-PROJ_DAYS).map((d) => d.net);
  if (recent.length < PROJ_MIN_DAYS) return { kind: "insufficient", window: recent.length };
  const boot = blockBootstrapMean(recent, rngFor(STATS_SEED, "juniorCost", name), { B })!;
  const meanNet = { point: r2(boot.mean), lo: r2(boot.lo80), hi: r2(boot.hi80) };
  if (!(boot.mean > 0)) return { kind: "notImproving", window: recent.length, meanNet };
  const deficit = -current;
  const point = Math.ceil(deficit / boot.mean);
  const lo = Math.ceil(deficit / Math.max(boot.hi80, boot.mean));
  const hiRaw = boot.lo80 > 0 ? Math.ceil(deficit / boot.lo80) : null;
  const hi = hiRaw != null && hiRaw <= PROJ_MAX_DAYS ? hiRaw : null;
  if (point > PROJ_MAX_DAYS) return { kind: "notImproving", window: recent.length, meanNet };
  // Own trading days per weekday since start (at least one in twenty, at most every day).
  const span = Math.max(1, weekdaysBetween(start, asOf) + 1);
  const pace = Math.min(1, Math.max(0.05, days.length / span));
  const toDate = (n: number) => addWeekdays(asOf, Math.ceil(n / pace));
  return { kind: "eta", window: recent.length, meanNet, days: { point, lo, hi }, eta: { from: toDate(lo), point: toDate(point), to: hi == null ? null : toDate(hi) } };
}

/** One junior's path, breakeven and price (see the header for every definition). */
export function juniorPath(x: JuniorInput, o: PathOpts): JuniorPath {
  const W = Math.max(1, Math.round(o.stableDays ?? STABLE_DAYS_DEFAULT));
  const seatUsdMonth = Math.max(0, o.seatUsdMonth ?? 0);
  const stopDays = o.stopDays ?? STOP_DAYS_DEFAULT;
  const days = [...x.days].filter((d) => d.day <= o.asOf && Number.isFinite(d.net)).sort((a, b) => a.day.localeCompare(b.day));
  const firstTrade = days[0]?.day ?? null;
  const lastTrade = days[days.length - 1]?.day ?? null;
  const academy = x.academyStart && x.academyStart <= o.asOf ? x.academyStart : null;
  const start = minDay(academy, firstTrade);
  const startSource = start == null ? null : academy != null && academy === start ? "academy" : "trade";
  const truncated = startSource === "trade" && !!o.deskFirstDay && !!firstTrade && firstTrade <= addDays(o.deskFirstDay, TRUNCATE_GRACE_DAYS);

  const curve: CurvePoint[] = [];
  const cumFees: number[] = [];
  const cumGross: number[] = [];
  let c = 0, f = 0, g = 0;
  for (const d of days) {
    c += d.net; f += d.fees; g += d.gross;
    curve.push({ day: d.day, net: r2(d.net), cum: r2(c) });
    cumFees.push(f); cumGross.push(g);
  }
  const cum = curve.map((p) => p.cum);
  const be = findBreakeven(cum, W);
  const reached = be.index != null;
  const upto = reached ? be.index! : days.length; // trough is searched strictly before the breakeven day
  let troughIdx = -1;
  for (let i = 0; i < upto; i++) if (cum[i] < 0 && (troughIdx < 0 || cum[i] < cum[troughIdx])) troughIdx = i;
  const trough = troughIdx < 0 ? null : { day: days[troughIdx].day, cum: cum[troughIdx], fees: r2(cumFees[troughIdx]), gross: r2(cumGross[troughIdx]) };

  const current = cum.length ? cum[cum.length - 1] : 0;
  const quiet = lastTrade != null && calendarDaysBetween(lastTrade, o.asOf) > stopDays;
  const status: JuniorStatus = reached ? "reached"
    : x.deactivated || quiet ? "stopped"
    : days.length < MIN_ACTIVE_DAYS ? "insufficient"
    : current >= 0 ? "provisional"
    : "below";

  const beDay = reached ? days[be.index!].day : null;
  const end = beDay ?? (status === "stopped" ? lastTrade ?? start : o.asOf);
  const months = start && end && end >= start ? calendarDaysBetween(start, end) / DAYS_PER_MONTH : 0;
  const trading = trough ? r2(-trough.cum) : 0;
  const seat = r2(seatUsdMonth * months);
  const cost: JuniorCost = { trading, fees: trough?.fees ?? 0, gross: trough?.gross ?? 0, seat, total: r2(trading + seat), months: Math.round(months * 10) / 10 };

  return {
    name: x.name, start, startSource, firstTrade, lastTrade, status, truncated,
    activeDays: reached ? be.index! + 1 : days.length,
    breakeven: reached && start ? {
      day: beDay!, confirmedOn: days[be.index! + W - 1].day,
      calendarDays: calendarDaysBetween(start, beDay!), tradingDays: weekdaysBetween(start, beDay!), activeDays: be.index! + 1,
    } : null,
    provisionalDays: !reached && current >= 0 ? be.runLength : 0,
    stableDays: W,
    relapsed: reached && current < 0,
    trough, cost,
    current: r2(current),
    feesToDate: r2(f),
    tenureTradingDays: start ? Math.max(0, weekdaysBetween(start, status === "stopped" ? lastTrade ?? start : o.asOf)) : 0,
    projection: status === "below" && start ? project(days, current, start, o.asOf, x.name, o.B ?? 1000) : null,
    curve,
  };
}
