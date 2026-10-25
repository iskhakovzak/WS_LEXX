/**
 * «Характеристика» — the eight attributes of a trader's scouting card, 0–100 each. PURE (no I/O), unit-tested
 * (__tests__/profileAttributes.test.ts). Inputs: the closed trades of the scoring window (lib/profile/load, last
 * WINDOW_DAYS calendar days), rule violations, limits and two desk numbers.
 *
 *   discipline  100 · 2^(−violations per active day / 0.25)           0.25 violations a day → 50; no rules → «мало данных»
 *   risk        with limits: ½ · (1 − share of days beyond the daily stop / 10%) + ½ · (1 − (max DD / DD limit − ½) / ½)
 *               without:     (4 − |5th percentile day| / mean |day|) / 3   (a fat left tail lowers it)
 *   stability   0.6 · green-day share + 0.4 · (1 − (SD / mean |day| − 1) / 2)
 *   edge        P(expectancy per trade > 0): day-clustered bootstrap (lib/stats/bootstrap), shrunk to the desk prior
 *               (lib/stats/shrinkage) when one is given
 *   patience    trades per day vs the desk median: ≤ median → 1, each doubling −0.4; minus the share of overtrading
 *               days (more than twice the trader's own median, at least 4 trades)
 *   execution   1 − mean giveback after the intraday peak, (peak − close) / peak over the days that were ever green
 *   recovery    ½ + ¼ · (win rate of the next trade after a loss − overall) / 15 pp + ¼ · (day after a red day − mean day) / ½ SD
 *   growth      P(mean day of the second half of the window > first half): moving-block bootstrap (blockDiffProb)
 *
 * Honesty: every attribute carries its sample and the minimum it needs. Below the minimum it is `low` (the web shows
 * «мало данных», no number); with fewer than 3 units the score is null.
 */
import { blockDiffProb, clusterBootstrapMean, median, quantile, rngFor, shrink, STATS_SEED } from "../stats";
import { ATTR_KEYS, type Archetype, type AttrInput, type AttrKey, type Attribute, type DayAgg, type ProfileSummary, type ProfileTrade } from "./types";

/** Calendar days of the scoring window. */
export const WINDOW_DAYS = 120;
/** Fewer units than this → score null. */
export const MIN_UNITS = 3;
/** Desk median needs this many traders with trusted scores. */
export const DESK_MIN = 3;
/** Bootstrap draws (seeded; small enough for an on-request page). */
export const PROFILE_B = 600;

export const MIN_SAMPLE: Readonly<Record<AttrKey, number>> = {
  discipline: 10, risk: 15, stability: 15, edge: 30, patience: 10, execution: 10, recovery: 15, growth: 15,
};

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const clampSym = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(-1, x)) : 0);
const pct = (x: number) => Math.round(clamp01(x) * 100);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Trades → trading days in order (net, count, wins, losses, intraday peak of the cumulative net). */
export function daysOf(trades: readonly ProfileTrade[]): DayAgg[] {
  const out: DayAgg[] = [];
  let cur: DayAgg | null = null;
  let cum = 0;
  const sorted = [...trades].sort((a, b) => (a.day === b.day ? a.seq - b.seq : a.day < b.day ? -1 : 1));
  for (const t of sorted) {
    if (!cur || cur.day !== t.day) {
      cur = { day: t.day, net: 0, n: 0, wins: 0, losses: 0, peak: Number.NEGATIVE_INFINITY };
      out.push(cur);
      cum = 0;
    }
    cum += t.net;
    cur.net += t.net;
    cur.n += 1;
    if (t.result === "win") cur.wins += 1;
    if (t.result === "loss") cur.losses += 1;
    cur.peak = Math.max(cur.peak, cum);
  }
  for (const d of out) {
    d.net = r2(d.net);
    d.peak = r2(d.peak);
  }
  return out;
}

