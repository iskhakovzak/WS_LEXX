/**
 * Insight tiles — the «so what» layer over the buckets of ./model: for each tile the key number, its comparison to the
 * trader's own baseline, an 80% day-clustered interval with a confidence label (lib/stats-lite), the trend versus the
 * previous equal period and the What-if rule that tests the fix. Pure; the components only phrase and draw it.
 *
 * Counting rules are the model's: streaks follow the colours the trader sees (break-even range), every analytic tile
 * counts win / loss by the net sign («Разрезы» result), so a drill shows exactly the trades a tile counted.
 */
import { breakevenWinRate, netPnl, horizonOf, feesOf, grossPnl, winRateOf } from "@/lib/trade-math";
import { resultKeyOf, seqKeyOf } from "@/lib/trade-facets";
import { confidenceOf, dayBootstrap, median, trendOf, type Confidence, type Interval, type Trend } from "@/lib/stats-lite";
import type { Rule } from "@/components/shared/what-if-rules";
import {
  byRealisation, closedOnly, daySequenceOf, realisedDay, round2, seqStats, shownOutcome, streaksOf, weekdayKey, weekdayStats,
  winRateOfBucket, type Bucket, type InsightTrade, type Streaks,
} from "./model";

/** Sample floors: under them a tile says «мало данных» (with the count) instead of a verdict. */
export const TILE_MIN = {
  streakTrades: 3,
  seqTrades: 10,
  afterEach: 8,
  holdEach: 8,
  weekdayTrades: 15,
  feeTrades: 15,
  /** Days a claim needs (a bootstrap over 2–3 days is not an interval). */
  days: 4,
} as const;

export type Claim = { ci: Interval | null; confidence: Confidence };
type Example = { id: number; ticker: string; net: number };

const avgOf = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Average net of the winners and of the losers (both as signed $). */
function winLoss(nets: readonly number[]) {
  const w = nets.filter((x) => x > 0), l = nets.filter((x) => x < 0);
  return { wins: w.length, losses: l.length, avgWin: avgOf(w), avgLoss: avgOf(l) };
}

function examples(trades: readonly InsightTrade[]): { best: Example | null; worst: Example | null } {
  let best: Example | null = null, worst: Example | null = null;
  for (const t of trades) {
    const net = netPnl(t);
    if (net == null) continue;
    if (net > 0 && (!best || net > best.net)) best = { id: t.id, ticker: t.ticker, net: round2(net) };
    if (net < 0 && (!worst || net < worst.net)) worst = { id: t.id, ticker: t.ticker, net: round2(net) };
  }
  return { best, worst };
}

const daysOf = (trades: readonly InsightTrade[]) => new Set(trades.map(realisedDay)).size;

/* ─────────────────────────────── «Серия» ─────────────────────────────── */

export type StreakInsight = Streaks & {
  /** Net of the current run, break-evens inside it included. */
  worth: number | null;
  /** Day the current run started. */
  since: string | null;
  /** Trades of the current run (oldest first). */
  ids: number[];
};

export function streakInsight(trades: readonly InsightTrade[], beRange: number): StreakInsight {
  const s = streaksOf(trades, beRange);
  const list = byRealisation(trades).filter((t) => shownOutcome(t, beRange) != null);
  let start = list.length;
  if (s.current.type !== "none") {
    let seen = 0;
    for (let i = list.length - 1; i >= 0 && seen < s.current.count; i--) {
      const o = shownOutcome(list[i], beRange);
      if (o === s.current.type) seen++;
      start = i;
    }
  }
  const run = list.slice(start);
  const nets = run.map((t) => netPnl(t)).filter((x): x is number => x != null);
  return {
    ...s,
    worth: nets.length ? round2(nets.reduce((a, b) => a + b, 0)) : null,
    since: run.length ? realisedDay(run[0]) : null,
    ids: run.map((t) => t.id),
  };
}

/* ─────────────────────── «Номер сделки в дне» ─────────────────────── */

type SeqRow = { day: string; key: string; net: number };

function seqRows(trades: readonly InsightTrade[]): SeqRow[] {
  const closed = closedOnly(trades);
  const fb = closed.some((t) => t.daySeq == null) ? daySequenceOf(closed) : null;
  return closed.map((t) => ({ day: realisedDay(t), key: seqKeyOf(t.daySeq ?? fb?.get(t.id)?.seq ?? null), net: netPnl(t) ?? 0 }));
}

