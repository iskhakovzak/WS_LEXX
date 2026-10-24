/**
 * Compact insight cards («Серии», «Номер сделки в дне», «Время в позиции», «Дни недели», «После убытка») — the pure
 * maths, computed client-side from the trades a page already has (no new endpoint).
 *
 * Streaks follow the trade rows: the result a row *shows* (lib/trade-result visualResult — the stored result, BE when
 * the net is inside the «Вид» break-even range), so the strip, the current streak and the records always agree with
 * the colours the trader sees. A break-even trade neither extends nor breaks a streak (same rule as the API's
 * dashboard streaks). Green days: a day in the profit colour counts, a break-even day is skipped, anything else ends
 * the run.
 * The other cards are analytics: their win / loss is the facet result (net > 0 / < 0, lib/trade-facets resultKeyOf),
 * never the break-even range, so a drill into «Разрезы» shows exactly the trades the card counted.
 */
import type { Trade } from "@workspace/api-client-react";
import { classifyPnl } from "@/lib/appearance/be-range";
import { closeDate, horizonOf, isOpen, netPnl } from "@/lib/trade-math";
import { visualResult } from "@/lib/trade-result";
import {
  OVERNIGHT_KEY, HOLD_BUCKETS, SEQ_BUCKETS, UNKNOWN_KEY, resultKeyOf, seqKeyOf,
  type FacetDim, type FacetView,
} from "@/lib/trade-facets";

export type InsightTrade = Pick<Trade, "id" | "ticker" | "date" | "result"> &
  Partial<Pick<Trade, "exitDate" | "pnl" | "fees" | "rMultiple" | "daySeq" | "prevKind" | "holdSec" | "overnight" | "entrySec"
    | "horizon" | "trader" | "side" | "entry" | "exit" | "stop" | "riskUsd">>;

/** Sample thresholds: under them a card says «мало данных» instead of a verdict. */
export const MIN = {
  streakTrades: 3,
  seqTrades: 10,
  seqBucket: 3,
  holdEach: 5,
  weekdayTrades: 10,
  weekdayDay: 2,
  weekdayDays: 3,
  afterEach: 5,
} as const;

const day = (s: string | null | undefined) => String(s ?? "").slice(0, 10);

/** Seconds of the exit within its day (entry + hold), for ordering trades closed on the same day. */
function exitSecOf(t: InsightTrade): number {
  const entry = t.entrySec ?? null;
  const hold = t.holdSec ?? null;
  if (entry == null) return Number.POSITIVE_INFINITY;
  return hold != null && hold >= 0 ? (entry + hold) % 86_400 : entry;
}

/** Chronological order of realisation: close day, exit second, id. */
export function byRealisation<T extends InsightTrade>(trades: readonly T[]): T[] {
  return [...trades].sort((a, b) => {
    const da = day(closeDate(a)), db = day(closeDate(b));
    if (da !== db) return da < db ? -1 : 1;
    const ea = exitSecOf(a), eb = exitSecOf(b);
    if (ea !== eb) return ea - eb;
    return a.id - b.id;
  });
}

/* ─────────────────────────────── «Серии» ─────────────────────────────── */

export type Outcome = "win" | "loss" | "be";
export type StreakTrade = { id: number; ticker: string; day: string; net: number | null; outcome: Outcome };
export type Streaks = {
  /** Closed trades with a result. */
  closed: number;
  /** The last 20, oldest → newest. */
  recent: StreakTrade[];
  current: { type: "win" | "loss" | "none"; count: number };
  bestWin: number;
  worstLoss: number;
  greenDays: number;
};

export const STRIP_LENGTH = 20;

/** The result a closed trade shows (break-even range applied); null while open / unknown. */
export function shownOutcome(t: InsightTrade, beRange: number): Outcome | null {
  if (isOpen(t)) return null;
  return visualResult(t.result, netPnl(t), beRange);
}

export function streaksOf(trades: readonly InsightTrade[], beRange: number): Streaks {
  const list: StreakTrade[] = [];
  for (const t of byRealisation(trades)) {
    const outcome = shownOutcome(t, beRange);
    if (!outcome) continue;
    list.push({ id: t.id, ticker: t.ticker, day: day(closeDate(t)), net: netPnl(t), outcome });
  }

  let current: Streaks["current"] = { type: "none", count: 0 };
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i].outcome;
    if (o === "be") continue;
    if (current.type === "none") current = { type: o, count: 1 };
    else if (o === current.type) current.count++;
    else break;
  }

  let bestWin = 0, worstLoss = 0, runW = 0, runL = 0;
  for (const s of list) {
    if (s.outcome === "be") continue;
    if (s.outcome === "win") { runW++; runL = 0; } else { runL++; runW = 0; }
    bestWin = Math.max(bestWin, runW);
    worstLoss = Math.max(worstLoss, runL);
  }

  return { closed: list.length, recent: list.slice(-STRIP_LENGTH), current, bestWin, worstLoss, greenDays: greenDayStreak(list, beRange) };
}