const sdOf = (xs: readonly number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const meanOf = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Largest peak-to-trough fall of the cumulative daily net ($, ≥ 0). */
export function maxDrawdownOf(nets: readonly number[]): number {
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const v of nets) {
    cum += v;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return r2(dd);
}

type Partial = Omit<Attribute, "key" | "deskMedian" | "minSample" | "low"> & { lowExtra?: boolean };

function finish(key: AttrKey, p: Partial): Attribute {
  const minSample = MIN_SAMPLE[key];
  const score = p.sample < MIN_UNITS ? null : p.score;
  return {
    key, score, sample: p.sample, minSample, unit: p.unit, basis: p.basis, inputs: p.inputs,
    low: p.sample < minSample || !!p.lowExtra || score === null, deskMedian: null,
  };
}

function discipline(days: readonly DayAgg[], x: AttrInput): Attribute {
  const perDay = days.length ? x.violations / days.length : 0;
  const noRules = x.rulesActive === 0 && x.violations === 0;
  return finish("discipline", {
    score: pct(2 ** (-perDay / 0.25)), sample: days.length, unit: "days", basis: noRules ? "noRules" : "violations",
    inputs: { violations: x.violations, perDay: r4(perDay), rules: x.rulesActive }, lowExtra: noRules,
  });
}

function risk(days: readonly DayAgg[], x: AttrInput): Attribute {
  const nets = days.map((d) => d.net);
  const worst = nets.length ? Math.min(0, ...nets) : 0;
  const dd = maxDrawdownOf(nets);
  const daily = x.limits?.dailyLoss && x.limits.dailyLoss > 0 ? x.limits.dailyLoss : null;
  const ddLimit = x.limits?.maxDrawdown && x.limits.maxDrawdown > 0 ? x.limits.maxDrawdown : null;
  if (daily || ddLimit) {
    const breaches = daily ? nets.filter((v) => v <= -daily).length : 0;
    const s1 = daily ? 1 - clamp01((nets.length ? breaches / nets.length : 0) / 0.1) : null;
    const s2 = ddLimit ? 1 - clamp01((dd / ddLimit - 0.5) / 0.5) : null;
    const score = s1 !== null && s2 !== null ? 0.5 * s1 + 0.5 * s2 : (s1 ?? s2 ?? 0);
    return finish("risk", {
      score: pct(score), sample: days.length, unit: "days", basis: "limits",
      inputs: { worstDay: r2(worst), maxDrawdown: dd, dailyLimit: daily, ddLimit, breaches },
    });
  }
  const sorted = [...nets].sort((a, b) => a - b);
  const q05 = sorted.length ? Math.min(0, quantile(sorted, 0.05)) : 0;
  const meanAbs = meanOf(nets.map(Math.abs));
  const tail = meanAbs > 0 ? Math.abs(q05) / meanAbs : 0;
  return finish("risk", {
    score: pct((4 - tail) / 3), sample: days.length, unit: "days", basis: "tail",
    inputs: { worstDay: r2(worst), maxDrawdown: dd, tailRatio: r2(tail) },
  });
}

function stability(days: readonly DayAgg[]): Attribute {
  const nets = days.map((d) => d.net);
  const green = nets.length ? nets.filter((v) => v > 0).length / nets.length : 0;
  const meanAbs = meanOf(nets.map(Math.abs));
  const sd = sdOf(nets);
  const ratio = meanAbs > 0 ? sd / meanAbs : 1;
  const disp = clamp01(1 - (ratio - 1) / 2);
  return finish("stability", {
    score: pct(0.6 * green + 0.4 * disp), sample: days.length, unit: "days", basis: "days",
    inputs: { greenShare: r4(green), sd: r2(sd), meanAbs: r2(meanAbs) },
  });
}

function edge(days: readonly DayAgg[], x: AttrInput): Attribute {
  const trades = days.reduce((s, d) => s + d.n, 0);
  const boot = clusterBootstrapMean(days.map((d) => d.net), days.map((d) => d.n), rngFor(STATS_SEED, "profile-edge", x.seed), PROFILE_B);
  if (!boot) return finish("edge", { score: null, sample: 0, unit: "trades", basis: "bootstrap", inputs: { expectancy: null, lo80: null, hi80: null } });
  let pPos = 1 - boot.pLe0;
  let basis: Attribute["basis"] = "bootstrap";
  let theta: number | null = null;
  if (x.edgePrior && x.edgePrior.tau > 0) {
    const post = shrink(boot.mean, boot.se, x.edgePrior);
    pPos = 1 - post.pNeg;
    theta = r2(post.theta);
    basis = "shrunk";
  }
  return finish("edge", {
    score: pct(pPos), sample: trades, unit: "trades", basis,
    inputs: { expectancy: r2(boot.mean), lo80: r2(boot.lo80), hi80: r2(boot.hi80), shrunk: theta, days: days.length },
    lowExtra: days.length < MIN_SAMPLE.risk,
  });
}

function patience(days: readonly DayAgg[], x: AttrInput): Attribute {
  const trades = days.reduce((s, d) => s + d.n, 0);
  const tpd = days.length ? trades / days.length : 0;
  const desk = x.deskTradesPerDay && x.deskTradesPerDay > 0 ? x.deskTradesPerDay : null;
  const ratio = desk ? tpd / desk : 1;
  const base = ratio <= 1 ? 1 : 1 - clamp01(Math.log2(ratio) * 0.4);
  const own = days.length ? median(days.map((d) => d.n)) : 0;
  const over = days.length ? days.filter((d) => d.n >= 4 && d.n > 2 * own).length / days.length : 0;
  return finish("patience", {
    score: pct(base - over), sample: days.length, unit: "days", basis: "frequency",
    inputs: { tradesPerDay: r2(tpd), deskTradesPerDay: desk === null ? null : r2(desk), overtradeShare: r4(over) },
  });
}

function execution(days: readonly DayAgg[]): Attribute {
  const green = days.filter((d) => d.peak > 0);
  const gb = green.map((d) => clamp01((d.peak - d.net) / d.peak));
  const mean = meanOf(gb);
  return finish("execution", {
    score: pct(1 - mean), sample: green.length, unit: "days", basis: "giveback",
    inputs: { givebackShare: r4(mean), avgPeak: r2(meanOf(green.map((d) => d.peak))) },
  });
}

function recovery(trades: readonly ProfileTrade[], days: readonly DayAgg[]): Attribute {
  const sorted = [...trades].sort((a, b) => (a.day === b.day ? a.seq - b.seq : a.day < b.day ? -1 : 1));
  let pairs = 0;
  let pairWins = 0;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (a.result !== "loss" || a.day !== b.day || b.result === "be") continue;
    pairs++;
    if (b.result === "win") pairWins++;
  }
  const decided = sorted.filter((t) => t.result !== "be");
  const wrAll = decided.length ? decided.filter((t) => t.result === "win").length / decided.length : 0;
  const wrAfter = pairs ? pairWins / pairs : null;
  const nets = days.map((d) => d.net);
  const sd = sdOf(nets);
  const afterRed: number[] = [];
  for (let i = 0; i + 1 < days.length; i++) if (days[i]!.net < 0) afterRed.push(days[i + 1]!.net);
  const meanAll = meanOf(nets);
  const dTrade = wrAfter === null ? 0 : clampSym((wrAfter - wrAll) / 0.15);
  const dDay = afterRed.length >= 3 && sd > 0 ? clampSym((meanOf(afterRed) - meanAll) / (0.5 * sd)) : null;
  const score = dDay === null ? 0.5 + 0.5 * dTrade : 0.5 + 0.25 * dTrade + 0.25 * dDay;
  return finish("recovery", {
    score: pct(score), sample: pairs, unit: "pairs", basis: "afterLoss",
    inputs: {
      winRateAfterLoss: wrAfter === null ? null : r4(wrAfter), winRate: r4(wrAll),
      afterRedDay: afterRed.length ? r2(meanOf(afterRed)) : null, avgDay: r2(meanAll), redDays: afterRed.length,
    },
  });
}

