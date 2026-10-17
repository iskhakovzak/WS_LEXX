/**
 * Training simulator — pure. The trader watches bars one by one with the future hidden and trades a paper
 * position: «Купить» / «Продать» / «В ноль» with a size and a stop. Orders fill at the close of the bar on the
 * cursor (the bar the trader has just seen complete); a stop is checked on every bar revealed after that and
 * fills at the stop price (or at the bar's open when the bar gaps through it).
 *
 * At the end the attempt is scored against what was possible in the same stretch of bars (the best single
 * round trip on closes, either direction — «идеал») and compared with the real trade per share and in R.
 * Money here is the trainee's own paper size, never another trader's $.
 */
import type { Side, TrainingResult } from "../types";

export type SimAction = "buy" | "sell" | "flat";

export type SimFill = {
  idx: number;
  t: number;
  price: number;
  /** Signed shares: + bought, − sold. */
  qty: number;
  reason: SimAction | "stop";
};

export type SimState = {
  /** Signed open position in shares (+ long, − short). */
  pos: number;
  /** Average price of the open position (null when flat). */
  avg: number | null;
  /** Realised P&L in $ of the paper size. */
  realized: number;
  stop: number | null;
  fills: SimFill[];
  /** Largest absolute position held (for per-share figures). */
  maxAbs: number;
  /** Risk in $ of the first position opened (|entry − stop| × qty); null without a stop. */
  firstRiskUsd: number | null;
  /** Number of round trips closed. */
  roundTrips: number;
};

export const EMPTY_SIM: SimState = { pos: 0, avg: null, realized: 0, stop: null, fills: [], maxAbs: 0, firstRiskUsd: null, roundTrips: 0 };

const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Apply a signed fill (± shares at price) to the position: closes against the open side first, the rest opens. */
function applyFill(s: SimState, fill: SimFill, stopForNew: number | null): SimState {
  let { pos, avg, realized, stop, maxAbs, firstRiskUsd, roundTrips } = s;
  let q = fill.qty;
  if (pos !== 0 && Math.sign(q) !== Math.sign(pos)) {
    const closing = Math.min(Math.abs(q), Math.abs(pos)) * Math.sign(q);
    // closing a long (sell, q<0): (price − avg) per share; closing a short (buy, q>0): (avg − price)
    realized += (avg ?? fill.price) * closing - fill.price * closing;
    pos += closing;
    q -= closing;
    if (Math.abs(pos) < EPS) { pos = 0; avg = null; stop = null; roundTrips += 1; }
  }
  if (Math.abs(q) > EPS) {
    const wasFlat = pos === 0;
    avg = wasFlat ? fill.price : ((avg ?? fill.price) * Math.abs(pos) + fill.price * Math.abs(q)) / (Math.abs(pos) + Math.abs(q));
    pos += q;
    if (wasFlat) {
      stop = stopForNew;
      if (firstRiskUsd == null && stopForNew != null && Math.abs(fill.price - stopForNew) > EPS) firstRiskUsd = Math.abs(fill.price - stopForNew) * Math.abs(q);
    }
  }
  maxAbs = Math.max(maxAbs, Math.abs(pos));
  return { pos, avg, realized, stop, fills: [...s.fills, fill], maxAbs, firstRiskUsd, roundTrips };
}

/** Is a stop on the wrong side of the price for this direction (would trigger immediately)? */
export function stopInvalid(dir: 1 | -1, price: number, stop: number | null): boolean {
  return stop != null && (dir > 0 ? stop >= price : stop <= price);
}

/**
 * Place an order at `price` (the close of bar `idx`). `qty` is ignored for «flat». `stop` applies when the order
 * opens a new position (or replaces the stop of the open one when it adds in the same direction); a stop on the
 * wrong side of the price is ignored.
 */