/** Days in the profit colour in a row, newest first; a break-even day is skipped, a flat / red day ends the run. */
export function greenDayStreak(list: readonly StreakTrade[], beRange: number): number {
  const days = new Map<string, { net: number; hasNet: boolean; score: number }>();
  for (const s of list) {
    const d = days.get(s.day) ?? { net: 0, hasNet: false, score: 0 };
    if (s.net != null) { d.net += s.net; d.hasNet = true; }
    d.score += s.outcome === "win" ? 1 : s.outcome === "loss" ? -1 : 0;
    days.set(s.day, d);
  }
  let run = 0;
  for (const key of [...days.keys()].sort().reverse()) {
    const d = days.get(key)!;
    const cls = d.hasNet ? classifyPnl(Math.round(d.net * 100) / 100, beRange) : d.score > 0 ? "win" : d.score < 0 ? "loss" : "flat";
    if (cls === "win") run++;
    else if (cls === "be") continue;
    else break;
  }
  return run;
}

/* ─────────────────────── shared bucket helpers ─────────────────────── */

export type Bucket = { key: string; trades: number; wins: number; losses: number; net: number; hasNet: boolean };

const emptyBucket = (key: string): Bucket => ({ key, trades: 0, wins: 0, losses: 0, net: 0, hasNet: false });