function growth(days: readonly DayAgg[], seed: string): Attribute {
  const nets = days.map((d) => d.net);
  const half = Math.floor(nets.length / 2);
  const prev = nets.slice(0, half);
  const recent = nets.slice(nets.length - half);
  const p = blockDiffProb(recent, prev, rngFor(STATS_SEED, "profile-growth", seed), { B: PROFILE_B });
  return finish("growth", {
    score: p === null ? null : pct(p), sample: half, unit: "days", basis: "trend",
    inputs: { prevAvg: prev.length ? r2(meanOf(prev)) : null, recentAvg: recent.length ? r2(meanOf(recent)) : null, pImprove: p === null ? null : r4(p) },
  });
}

/** All eight attributes of one trader (deskMedian left null — see withDeskMedians). */
export function scoreAttributes(x: AttrInput): Attribute[] {
  const days = daysOf(x.trades);
  const byKey: Record<AttrKey, Attribute> = {
    discipline: discipline(days, x),
    risk: risk(days, x),
    stability: stability(days),
    edge: edge(days, x),
    patience: patience(days, x),
    execution: execution(days),
    recovery: recovery(x.trades, days),
    growth: growth(days, x.seed),
  };
  return ATTR_KEYS.map((k) => byKey[k]);
}

/** Median trusted score per attribute over the desk; null with fewer than DESK_MIN trusted traders. */
export function deskMedians(desk: readonly (readonly Attribute[])[]): Record<AttrKey, number | null> {
  const out = {} as Record<AttrKey, number | null>;
  for (const k of ATTR_KEYS) {
    const scores = desk.map((list) => list.find((a) => a.key === k)).filter((a): a is Attribute => !!a && !a.low && a.score !== null).map((a) => a.score!);
    out[k] = scores.length >= DESK_MIN ? Math.round(median(scores)) : null;
  }
  return out;
}

