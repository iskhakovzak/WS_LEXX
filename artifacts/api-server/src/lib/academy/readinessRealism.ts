/**
 * Readiness realism (roadmap R1; owner 2026-10-24: «не заменять, просто ещё добавить» — win rate ≥ 48 stays, these come
 * on top). Pure; used by lib/promotionEngine.
 *
 *   edge_margin_pp    WR − breakeven WR of the trader's own payoff, percentage points (lib/breakeven); null with < 5
 *                     wins or losses (the criterion then fails)
 *   expectancy_lb     20th percentile of the per-trade net mean, day-clustered bootstrap (B = 1000, seed COACH_SEED) —
 *                     one lucky window cannot promote
 *   binding constraint the one failing criterion to work on: «infeasible_style» (never met in any window of the last
 *                     INFEASIBLE_LOOKBACK trading days — curator review) first, then the smallest expected days to close
 *                     (gap ÷ the improvement per day vs the previous equal window); kind money | process
 *   stage days        trading days on the stage → info ≥ 120, curator ≥ 250, admin ≥ 500
 *   pace              «need $X/day (target ÷ window); now $Y/day (80 %: lo–hi)» — no ETA date, no pass probability (it is
 *                     shown only once a desk-wide backtest beats the base rate, R13)
 */
import { edgeMargin } from "../breakeven";
import { COACH_SEED, dayClusterQuantile } from "../stats/dayBootstrap";
import { mulberry32 } from "../behaviorStats";
import { quantileSorted } from "../whatIfTypes";
import { addDays, compare, isWeekend, type Op } from "../scalingEngine";
import type { MetricOut, PromoMetricKey, MetricSource } from "../promotionEngine";

type T = (key: string, params?: Record<string, string | number>) => string;

// ─── the two added metrics ──────────────────────────────────────────────────

export function edgeMarginMetric(rows: readonly { net: number | null }[], t: T): MetricOut {
  const m = edgeMargin(rows.map((r) => r.net));
  return m ? { value: m.marginPp, note: t("notes.edgeMargin", { wr: m.winRate.toFixed(1), be: m.breakevenWr.toFixed(1) }) } : { value: null, note: t("notes.fewSides") };
}

export function expectancyLbMetric(rows: readonly { date: string; net: number | null }[], t: T, iters = 1000, seed = COACH_SEED): MetricOut {
  const days = new Map<string, { num: number; den: number }>();
  for (const r of rows) {
    if (r.net == null) continue;
    const d = days.get(r.date) ?? { num: 0, den: 0 };
    d.num += r.net; d.den += 1;
    days.set(r.date, d);
  }
  const lb = dayClusterQuantile([...days.values()], 0.2, iters, seed);
  return lb == null ? { value: null, note: t("notes.fewDays") } : { value: Math.round(lb * 100) / 100, note: t("notes.expectancyLb", { days: days.size }) };
}

// ─── stage days ─────────────────────────────────────────────────────────────

export const STAGE_DAY_SIGNALS = { info: 120, curator: 250, admin: 500 } as const;
export type StageSignal = keyof typeof STAGE_DAY_SIGNALS;

export function stageSignalOf(stageDays: number | null): StageSignal | null {
  if (stageDays == null) return null;
  if (stageDays >= STAGE_DAY_SIGNALS.admin) return "admin";
  if (stageDays >= STAGE_DAY_SIGNALS.curator) return "curator";
  if (stageDays >= STAGE_DAY_SIGNALS.info) return "info";
  return null;
}

// ─── binding constraint ─────────────────────────────────────────────────────

export const INFEASIBLE_LOOKBACK = 250;
/** Window ends sampled every STEP trading days over the lookback; a verdict needs MIN_WINDOWS windows with trades. */
export const INFEASIBLE_STEP = 5;
export const INFEASIBLE_MIN_WINDOWS = 10;

export type BindingKind = "infeasible_style" | "money" | "process";

export type BindingConstraint = {
  metric: PromoMetricKey;
  label: string;
  kind: BindingKind;
  display: string;
  targetDisplay: string;
  /** |target − value| in the metric's unit (null without a value). */
  gap: number | null;
  /** Expected trading days to close the gap at the current improvement (null: not improving / no value). */
  daysToClose: number | null;
  /** infeasible_style: windows checked over the lookback (none met the target). */
  neverMetWindows: number | null;
  advice: string | null;
};

export type FailingCriterion = {
  metric: PromoMetricKey; label: string; op: Op; target: number; windowDays: number; source: MetricSource;
  value: number | null; prevValue: number | null; display: string; targetDisplay: string; advice: string | null;
};