function add(b: Bucket, t: InsightTrade) {
  b.trades++;
  const r = resultKeyOf(t.pnl, t.fees);
  if (r === "win") b.wins++;
  else if (r === "loss") b.losses++;
  const n = netPnl(t);
  if (n != null) { b.net += n; b.hasNet = true; }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const closedOnly = (trades: readonly InsightTrade[]) => trades.filter((t) => !isOpen(t) && netPnl(t) != null);

/** Win rate W / (W + L); null without decided trades. */
export const winRateOfBucket = (b: Bucket): number | null => (b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : null);

/**
 * day_seq / prev_kind for rows that lack them (older API): the trader-day ordered by entry second (unknown last),
 * then id — the API rule (lib/tradeFacetDerive daySequence).
 */
export function daySequenceOf(trades: readonly InsightTrade[]): Map<number, { seq: number; prev: string | null }> {
  const groups = new Map<string, InsightTrade[]>();
  for (const t of trades) {
    const d = day(t.date);
    if (!d) continue;
    const k = `${(t.trader ?? "").trim()}|${d}`;
    const l = groups.get(k);
    if (l) l.push(t); else groups.set(k, [t]);
  }
  const out = new Map<number, { seq: number; prev: string | null }>();
  for (const list of groups.values()) {
    list.sort((a, b) => (a.entrySec ?? Number.POSITIVE_INFINITY) - (b.entrySec ?? Number.POSITIVE_INFINITY) || a.id - b.id);
    list.forEach((t, i) => {
      if (i === 0) { out.set(t.id, { seq: 1, prev: "first" }); return; }
      const k = resultKeyOf(list[i - 1].pnl, list[i - 1].fees);
      out.set(t.id, { seq: i + 1, prev: k === UNKNOWN_KEY ? null : `after-${k}` });
    });
  }
  return out;
}

/* ─────────────────────── «Номер сделки в дне» ─────────────────────── */

export type SeqStats = {
  buckets: (Bucket & { label: string })[];
  sample: number;
  enough: boolean;
  best: string | null;
  worst: string | null;
};

export const SEQ_KEYS = SEQ_BUCKETS.map((b) => b.key);

export function seqStats(trades: readonly InsightTrade[]): SeqStats {
  const fallback = trades.some((t) => t.daySeq == null) ? daySequenceOf(trades) : null;
  const map = new Map(SEQ_KEYS.map((k) => [k, emptyBucket(k)]));
  for (const t of closedOnly(trades)) {
    const key = seqKeyOf(t.daySeq ?? fallback?.get(t.id)?.seq ?? null);
    const b = map.get(key);
    if (b) add(b, t);
  }
  const buckets = SEQ_KEYS.map((k) => ({ ...map.get(k)!, net: round2(map.get(k)!.net), label: k }));
  const sample = buckets.reduce((s, b) => s + b.trades, 0);
  const solid = buckets.filter((b) => b.trades >= MIN.seqBucket);
  const enough = sample >= MIN.seqTrades && solid.length >= 2;
  const sorted = [...solid].sort((a, b) => b.net - a.net);
  return { buckets, sample, enough, best: enough ? sorted[0].key : null, worst: enough ? sorted[sorted.length - 1].key : null };
}

/* ─────────────────────── «Время в позиции» ─────────────────────── */

export type HoldStats = { winners: number | null; losers: number | null; nWin: number; nLoss: number; ratio: number | null; enough: boolean };

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median hold of intraday winners vs losers (overnight / swing holds would swamp the scale). */
export function holdStats(trades: readonly InsightTrade[]): HoldStats {
  const w: number[] = [], l: number[] = [];
  for (const t of closedOnly(trades)) {
    if (horizonOf(t) !== "intraday" || t.overnight === true) continue;
    const h = t.holdSec;
    if (h == null || !Number.isFinite(h) || h <= 0) continue;
    const r = resultKeyOf(t.pnl, t.fees);
    if (r === "win") w.push(h);
    else if (r === "loss") l.push(h);
  }
  const winners = median(w), losers = median(l);
  const enough = w.length >= MIN.holdEach && l.length >= MIN.holdEach;
  return { winners, losers, nWin: w.length, nLoss: l.length, ratio: enough && winners && losers ? losers / winners : null, enough };
}

/** good = winners held longer, bad = losers held longer (≥ 1.2×), even otherwise. */
export function holdVerdict(ratio: number | null): "good" | "bad" | "even" | null {
  if (ratio == null) return null;
  if (ratio >= 1.2) return "bad";
  if (ratio <= 1 / 1.2) return "good";
  return "even";
}

/* ─────────────────────── «Дни недели» ─────────────────────── */

export type WeekdayStats = { days: Bucket[]; sample: number; enough: boolean; best: string | null; worst: string | null };

/** ISO weekday key «1» (Mon) … «7» (Sun) of the entry date — the «Разрезы» `days` column. */
export function weekdayKey(date: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  if (!m) return null;
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return String(dow === 0 ? 7 : dow);
}

export function weekdayStats(trades: readonly InsightTrade[]): WeekdayStats {
  const map = new Map<string, Bucket>();
  for (const t of closedOnly(trades)) {
    const k = weekdayKey(t.date);
    if (!k) continue;
    const b = map.get(k) ?? emptyBucket(k);
    add(b, t);
    map.set(k, b);
  }
  // Mon–Fri always (a quiet weekday shows as empty), the weekend only when traded.
  const keys = ["1", "2", "3", "4", "5", ...["6", "7"].filter((k) => map.has(k))];
  const days = keys.map((k) => { const b = map.get(k) ?? emptyBucket(k); return { ...b, net: round2(b.net) }; });
  const sample = days.reduce((s, b) => s + b.trades, 0);
  const solid = days.filter((b) => b.trades >= MIN.weekdayDay);
  const enough = sample >= MIN.weekdayTrades && solid.length >= MIN.weekdayDays;
  const sorted = [...solid].sort((a, b) => b.net - a.net);
  return { days, sample, enough, best: enough ? sorted[0].key : null, worst: enough ? sorted[sorted.length - 1].key : null };
}

/* ─────────────────────── «После убытка» ─────────────────────── */

export type AfterStats = { afterLoss: Bucket; afterWin: Bucket; enough: boolean; verdict: "tilt" | "sharp" | "even" | null };

/** Next trade of the same day after a losing vs a winning trade (the «Разрезы» `prev` column). */
export function afterLossStats(trades: readonly InsightTrade[]): AfterStats {
  const fallback = trades.some((t) => t.prevKind == null) ? daySequenceOf(trades) : null;
  const afterLoss = emptyBucket("after-loss"), afterWin = emptyBucket("after-win");
  for (const t of closedOnly(trades)) {
    const k = t.prevKind ?? fallback?.get(t.id)?.prev ?? null;
    if (k === "after-loss") add(afterLoss, t);
    else if (k === "after-win") add(afterWin, t);
  }
  afterLoss.net = round2(afterLoss.net);
  afterWin.net = round2(afterWin.net);
  const enough = afterLoss.trades >= MIN.afterEach && afterWin.trades >= MIN.afterEach;
  const a = winRateOfBucket(afterLoss), b = winRateOfBucket(afterWin);
  const verdict = !enough || a == null || b == null ? null : a < b - 0.1 ? "tilt" : a > b + 0.1 ? "sharp" : "even";
  return { afterLoss, afterWin, enough, verdict };
}

/* ─────────────────────── drill into «Разрезы» ─────────────────────── */

/** Every key a column can hold (the panel's buckets), so «only these» can be written as the unchecked rest. */
export const FACET_KEYS: Partial<Record<FacetDim, readonly string[]>> = {
  seq: [...SEQ_KEYS, UNKNOWN_KEY],
  days: ["1", "2", "3", "4", "5", "6", "7", UNKNOWN_KEY],
  prev: ["first", "after-win", "after-loss", "after-be", UNKNOWN_KEY],
  hold: [...HOLD_BUCKETS.map((b) => b.key), OVERNIGHT_KEY, UNKNOWN_KEY],
};

/** The view with only `keep` checked in `dim` (other columns and «Исключить IMX» untouched). */
export function onlyFacet(view: FacetView, dim: FacetDim, keep: readonly string[]): FacetView {
  const all = FACET_KEYS[dim] ?? [];
  const off = all.filter((k) => !keep.includes(k));
  const next = { ...view.off };
  if (off.length) next[dim] = off;
  else delete next[dim];
  return { ...view, off: next };
}
