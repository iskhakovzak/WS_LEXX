/**
 * «Сравнение с собой» — this period vs the previous one, per key metric, with day-clustered bootstrap intervals of
 * each period and of the difference (independent resamples of the two periods' days). Pure.
 *
 *   expectancy   net $ / trade                      winRate   wins ÷ (wins + losses)
 *   payoff       mean win ÷ |mean loss|            feesShare fees ÷ gross profit of the winning trades
 *   tradesPerDay trades ÷ trading days             holdMin   mean holding time, minutes (intraday trades with a time)
 * «changed» = the 80 % interval of the difference excludes 0 and both periods have ME_MIN_DAYS days.
 */
import { ME_ITERS, ME_LEVEL, ME_MIN_DAYS, meHashSeed, meInterval, meResampleDays, type MeInterval } from "../stats/myEdgeStats";
import { winRateOf } from "../coreMetrics/kpi";

export const COMPARE_METRICS = ["expectancy", "winRate", "payoff", "feesShare", "tradesPerDay", "holdMin"] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

export type CompareTrade = { day: string; net: number; gross: number; fees: number; holdSec: number | null; overnight: boolean | null };

type DayUnit = {
  n: number; sum: number; wins: number; losses: number; winSum: number; lossSum: number;
  fees: number; grossWins: number; holdSum: number; holdN: number;
};

function unitsOf(trades: readonly CompareTrade[]): DayUnit[] {
  const by = new Map<string, DayUnit>();
  for (const t of trades) {
    let u = by.get(t.day);
    if (!u) { u = { n: 0, sum: 0, wins: 0, losses: 0, winSum: 0, lossSum: 0, fees: 0, grossWins: 0, holdSum: 0, holdN: 0 }; by.set(t.day, u); }
    u.n++;
    u.sum += t.net;
    if (t.net > 0) { u.wins++; u.winSum += t.net; }
    if (t.net < 0) { u.losses++; u.lossSum += t.net; }
    u.fees += Math.abs(t.fees);
    if (t.gross > 0) u.grossWins += t.gross;
    if (t.holdSec != null && t.holdSec >= 0 && t.overnight !== true) { u.holdSum += t.holdSec / 60; u.holdN++; }
  }
  return [...by.values()];
}

type Tot = DayUnit & { days: number };

function total(units: readonly DayUnit[], pick?: readonly number[]): Tot {
  const t: Tot = { n: 0, sum: 0, wins: 0, losses: 0, winSum: 0, lossSum: 0, fees: 0, grossWins: 0, holdSum: 0, holdN: 0, days: 0 };
  const idx = pick ?? units.map((_, i) => i);
  for (const i of idx) {
    const u = units[i]!;
    t.n += u.n; t.sum += u.sum; t.wins += u.wins; t.losses += u.losses; t.winSum += u.winSum; t.lossSum += u.lossSum;
    t.fees += u.fees; t.grossWins += u.grossWins; t.holdSum += u.holdSum; t.holdN += u.holdN;
    t.days++;
  }
  return t;
}

export function metricOf(m: CompareMetric, t: Tot): number | null {
  switch (m) {
    case "expectancy": return t.n ? t.sum / t.n : null;
    case "winRate": return winRateOf(t.wins, t.losses);
    case "payoff": return t.wins && t.losses && t.lossSum < 0 ? (t.winSum / t.wins) / (Math.abs(t.lossSum) / t.losses) : null;
    case "feesShare": return t.grossWins > 0 ? t.fees / t.grossWins : null;
    case "tradesPerDay": return t.days ? t.n / t.days : null;
    case "holdMin": return t.holdN ? t.holdSum / t.holdN : null;
  }
}

export type CompareRow = {
  metric: CompareMetric;
  current: MeInterval | null;
  previous: MeInterval | null;
  diff: MeInterval | null;
  changed: boolean;
};

export type CompareResult = { days: { current: number; previous: number }; trades: { current: number; previous: number }; rows: CompareRow[] };

const round = (m: CompareMetric, v: number) => (m === "winRate" || m === "feesShare" ? Math.round(v * 10000) / 10000 : Math.round(v * 100) / 100);
const fix = (m: CompareMetric, i: MeInterval | null): MeInterval | null => (i ? { point: round(m, i.point), lo: round(m, i.lo), hi: round(m, i.hi) } : null);

export function compareSelf(cur: readonly CompareTrade[], prev: readonly CompareTrade[], opts: { iters?: number; level?: number; seed?: string } = {}): CompareResult {
  const level = opts.level ?? ME_LEVEL;
  const iters = opts.iters ?? Math.round(ME_ITERS / 2);
  const uc = unitsOf(cur);
  const up = unitsOf(prev);
  const base = opts.seed ?? "compare";
  const rows: CompareRow[] = COMPARE_METRICS.map((metric) => {
    const stat = (pick: readonly number[], units: readonly DayUnit[]) => metricOf(metric, total(units, pick));
    // The SAME seed for both periods' draws would correlate them; the metric name keeps every metric reproducible.
    const dc = meResampleDays(uc, stat, meHashSeed(`${base}|cur|${metric}|${cur.length}`), iters);
    const dp = meResampleDays(up, stat, meHashSeed(`${base}|prev|${metric}|${prev.length}`), iters);
    const pc = metricOf(metric, total(uc));
    const pp = metricOf(metric, total(up));
    const current = pc == null ? null : meInterval(dc, pc, level);
    const previous = pp == null ? null : meInterval(dp, pp, level);
    let diff: MeInterval | null = null;
    if (pc != null && pp != null && dc.length && dp.length) {
      const k = Math.min(dc.length, dp.length);
      const dd = new Float64Array(k);
      for (let i = 0; i < k; i++) dd[i] = dc[i]! - dp[i]!;
      diff = meInterval(dd, pc - pp, level);
    }
    const enough = uc.length >= ME_MIN_DAYS && up.length >= ME_MIN_DAYS;
    const changed = !!diff && enough && (diff.lo > 0 || diff.hi < 0);
    return { metric, current: fix(metric, current), previous: fix(metric, previous), diff: fix(metric, diff), changed };
  });
  return { days: { current: uc.length, previous: up.length }, trades: { current: cur.length, previous: prev.length }, rows };
}