export type SeqInsight = {
  enough: boolean;
  sample: number;
  buckets: (Bucket & { label: string })[];
  best: Bucket | null;
  worst: (Bucket & { avg: number; vsBaseline: number }) | null;
  baseline: number | null;
  claim: Claim;
  trend: Trend | null;
  /** «Не входить после N-й сделки» when the costly number can be cut. */
  rule: Rule | null;
};

const SEQ_CUT: Record<string, number> = { "2": 1, "3": 2, "4-5": 3, "6+": 5 };

export function seqInsight(trades: readonly InsightTrade[], prev?: readonly InsightTrade[] | null): SeqInsight {
  const s = seqStats(trades);
  const rows = seqRows(trades);
  const baseline = avgOf(rows.map((r) => r.net));
  const best = s.buckets.find((b) => b.key === s.best) ?? null;
  const w = s.buckets.find((b) => b.key === s.worst) ?? null;
  const worst = w && w.trades ? { ...w, avg: round2(w.net / w.trades), vsBaseline: round2(w.net / w.trades - (baseline ?? 0)) } : null;
  const key = worst?.key;
  const ci = key ? dayBootstrap(rows, (r) => r.day, (rs) => rs.reduce((a, r) => a + (r.key === key ? r.net : 0), 0), { seed: `seq:${key}` }) : null;
  const confidence = worst
    ? confidenceOf(ci, worst.net < 0 ? "below" : "above", { n: worst.trades, minN: TILE_MIN.seqTrades / 2, days: daysOf(trades), minDays: TILE_MIN.days })
    : "low";
  const prevNet = key && prev ? seqStats(prev).buckets.find((b) => b.key === key) : null;
  return {
    enough: s.enough, sample: s.sample, buckets: s.buckets, best, worst, baseline: baseline == null ? null : round2(baseline),
    claim: { ci, confidence },
    trend: prevNet && prevNet.trades ? trendOf(worst?.net, prevNet.net, { flatWithin: 1 }) : null,
    rule: worst && worst.net < 0 && SEQ_CUT[worst.key] ? { type: "maxTradesPerDay", n: SEQ_CUT[worst.key] } : null,
  };
}

/* ─────────────────────── «После убытка / после прибыли» ─────────────────────── */

type AfterRow = { day: string; kind: string; res: string; net: number };

function afterRows(trades: readonly InsightTrade[]): AfterRow[] {
  const closed = closedOnly(trades);
  const fb = closed.some((t) => t.prevKind == null) ? daySequenceOf(closed) : null;
  return closed
    .map((t) => ({ day: realisedDay(t), kind: t.prevKind ?? fb?.get(t.id)?.prev ?? "", res: resultKeyOf(t.pnl, t.fees), net: netPnl(t) ?? 0 }))
    .filter((r) => r.kind === "after-loss" || r.kind === "after-win");
}

const rateOf = (rows: readonly AfterRow[], kind: string): number | null => {
  let w = 0, l = 0;
  for (const r of rows) if (r.kind === kind) { if (r.res === "win") w++; else if (r.res === "loss") l++; }
  return w + l ? w / (w + l) : null;
};
/** Win rate after a loss − after a win (share, −1…1); null when a side is empty. */
export function afterGap(rows: readonly AfterRow[]): number | null {
  const a = rateOf(rows, "after-loss"), b = rateOf(rows, "after-win");
  return a == null || b == null ? null : a - b;
}

export type AfterSide = { trades: number; winRate: number | null; net: number; avg: number | null; avgWin: number | null; avgLoss: number | null };
export type AfterInsight = {
  enough: boolean;
  afterLoss: AfterSide;
  afterWin: AfterSide;
  /** Win-rate gap (after a loss − after a win), share. */
  gap: number | null;
  verdict: "tilt" | "sharp" | "even" | null;
  claim: Claim;
  trend: Trend | null;
  rule: Rule | null;
};

function sideOf(rows: readonly AfterRow[], kind: string): AfterSide {
  const mine = rows.filter((r) => r.kind === kind);
  const nets = mine.map((r) => r.net);
  const wl = winLoss(nets);
  const net = round2(nets.reduce((a, b) => a + b, 0));
  return { trades: mine.length, winRate: rateOf(rows, kind), net, avg: mine.length ? round2(net / mine.length) : null, avgWin: wl.avgWin, avgLoss: wl.avgLoss };
}

