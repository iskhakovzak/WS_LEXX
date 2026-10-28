/**
 * Session flow calculators (pure, no I/O; ./load.ts feeds them, tests in __tests__/sessionFlow.test.ts).
 *
 *   entryNumbers(trades)       the n-th entry of each trade in its (trader, NY day, ticker, side) — 1 = the first entry,
 *                              2 = the first re-entry … Entries are ordered by the entry time, then the id.
 *   reentryBuckets(trades)     closed trades by that number: 1 / 2 / 3 / 4+ with the shared $ stats (computeUsdStats)
 *   reentryBreaches(day, max)  (ticker, side) pairs whose re-entries went past `max` (the guard's soft stop)
 *   chaseIds(trades)           «chase»: a stop (stopped out, or a closed loss) in the pre-market, the opening print or
 *                              the after-market, followed by a new entry in the same ticker the same day
 *   dayGiveback(day, units)    peak of the running realised P&L (by exit order) minus the close, in daily stops and in
 *                              R; a day closed at or near its peak never flags
 *   greenToRed(day, cfg)       after the running P&L first crosses from green to red: size and pace after the cross vs
 *                              before it; a material increase is the leak
 *   robustEdge(nets)           P&L without the 3 best trades, the median trade and the top-3 share of the net; flags an
 *                              edge that rests on outliers
 * Money is net ($ after fees, lib/tradeMath netPnl); win rate and P&L of a bucket come from the shared computeUsdStats.
 */
import { computeUsdStats, type UsdStats } from "../playbookEdge";
import { timingOf, type Timing } from "./timing";
import { round2, type FlowTrade } from "./types";

const MIN_MS = 60_000;