export function withDeskMedians(list: readonly Attribute[], medians: Record<AttrKey, number | null>): Attribute[] {
  return list.map((a) => ({ ...a, deskMedian: medians[a.key] ?? null }));
}

/** Style archetype from the trades: hold time and horizon mix. */
export function archetypeOf(trades: readonly ProfileTrade[]): Archetype {
  if (trades.length < 10) return "newcomer";
  const holds = trades.map((t) => t.holdSec).filter((v): v is number => v !== null && v >= 0);
  const intraday = trades.filter((t) => t.horizon === "intraday").length / trades.length;
  const swing = trades.filter((t) => t.horizon === "swing").length / trades.length;
  if (swing >= 0.3) return "swing";
  if (intraday >= 0.8 && holds.length && median(holds) < 120) return "scalper";
  if (intraday >= 0.8) return "daytrader";
  return "mixed";
}

/** The one-line «характеристика»: archetype, the two strongest and the weakest trusted attributes. */
export function summaryOf(attrs: readonly Attribute[], trades: readonly ProfileTrade[]): ProfileSummary {
  const trusted = attrs.filter((a) => !a.low && a.score !== null).sort((a, b) => b.score! - a.score! || ATTR_KEYS.indexOf(a.key) - ATTR_KEYS.indexOf(b.key));
  const top = trusted.filter((a) => a.score! >= 60).slice(0, 2).map((a) => a.key);
  const last = trusted[trusted.length - 1];
  const weak = last && last.score! < 60 && !top.includes(last.key) ? last.key : null;
  return { archetype: archetypeOf(trades), top, weak, lowData: trusted.length < 4 };
}

/** Median trades per active day of each trader → the desk median (null with fewer than DESK_MIN traders). */
export function deskTradesPerDay(perTrader: readonly (readonly ProfileTrade[])[]): number | null {
  const rates = perTrader
    .map((ts) => {
      const days = new Set(ts.map((t) => t.day)).size;
      return days >= MIN_SAMPLE.patience ? ts.length / days : null;
    })
    .filter((v): v is number => v !== null);
  return rates.length >= DESK_MIN ? r2(median(rates)) : null;
}