export function afterInsight(trades: readonly InsightTrade[], prev?: readonly InsightTrade[] | null): AfterInsight {
  const rows = afterRows(trades);
  const afterLoss = sideOf(rows, "after-loss"), afterWin = sideOf(rows, "after-win");
  const enough = afterLoss.trades >= TILE_MIN.afterEach && afterWin.trades >= TILE_MIN.afterEach;
  const gap = afterGap(rows);
  const ci = dayBootstrap(rows, (r) => r.day, afterGap, { seed: "after" });
  const verdict = !enough || gap == null ? null : gap < -0.05 ? "tilt" : gap > 0.05 ? "sharp" : "even";
  const confidence = !enough || gap == null ? "low"
    : confidenceOf(ci, gap < 0 ? "below" : "above", { n: Math.min(afterLoss.trades, afterWin.trades), minN: TILE_MIN.afterEach, days: new Set(rows.map((r) => r.day)).size, minDays: TILE_MIN.days });
  const prevGap = prev ? afterGap(afterRows(prev)) : null;
  return {
    enough, afterLoss, afterWin, gap, verdict, claim: { ci, confidence },
    trend: trendOf(gap, prevGap, { flatWithin: 0.01 }),
    rule: verdict === "tilt" ? { type: "afterLoss", minutes: 30 } : null,
  };
}

/* ─────────────────────── «Время в позиции» ─────────────────────── */

type HoldRow = { day: string; hold: number; res: string; net: number; id: number; ticker: string };

function holdRows(trades: readonly InsightTrade[]): HoldRow[] {
  const out: HoldRow[] = [];
  for (const t of closedOnly(trades)) {
    if (horizonOf(t) !== "intraday" || t.overnight === true) continue;
    const h = t.holdSec;
    if (h == null || !Number.isFinite(h) || h <= 0) continue;
    const res = resultKeyOf(t.pnl, t.fees);
    if (res === "win" || res === "loss") out.push({ day: realisedDay(t), hold: h, res, net: netPnl(t) ?? 0, id: t.id, ticker: t.ticker });
  }
  return out;
}

/** Median hold of losers / median hold of winners; null when a side is empty. */
export function holdRatio(rows: readonly HoldRow[]): number | null {
  const w = median(rows.filter((r) => r.res === "win").map((r) => r.hold));
  const l = median(rows.filter((r) => r.res === "loss").map((r) => r.hold));
  return w && l ? l / w : null;
}

export type HoldInsight = {
  enough: boolean;
  winners: number | null;
  losers: number | null;
  nWin: number;
  nLoss: number;
  /** losers / winners (> 1: losers held longer). */
  ratio: number | null;
  verdict: "bad" | "good" | "even" | null;
  /** Winners are closed clearly faster than losers: maybe cutting profit early. */
  cutEarly: boolean;
  avgWin: number | null;
  avgLoss: number | null;
  longestLoser: (Example & { hold: number }) | null;
  claim: Claim;
  trend: Trend | null;
};

export function holdInsight(trades: readonly InsightTrade[], prev?: readonly InsightTrade[] | null): HoldInsight {
  const rows = holdRows(trades);
  const win = rows.filter((r) => r.res === "win"), loss = rows.filter((r) => r.res === "loss");
  const enough = win.length >= TILE_MIN.holdEach && loss.length >= TILE_MIN.holdEach;
  const ratio = holdRatio(rows);
  const ci = dayBootstrap(rows, (r) => r.day, holdRatio, { seed: "hold" });
  const verdict = !enough || ratio == null ? null : ratio >= 1.2 ? "bad" : ratio <= 1 / 1.2 ? "good" : "even";
  const confidence = !enough || ratio == null ? "low"
    : confidenceOf(ci, ratio >= 1 ? "above" : "below", { n: Math.min(win.length, loss.length), minN: TILE_MIN.holdEach, days: new Set(rows.map((r) => r.day)).size, minDays: TILE_MIN.days, threshold: 1 });
  const longest = [...loss].sort((a, b) => b.hold - a.hold)[0];
  const wl = winLoss(rows.map((r) => r.net));
  return {
    enough, winners: median(win.map((r) => r.hold)), losers: median(loss.map((r) => r.hold)), nWin: win.length, nLoss: loss.length,
    ratio, verdict, cutEarly: verdict === "bad",
    avgWin: wl.avgWin, avgLoss: wl.avgLoss,
    longestLoser: longest ? { id: longest.id, ticker: longest.ticker, net: round2(longest.net), hold: longest.hold } : null,
    claim: { ci, confidence },
    trend: trendOf(ratio, prev ? holdRatio(holdRows(prev)) : null, { higherIsBetter: false, flatWithin: 0.05 }),
  };
}