function byEntry(a: FlowTrade, b: FlowTrade): number {
  return (a.entryAt ?? Number.MAX_SAFE_INTEGER) - (b.entryAt ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;
}

const legKey = (t: Pick<FlowTrade, "trader" | "day" | "ticker" | "side">) => `${t.trader}\u0000${t.day}\u0000${t.ticker.toUpperCase()}\u0000${t.side ?? "?"}`;

// ─── re-entries ────────────────────────────────────────────────────────────────────────────────────────────────

/** Trade id → its entry number in the same trader / day / ticker / side (1 = first entry). */
export function entryNumbers(trades: readonly FlowTrade[]): Map<number, number> {
  const groups = new Map<string, FlowTrade[]>();
  for (const t of trades) {
    const k = legKey(t);
    const g = groups.get(k);
    if (g) g.push(t); else groups.set(k, [t]);
  }
  const out = new Map<number, number>();
  for (const g of groups.values()) g.sort(byEntry).forEach((t, i) => out.set(t.id, i + 1));
  return out;
}

export const REENTRY_BUCKETS = ["1", "2", "3", "4+"] as const;
export type ReentryBucket = (typeof REENTRY_BUCKETS)[number];
export const bucketOfEntry = (n: number): ReentryBucket => (n >= 4 ? "4+" : (String(n) as ReentryBucket));

export type ReentryRow = UsdStats & { bucket: ReentryBucket };

/** Closed trades by entry number (1 / 2 / 3 / 4+), each with the shared $ stats; empty buckets are left out. */
export function reentryBuckets(trades: readonly FlowTrade[]): ReentryRow[] {
  const nums = entryNumbers(trades);
  const by = new Map<ReentryBucket, FlowTrade[]>();
  for (const t of trades) {
    const b = bucketOfEntry(nums.get(t.id) ?? 1);
    const l = by.get(b);
    if (l) l.push(t); else by.set(b, [t]);
  }
  return REENTRY_BUCKETS.filter((b) => by.has(b)).map((bucket) => ({ bucket, ...computeUsdStats(by.get(bucket)!) })).filter((r) => r.n > 0);
}

export type ReentryBreach = { ticker: string; side: "long" | "short" | null; entries: number; tradeId: number; at: number | null };

/**
 * Per (ticker, side) of ONE trader-day: the entry that took the re-entries past `maxReentries` (entry number
 * maxReentries + 1 — with the default 2, the third entry). One breach per pair (the first offending entry).
 */
export function reentryBreaches(dayTrades: readonly FlowTrade[], maxReentries: number): ReentryBreach[] {
  const nums = entryNumbers(dayTrades);
  const counts = new Map<string, number>();
  for (const t of dayTrades) { const k = legKey(t); counts.set(k, Math.max(counts.get(k) ?? 0, nums.get(t.id) ?? 1)); }
  const out: ReentryBreach[] = [];
  for (const t of [...dayTrades].sort(byEntry)) {
    if ((nums.get(t.id) ?? 1) !== maxReentries + 1) continue;
    out.push({ ticker: t.ticker.toUpperCase(), side: t.side, entries: counts.get(legKey(t)) ?? maxReentries + 1, tradeId: t.id, at: t.entryAt });
  }
  return out;
}

// ─── chase ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Timings where a stop is followed by the «chase»: the pre-market, the opening print and the after-market. */
export const CHASE_TIMINGS: readonly Timing[] = ["am", "opg", "pm"];

/** Stopped out (the structure saw the stop hit) or simply closed at a loss. */
export const isStop = (t: Pick<FlowTrade, "exitKind" | "result">): boolean => t.exitKind === "stopped" || t.result === "loss";

/** Trades that are a chase: a new entry after a stop in a pre-market / print / after-market trade of the same ticker and day. */
export function chaseIds(trades: readonly FlowTrade[]): Set<number> {
  const byTicker = new Map<string, FlowTrade[]>();
  for (const t of trades) {
    const k = `${t.trader}\u0000${t.day}\u0000${t.ticker.toUpperCase()}`;
    const l = byTicker.get(k);
    if (l) l.push(t); else byTicker.set(k, [t]);
  }
  const out = new Set<number>();
  for (const list of byTicker.values()) {
    const stops = list.filter((t) => isStop(t) && t.exitAt != null && CHASE_TIMINGS.includes(timingOf(t) as Timing));
    if (!stops.length) continue;
    for (const t of list) {
      if (t.entryAt == null) continue;
      if (stops.some((s) => s.id !== t.id && s.exitAt! <= t.entryAt!)) out.add(t.id);
    }
  }
  return out;
}

// ─── give-back from the day's peak ─────────────────────────────────────────────────────────────────────────────

export type GivebackCfg = {
  /** Flag at or above this many daily stops (or R when the day has no daily limit). */
  thresholdStops: number;
  /** A close within this share of the peak counts as «at the peak» (never flagged). */
  nearPeakShare: number;
};

export type DayGiveback = {
  day: string;
  peak: number;
  close: number;
  giveback: number;
  /** Give-back ÷ the daily loss limit (null without a limit). */
  stops: number | null;
  /** Give-back ÷ the day's median planned risk per trade (risk_usd), null when the trades carry no risk. */
  r: number | null;
  /** The units the flag was judged in. */
  unit: "stops" | "r" | null;
  flagged: boolean;
  /** Exit moment of the peak (epoch ms). */
  peakAt: number | null;
};

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The day's give-back (closed trades by exit time; open trades and trades without P&L are skipped). */
export function dayGiveback(dayTrades: readonly FlowTrade[], dailyLimit: number | null, cfg: GivebackCfg): DayGiveback | null {
  const closed = dayTrades.filter((t) => t.net != null && t.exitAt != null && t.result !== "open").sort((a, b) => a.exitAt! - b.exitAt! || a.id - b.id);
  if (!closed.length) return null;
  let cum = 0;
  let top = 0;
  let peakAt: number | null = null;
  for (const t of closed) {
    cum += t.net!;
    if (cum > top) { top = cum; peakAt = t.exitAt; } // core-metric-ok: intraday give-back from the day's running peak, not the drawdown metric
  }
  const close = round2(cum);
  const peak = round2(top);
  const giveback = round2(Math.max(0, peak - close));
  const limit = dailyLimit != null && dailyLimit > 0 ? dailyLimit : null;
  const risks = closed.map((t) => num(t.riskUsd ?? t.risk_usd)).filter((x): x is number => x != null && x > 0);
  const oneR = median(risks);
  const stops = limit ? round2(giveback / limit) : null;
  const r = oneR ? round2(giveback / oneR) : null;
  const unit = stops != null ? "stops" : r != null ? "r" : null;
  const measure = stops ?? r;
  const nearPeak = peak <= 0 || close >= peak * (1 - cfg.nearPeakShare);
  return { day: closed[0]!.day, peak, close, giveback, stops, r, unit, flagged: !nearPeak && measure != null && measure >= cfg.thresholdStops, peakAt };
}

// ─── green to red ──────────────────────────────────────────────────────────────────────────────────────────────

export type GreenToRedCfg = {
  /** After / before average notional at or above this is a material size increase. */
  sizeRatio: number;
  /** After / before trades per hour at or above this is a material pace increase. */
  paceRatio: number;
  /** Trades after the cross the comparison needs. */
  minAfter: number;
};

export type GreenToRed = {
  day: string;
  /** Exit moment of the trade that turned the running P&L red after it had been green. */
  crossAt: number;
  crossTradeId: number;
  peak: number;
  before: { trades: number; avgNotional: number | null; perHour: number | null };
  after: { trades: number; avgNotional: number | null; perHour: number | null };
  sizeRatio: number | null;
  paceRatio: number | null;
  material: boolean;
};

const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function pace(list: readonly FlowTrade[], from: number, to: number): number | null {
  const hours = (to - from) / (60 * MIN_MS);
  return hours > 0 ? list.length / Math.max(hours, 0.25) : null; // a window under 15 min counts as 15 min
}

/** The day's green-to-red cross and the behaviour around it (null when the running P&L never went green, then red). */
export function greenToRed(dayTrades: readonly FlowTrade[], cfg: GreenToRedCfg, now?: number): GreenToRed | null {
  const closed = dayTrades.filter((t) => t.net != null && t.exitAt != null && t.result !== "open").sort((a, b) => a.exitAt! - b.exitAt! || a.id - b.id);
  let cum = 0;
  let wasGreen = false;
  let top = 0;
  let cross: FlowTrade | null = null;
  for (const t of closed) {
    cum += t.net!;
    if (cum > 0) { wasGreen = true; top = Math.max(top, cum); } // core-metric-ok: the green-to-red cross, not the drawdown metric
    else if (wasGreen && cum < 0) { cross = t; break; }
  }
  if (!cross) return null;
  const at = cross.exitAt!;
  const entered = dayTrades.filter((t) => t.entryAt != null).sort(byEntry);
  const before = entered.filter((t) => t.entryAt! <= at);
  const after = entered.filter((t) => t.entryAt! > at);
  const sizes = (l: readonly FlowTrade[]) => l.map((t) => t.notional).filter((x): x is number => x != null && x > 0);
  const bSize = avg(sizes(before));
  const aSize = avg(sizes(after));
  const firstAt = before[0]?.entryAt ?? at;
  const lastAt = after.length ? Math.max(after[after.length - 1]!.entryAt!, now ?? 0) : at;
  const bPace = pace(before, firstAt, at);
  const aPace = after.length ? pace(after, at, lastAt) : null;
  const sizeRatio = bSize && aSize ? round2(aSize / bSize) : null;
  const paceRatio = bPace && aPace ? round2(aPace / bPace) : null;
  const material = after.length >= cfg.minAfter && ((sizeRatio != null && sizeRatio >= cfg.sizeRatio) || (paceRatio != null && paceRatio >= cfg.paceRatio));
  const r = (v: number | null) => (v == null ? null : round2(v));
  return {
    day: cross.day, crossAt: at, crossTradeId: cross.id, peak: round2(top),
    before: { trades: before.length, avgNotional: r(bSize), perHour: r(bPace) },
    after: { trades: after.length, avgNotional: r(aSize), perHour: r(aPace) },
    sizeRatio, paceRatio, material,
  };
}

// ─── robust edge ───────────────────────────────────────────────────────────────────────────────────────────────

export type RobustEdge = {
  n: number;
  net: number;
  /** Net without the 3 best trades. */
  netExTop3: number;
  median: number | null;
  /** Σ of the 3 best trades ÷ the net (null when the net is not positive). */
  top3Share: number | null;
  /** The edge rests on outliers: a positive net whose top 3 are more than all of it, or nothing left without them. */
  outliers: boolean;
};

/** Robustness of a slice's net from its per-trade nets (n < 4 → the top 3 are the whole slice: always outliers when green). */
export function robustEdge(nets: readonly number[]): RobustEdge {
  const sorted = [...nets].sort((a, b) => b - a);
  const net = round2(sorted.reduce((a, b) => a + b, 0));
  const top3 = sorted.slice(0, 3).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const netExTop3 = round2(net - top3);
  const top3Share = net > 0 ? round2(top3 / net) : null;
  const med = median(sorted);
  return {
    n: sorted.length, net, netExTop3, median: med == null ? null : round2(med), top3Share,
    outliers: net > 0 && ((top3Share != null && top3Share > 1) || netExTop3 <= 0),
  };
}