export function simOrder(s: SimState, o: { action: SimAction; idx: number; t: number; price: number; qty?: number; stop?: number | null }): SimState {
  if (!(o.price > 0)) return s;
  let signed: number;
  if (o.action === "flat") {
    if (s.pos === 0) return s;
    signed = -s.pos;
  } else {
    const q = Math.floor(Math.abs(o.qty ?? 0));
    if (q <= 0) return s;
    signed = o.action === "buy" ? q : -q;
  }
  const finalDir = Math.sign(s.pos + signed) as 1 | -1 | 0;
  const stop = finalDir !== 0 && o.stop != null && !stopInvalid(finalDir as 1 | -1, o.price, o.stop) ? o.stop : null;
  const next = applyFill(s, { idx: o.idx, t: o.t, price: o.price, qty: signed, reason: o.action }, stop);
  // Adding in the same direction with a new stop moves the stop.
  if (next.pos !== 0 && s.pos !== 0 && Math.sign(next.pos) === Math.sign(s.pos) && stop != null) return { ...next, stop };
  return next;
}

/** Move (or remove) the stop of the open position. A stop on the wrong side of `price` is rejected (state unchanged). */
export function simSetStop(s: SimState, stop: number | null, price: number): SimState {
  if (s.pos === 0) return s;
  if (stop != null && stopInvalid(s.pos > 0 ? 1 : -1, price, stop)) return s;
  return { ...s, stop };
}

/** Check the stop against a newly revealed bar (bar `idx` comes after the order bar). */
export function simApplyBar(s: SimState, bar: { t: number; o: number; h: number; l: number }, idx: number): SimState {
  if (s.pos === 0 || s.stop == null) return s;
  const long = s.pos > 0;
  const hit = long ? bar.l <= s.stop : bar.h >= s.stop;
  if (!hit) return s;
  const price = long ? Math.min(bar.o, s.stop) : Math.max(bar.o, s.stop);
  return applyFill(s, { idx, t: bar.t, price, qty: -s.pos, reason: "stop" }, null);
}

/** Open + realised P&L ($) marked at `price`. */
export function simMark(s: SimState, price: number): { unrealized: number; total: number } {
  const unrealized = s.pos !== 0 && s.avg != null ? (price - s.avg) * s.pos : 0;
  return { unrealized, total: s.realized + unrealized };
}

export type IdealMove = { perShare: number; side: Side; fromIdx: number; toIdx: number } | null;

/** Best single round trip on closes inside [from, to] — long (buy low, sell later higher) or short. O(n). */
export function idealMove(closes: readonly number[], from: number, to: number): IdealMove {
  const a = Math.max(0, from), b = Math.min(closes.length - 1, to);
  if (b <= a) return null;
  let best: IdealMove = null;
  let minI = a, maxI = a;
  for (let i = a + 1; i <= b; i++) {
    const c = closes[i];
    if (!Number.isFinite(c)) continue;
    const up = c - closes[minI];
    if (up > (best?.perShare ?? 0) + EPS) best = { perShare: up, side: "long", fromIdx: minI, toIdx: i };
    const down = closes[maxI] - c;
    if (down > (best?.perShare ?? 0) + EPS) best = { perShare: down, side: "short", fromIdx: maxI, toIdx: i };
    if (c < closes[minI]) minI = i;
    if (c > closes[maxI]) maxI = i;
  }
  return best;
}

export type TrainingOutcome = {
  /** Paper P&L in $ of the trainee's own size (open position marked at the last bar). */
  pnlUsd: number;
  /** P&L per share of the largest position held (null when no trade was taken). */
  perShare: number | null;
  /** In R of the first stop (null without a stop). */
  r: number | null;
  trades: number;
  /** Best possible move per share in the watched window. */
  idealPerShare: number | null;
  idealSide: Side | null;
  /** 0–100: share of the ideal move captured (negative results score 0). Null when nothing was possible or done. */
  score: number | null;
  /** Real trade per share (side-adjusted, from its average prices) and in R (when it had a stop). */
  realPerShare: number | null;
  realR: number | null;
  /** perShare − realPerShare (null when either is unknown). */
  vsRealPerShare: number | null;
};