/* ─────────────────────── «Дни недели» ─────────────────────── */

export type WeekdayInsight = {
  enough: boolean;
  sample: number;
  days: Bucket[];
  best: Bucket | null;
  worst: (Bucket & { winRate: number | null }) | null;
  claim: Claim;
  trend: Trend | null;
};

export function weekdayInsight(trades: readonly InsightTrade[], prev?: readonly InsightTrade[] | null): WeekdayInsight {
  const s = weekdayStats(trades);
  const enough = s.enough && s.sample >= TILE_MIN.weekdayTrades;
  const best = s.days.find((d) => d.key === s.best) ?? null;
  const w = s.days.find((d) => d.key === s.worst) ?? null;
  const key = w?.key;
  const rows = closedOnly(trades).map((t) => ({ day: realisedDay(t), key: weekdayKey(t.date), net: netPnl(t) ?? 0 }));
  const ci = key ? dayBootstrap(rows, (r) => r.day, (rs) => rs.reduce((a, r) => a + (r.key === key ? r.net : 0), 0), { seed: `days:${key}` }) : null;
  const dayCount = key ? new Set(rows.filter((r) => r.key === key).map((r) => r.day)).size : 0;
  const confidence = !enough || !w ? "low"
    : confidenceOf(ci, w.net < 0 ? "below" : "above", { n: w.trades, minN: 5, days: dayCount, minDays: 3 });
  const prevDay = key && prev ? weekdayStats(prev).days.find((d) => d.key === key) : null;
  return {
    enough, sample: s.sample, days: s.days, best,
    worst: w ? { ...w, winRate: winRateOfBucket(w) } : null,
    claim: { ci, confidence },
    trend: prevDay && prevDay.trades ? trendOf(w?.net, prevDay.net, { flatWithin: 1 }) : null,
  };
}

/* ─────────────────────── «Комиссии» ─────────────────────── */

type FeeRow = { day: string; id: number; gross: number; fees: number; net: number; qty: number | null };

function feeRows(trades: readonly InsightTrade[]): FeeRow[] {
  return closedOnly(trades).map((t) => {
    const q = Math.abs(Number(t.qty));
    return { day: realisedDay(t), id: t.id, gross: grossPnl(t) ?? 0, fees: feesOf(t), net: netPnl(t) ?? 0, qty: Number.isFinite(q) && q > 0 ? q : null };
  });
}

/** Break-even win rate from the average win and loss (the shared definition, lib/trade-math breakevenWinRate). */
export const breakEvenRate = breakevenWinRate;

/** Actual win rate − break-even win rate (share), by the net. */
export function edgeMargin(rows: readonly { net: number }[]): number | null {
  const wl = winLoss(rows.map((r) => r.net));
  const be = breakEvenRate(wl.avgWin, wl.avgLoss);
  if (be == null || wl.wins + wl.losses === 0) return null;
  return (winRateOf(wl.wins, wl.losses) ?? 0) - be;
}

export type FeesInsight = {
  enough: boolean;
  trades: number;
  gross: number;
  fees: number;
  net: number;
  /** Fees / gross profit; null when the gross is not positive. */
  feeShare: number | null;
  feePerShare: number | null;
  grossPerShare: number | null;
  winRate: number | null;
  beRate: number | null;
  margin: number | null;
  /** The same margin on the gross (as if there were no fees): what the fees take off the edge. */
  marginGross: number | null;
  /** Trades the fees turned from green (gross) into red (net). */
  eaten: { count: number; ids: number[]; fees: number };
  claim: Claim;
  trend: Trend | null;
};