/** Window ends of the infeasibility scan: every STEP-th weekday back over the lookback, today first. */
export function scanEnds(today: string, lookback = INFEASIBLE_LOOKBACK, step = INFEASIBLE_STEP): string[] {
  const out: string[] = [];
  let d = today, k = 0;
  while (k < lookback) {
    if (!isWeekend(d)) { if (k % step === 0) out.push(d); k++; }
    d = addDays(d, -1);
  }
  return out;
}

/** Money: what the P&L numbers decide; process: counts, discipline, learning, exams. */
export function bindingKindOf(metric: PromoMetricKey, source: MetricSource): Exclude<BindingKind, "infeasible_style"> {
  return source === "trades" && metric !== "trading_days" && metric !== "trades" && metric !== "limit_breaches" ? "money" : "process";
}

/**
 * The one criterion to work on. `windowValue(metric, n, end)` = the metric over n trading days ending `end`, plus whether
 * that window had trades (only those windows count for «never met»).
 */
export function bindingConstraintOf(
  failing: readonly FailingCriterion[],
  windowValue: (metric: PromoMetricKey, n: number, end: string) => { value: number | null; traded: boolean },
  today: string,
): BindingConstraint | null {
  if (!failing.length) return null;
  const ends = scanEnds(today);
  const ranked = failing.map((c, i) => {
    let never: number | null = null;
    if (c.source === "trades" || c.source === "rules") {
      let windows = 0, met = false;
      for (const end of ends) {
        const w = windowValue(c.metric, c.windowDays, end);
        if (!w.traded) continue;
        windows++;
        if (w.value != null && compare(w.value, c.op, c.target)) { met = true; break; }
      }
      if (!met && windows >= INFEASIBLE_MIN_WINDOWS) never = windows;
    }
    const gap = c.value == null ? null : Math.abs(c.target - c.value);
    const towards = c.op === ">=" || c.op === ">" ? 1 : c.op === "<=" || c.op === "<" ? -1 : Math.sign(c.target - (c.value ?? c.target));
    const rate = c.value != null && c.prevValue != null ? ((c.value - c.prevValue) * towards) / Math.max(1, c.windowDays) : null;
    const days = gap != null && rate != null && rate > 1e-9 ? Math.ceil(gap / rate) : null;
    return { c, i, never, gap, days };
  });
  ranked.sort((a, b) =>
    (a.never != null ? 0 : 1) - (b.never != null ? 0 : 1)
    || (a.days ?? Number.POSITIVE_INFINITY) - (b.days ?? Number.POSITIVE_INFINITY)
    || a.i - b.i);
  const top = ranked[0];
  return {
    metric: top.c.metric, label: top.c.label, kind: top.never != null ? "infeasible_style" : bindingKindOf(top.c.metric, top.c.source),
    display: top.c.display, targetDisplay: top.c.targetDisplay, gap: top.gap == null ? null : Math.round(top.gap * 100) / 100,
    daysToClose: top.days, neverMetWindows: top.never, advice: top.c.advice,
  };
}

// ─── pace ───────────────────────────────────────────────────────────────────

export type Pace = {
  target: number;
  windowDays: number;
  needPerDay: number;
  nowPerDay: number;
  /** 80 % interval of the daily mean (moving-block bootstrap, blocks of 5 days, seeded). */
  lo80: number | null;
  hi80: number | null;
};

/** The net-P&L pace over the window: `daily` = net of each of the window's n weekdays (0 without trades). */
export function paceOf(target: number, daily: readonly number[], iters = 1000, seed = COACH_SEED, block = 5): Pace {
  const n = daily.length;
  const mean = n ? daily.reduce((a, b) => a + b, 0) / n : 0;
  let lo: number | null = null, hi: number | null = null;
  if (n >= 2 * block) {
    const rnd = mulberry32(seed);
    const means: number[] = [];
    for (let b = 0; b < iters; b++) {
      let s = 0, k = 0;
      while (k < n) {
        const start = Math.floor(rnd() * (n - block + 1));
        for (let j = 0; j < block && k < n; j++, k++) s += daily[start + j];
      }
      means.push(s / n);
    }
    means.sort((a, b) => a - b);
    lo = quantileSorted(means, 0.1);
    hi = quantileSorted(means, 0.9);
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { target, windowDays: n, needPerDay: r2(target / Math.max(1, n)), nowPerDay: r2(mean), lo80: lo == null ? null : r2(lo), hi80: hi == null ? null : r2(hi) };
}