/** Score the attempt. `lastClose` marks a still-open paper position. */
export function scoreTraining(
  s: SimState,
  ctx: { lastClose: number; ideal: IdealMove; real: { side: Side; avgEntry: number | null; avgExit: number | null; risk: number | null } },
): TrainingOutcome {
  const { total } = simMark(s, ctx.lastClose);
  const traded = s.fills.length > 0;
  const perShare = traded && s.maxAbs > 0 ? total / s.maxAbs : null;
  const r = traded && s.firstRiskUsd ? total / s.firstRiskUsd : null;
  const ideal = ctx.ideal && ctx.ideal.perShare > EPS ? ctx.ideal : null;
  const score = perShare != null && ideal ? Math.round(Math.max(0, Math.min(1, perShare / ideal.perShare)) * 100) : null;
  const { side, avgEntry, avgExit, risk } = ctx.real;
  const dir = side === "short" ? -1 : 1;
  const realPerShare = avgEntry != null && avgExit != null ? dir * (avgExit - avgEntry) : null;
  const realR = realPerShare != null && risk ? realPerShare / risk : null;
  return {
    pnlUsd: r2(total),
    perShare,
    r,
    trades: s.roundTrips + (s.pos !== 0 ? 1 : 0),
    idealPerShare: ideal?.perShare ?? null,
    idealSide: ideal?.side ?? null,
    score,
    realPerShare,
    realR,
    vsRealPerShare: perShare != null && realPerShare != null ? perShare - realPerShare : null,
  };
}

export type ScoreVerdict = { label: string; tone: "up" | "neutral" | "warn" | "down" };

export function trainingVerdict(o: Pick<TrainingOutcome, "score" | "trades" | "pnlUsd">): ScoreVerdict {
  if (o.trades === 0) return { label: "без сделок — тоже решение", tone: "neutral" };
  if (o.pnlUsd < 0) return { label: "в минус", tone: "down" };
  const s = o.score ?? 0;
  if (s >= 70) return { label: "забрал почти весь ход", tone: "up" };
  if (s >= 40) return { label: "хорошо", tone: "up" };
  if (s >= 15) return { label: "мало от возможного", tone: "warn" };
  return { label: "почти ноль", tone: "warn" };
}

/** Suggested stop for a new position: just beyond the extreme of the last `lookback` bars (incl. the cursor bar). */
export function suggestStop(bars: readonly { h: number; l: number }[], idx: number, dir: 1 | -1, lookback = 5): number | null {
  if (idx < 0 || idx >= bars.length) return null;
  let ext = dir > 0 ? Infinity : -Infinity;
  for (let i = Math.max(0, idx - lookback + 1); i <= idx; i++) ext = dir > 0 ? Math.min(ext, bars[i].l) : Math.max(ext, bars[i].h);
  if (!Number.isFinite(ext)) return null;
  const tick = ext >= 1 ? 0.01 : 0.0001;
  return Math.round((ext - dir * tick) / tick) * tick;
}

/* ─── Session history (localStorage, per browser) ───────────────────────── */

export type TrainingRecord = TrainingResult;

export const TRAINING_HISTORY_KEY = "ws-chart:training-history:v2";
export const TRAINING_HISTORY_MAX = 200;

/** Newest first; capped. */
export function pushHistory(list: readonly TrainingRecord[], rec: TrainingRecord): TrainingRecord[] {
  return [rec, ...list].slice(0, TRAINING_HISTORY_MAX);
}

export function parseHistory(raw: string | null): TrainingRecord[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is TrainingRecord => !!x && typeof x.at === "number" && typeof x.tradeId === "number" && typeof x.ticker === "string").slice(0, TRAINING_HISTORY_MAX) : [];
  } catch { return []; }
}

/** Streak of consecutive most-recent attempts that ended in plus (newest first in `list`). */
export function winStreak(list: readonly TrainingRecord[]): number {
  let n = 0;
  for (const x of list) { if (x.trades > 0 && x.pnlUsd > 0) n++; else break; }
  return n;
}

export function historyStats(list: readonly TrainingRecord[]): { count: number; avgScore: number | null; plusShare: number | null; streak: number; beatReal: number } {
  const scored = list.filter((x) => x.score != null);
  const traded = list.filter((x) => x.trades > 0);
  return {
    count: list.length,
    avgScore: scored.length ? Math.round(scored.reduce((s, x) => s + (x.score ?? 0), 0) / scored.length) : null,
    plusShare: traded.length ? traded.filter((x) => x.pnlUsd > 0).length / traded.length : null,
    streak: winStreak(list),
    beatReal: list.filter((x) => x.vsRealPerShare != null && x.vsRealPerShare > 0).length,
  };
}