export function feesInsight(trades: readonly InsightTrade[], prev?: readonly InsightTrade[] | null): FeesInsight {
  const rows = feeRows(trades);
  const sum = (f: (r: FeeRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const gross = sum((r) => r.gross), fees = sum((r) => r.fees), net = sum((r) => r.net);
  const sized = rows.filter((r) => r.qty != null);
  const shares = sized.reduce((a, r) => a + (r.qty ?? 0), 0);
  const wl = winLoss(rows.map((r) => r.net));
  const margin = edgeMargin(rows);
  const ci = dayBootstrap<FeeRow>(rows, (r) => r.day, edgeMargin, { seed: "fees" });
  const enough = rows.length >= TILE_MIN.feeTrades;
  const eatenRows = rows.filter((r) => r.gross > 0 && r.net <= 0);
  return {
    enough, trades: rows.length, gross: round2(gross), fees: round2(fees), net: round2(net),
    feeShare: gross > 0 ? fees / gross : null,
    feePerShare: shares > 0 ? sized.reduce((a, r) => a + r.fees, 0) / shares : null,
    grossPerShare: shares > 0 ? sized.reduce((a, r) => a + r.gross, 0) / shares : null,
    winRate: winRateOf(wl.wins, wl.losses),
    beRate: breakEvenRate(wl.avgWin, wl.avgLoss),
    margin,
    marginGross: edgeMargin(rows.map((r) => ({ net: r.gross }))),
    eaten: { count: eatenRows.length, ids: eatenRows.map((r) => r.id), fees: round2(eatenRows.reduce((a, r) => a + r.fees, 0)) },
    claim: {
      ci,
      confidence: !enough || margin == null ? "low"
        : confidenceOf(ci, margin < 0 ? "below" : "above", { n: rows.length, minN: TILE_MIN.feeTrades, days: daysOf(trades), minDays: TILE_MIN.days }),
    },
    trend: trendOf(margin, prev ? edgeMargin(feeRows(prev)) : null, { flatWithin: 0.005 }),
  };
}

/* ─────────────────────── «Сегодня» ─────────────────────── */

export type TodayInsight = {
  /** Cumulative net after each trade closed today, in close order (starts at 0). */
  series: number[];
  trades: number;
  net: number;
  /** Average net of the window's other trading days. */
  avgDay: number | null;
  /** Other days in the window. */
  days: number;
  /** Share of the other days that ended below today (0…1). */
  beat: number | null;
  best: Example | null;
  worst: Example | null;
};

export function todayInsight(trades: readonly InsightTrade[], today: string): TodayInsight {
  const closed = byRealisation(closedOnly(trades));
  const mine = closed.filter((t) => realisedDay(t) === today);
  const series = [0];
  for (const t of mine) series.push(round2(series[series.length - 1] + (netPnl(t) ?? 0)));
  const net = series[series.length - 1];
  const byDay = new Map<string, number>();
  for (const t of closed) {
    const d = realisedDay(t);
    if (d !== today) byDay.set(d, (byDay.get(d) ?? 0) + (netPnl(t) ?? 0));
  }
  const others = [...byDay.values()];
  const avgDay = avgOf(others);
  return {
    series, trades: mine.length, net, avgDay: avgDay == null ? null : round2(avgDay), days: others.length,
    beat: others.length ? others.filter((v) => v < net).length / others.length : null,
    ...examples(mine),
  };
}

/* ─────────────────────── detail of a bucket ─────────────────────── */

export type BucketSummary = {
  trades: number;
  winRate: number | null;
  net: number;
  avgWin: number | null;
  avgLoss: number | null;
  best: Example | null;
  worst: Example | null;
};

/** Counts, win rate, average win / loss and the best / worst trade of a set (the hover detail of a tile). */
export function summaryOf(trades: readonly InsightTrade[]): BucketSummary {
  const closed = closedOnly(trades);
  const nets = closed.map((t) => netPnl(t) ?? 0);
  const wl = winLoss(nets);
  return {
    trades: closed.length,
    winRate: winRateOf(wl.wins, wl.losses),
    net: round2(nets.reduce((a, b) => a + b, 0)),
    avgWin: wl.avgWin,
    avgLoss: wl.avgLoss,
    ...examples(closed),
  };
}

/** Closed trades of one trade-number bucket («4-5»). */
export function seqTradesOf(trades: readonly InsightTrade[], key: string): InsightTrade[] {
  const closed = closedOnly(trades);
  const fb = closed.some((t) => t.daySeq == null) ? daySequenceOf(closed) : null;
  return closed.filter((t) => seqKeyOf(t.daySeq ?? fb?.get(t.id)?.seq ?? null) === key);
}

/** Closed trades entered on one ISO weekday («3» = Wednesday). */
export function weekdayTradesOf(trades: readonly InsightTrade[], key: string): InsightTrade[] {
  return closedOnly(trades).filter((t) => weekdayKey(t.date) === key);
}
