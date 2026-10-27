/**
 * «Где уходят деньги» — the edge map: every slice of the trader's book along the «Разрезы» columns that describe a
 * behaviour (time of entry, trade number in the day, after a loss / a win, price band, strategy), with its net, its
 * difference to the trader's average trade and a day-clustered 80% interval of the slice total.
 *
 * Adapter: the tile reads an `EdgeMap` only. Today it is computed here, client-side, from the trades the page already
 * holds (`clientEdgeMap`). The coach wave (coach-w1) adds a server-side, shrunk edge map; when it lands, add a source in
 * `useEdgeMap` that fetches it and maps the response with a `fromServer…` function into the same `EdgeMap` shape (one
 * place, no tile changes). Keys and dims are the «Разрезы» keys, so drills keep working with either source.
 *
 * Honesty rules: unknown buckets are never a slice; a slice needs MIN_TRADES trades on MIN_DAYS days; a slice that holds
 * almost the whole book (≥ MAX_SHARE) says nothing about a behaviour and is skipped; the confidence label is computed per
 * slice and the number of slices tested is reported, so a lucky slice among many is not sold as a finding.
 */
import { useMemo } from "react";
import { entryMinutes, netPnl } from "@/lib/trade-math";
import { CI_LEVEL, confidenceOf, dayBootstrap, type Confidence, type Interval } from "@/lib/stats-lite";
import { PRICE_BUCKETS, TIME_BUCKETS, UNKNOWN_KEY, priceKeyOf, seqKeyOf, timeBucketOfSec, type FacetDim } from "@/lib/trade-facets";
import type { Rule } from "@/components/shared/what-if-rules";
import { closedOnly, daySequenceOf, realisedDay, round2, type InsightTrade } from "./model";

export type EdgeDim = Extract<FacetDim, "times" | "seq" | "prev" | "price" | "strategies">;
export const EDGE_DIMS: readonly EdgeDim[] = ["times", "seq", "prev", "price", "strategies"];

export const EDGE_MIN = { trades: 10, days: 4 } as const;
/** A slice with this share of the book or more is the book itself, not a behaviour. */
export const MAX_SHARE = 0.85;

export type EdgeSlice = {
  dim: EdgeDim;
  key: string;
  trades: number;
  /** Days the slice traded on. */
  days: number;
  wins: number;
  losses: number;
  net: number;
  /** Net per trade. */
  avg: number;
  /** avg − the book's average trade. */
  vsBaseline: number;
  /** 80% day-clustered interval of the slice total over the window. */
  ci: Interval | null;
  /** Of the claim «this slice loses» (leaks) / «earns» (strengths). */
  confidence: Confidence;
  /** Ids of the slice's trades (newest first) — «open the exact trades». */
  ids: number[];
  best: { id: number; ticker: string; net: number } | null;
  worst: { id: number; ticker: string; net: number } | null;
};

export type EdgeMap = {
  source: "client" | "server";
  leaks: EdgeSlice[];
  strengths: EdgeSlice[];
  /** Slices that passed the sample floor (the honest denominator). */
  tested: number;
  /** The book: closed trades, net, average trade. */
  total: { trades: number; days: number; net: number; avg: number | null };
};

const RANK: Record<Confidence, number> = { solid: 0, hypothesis: 1, low: 2 };

/** The slice key of a trade in each edge dim (unknown when the row lacks the data). */
export function edgeKeysOf(t: InsightTrade, fallback: Map<number, { seq: number; prev: string | null }> | null): Record<EdgeDim, string> {
  const mins = t.entrySec == null ? entryMinutes(t as never) : null;
  const sec = t.entrySec ?? (mins != null ? mins * 60 : null);
  const fb = fallback?.get(t.id);
  return {
    times: timeBucketOfSec(sec),
    seq: seqKeyOf(t.daySeq ?? fb?.seq ?? null),
    prev: t.prevKind ?? fb?.prev ?? UNKNOWN_KEY,
    price: priceKeyOf(t.entry),
    strategies: (t.strategy ?? "").trim() || UNKNOWN_KEY,
  };
}

/** Keys that are a behaviour worth naming («first trade of the day» is the seq «№1» slice already). */
const SKIP = new Set([UNKNOWN_KEY, "first", "after-be"]);

type Row = { id: number; ticker: string; day: string; net: number; keys: Record<EdgeDim, string> };

function rowsOf(trades: readonly InsightTrade[]): Row[] {
  const closed = closedOnly(trades);
  const fallback = closed.some((t) => t.daySeq == null || t.prevKind == null) ? daySequenceOf(closed) : null;
  return closed.map((t) => ({ id: t.id, ticker: t.ticker, day: realisedDay(t), net: netPnl(t) ?? 0, keys: edgeKeysOf(t, fallback) }));
}

/** Net of one slice in a list of trades (the previous period's value for the trend). */
export function sliceNet(trades: readonly InsightTrade[], dim: EdgeDim, key: string): { trades: number; net: number } {
  let n = 0, net = 0;
  for (const r of rowsOf(trades)) if (r.keys[dim] === key) { n++; net += r.net; }
  return { trades: n, net: round2(net) };
}

/** The edge map of a book, computed client-side. */
export function clientEdgeMap(trades: readonly InsightTrade[], opts: { level?: number } = {}): EdgeMap {
  const rows = rowsOf(trades);
  const allDays = [...new Set(rows.map((r) => r.day))].sort();
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const baseline = rows.length ? totalNet / rows.length : null;
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    for (const dim of EDGE_DIMS) {
      const key = r.keys[dim];
      if (SKIP.has(key)) continue;
      const id = `${dim}\u0000${key}`;
      const g = groups.get(id);
      if (g) g.push(r);
      else groups.set(id, [r]);
    }
  }

  const slices: EdgeSlice[] = [];
  for (const [id, list] of groups) {
    const [dim, key] = id.split("\u0000") as [EdgeDim, string];
    const days = new Set(list.map((r) => r.day)).size;
    if (list.length < EDGE_MIN.trades || days < EDGE_MIN.days || list.length >= MAX_SHARE * rows.length) continue;
    const net = list.reduce((s, r) => s + r.net, 0);
    const avg = net / list.length;
    // One row per day of the WINDOW (zero on days without the slice): the total's spread includes the quiet days.
    const perDay = new Map<string, number>(allDays.map((d) => [d, 0]));
    for (const r of list) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.net);
    const dayRows = [...perDay].map(([day, sum]) => ({ day, sum }));
    const ci = dayBootstrap(dayRows, (r) => r.day, (rs) => rs.reduce((s, r) => s + r.sum, 0), { level: opts.level ?? CI_LEVEL, seed: id });
    const confidence = confidenceOf(ci, net < 0 ? "below" : "above", { n: list.length, minN: EDGE_MIN.trades, days, minDays: EDGE_MIN.days });
    const sorted = [...list].sort((a, b) => a.net - b.net);
    const newest = [...list].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.id - a.id));
    slices.push({
      dim, key, trades: list.length, days,
      wins: list.filter((r) => r.net > 0).length,
      losses: list.filter((r) => r.net < 0).length,
      net: round2(net), avg: round2(avg), vsBaseline: round2(avg - (baseline ?? 0)),
      ci, confidence,
      ids: newest.map((r) => r.id),
      best: sorted.length && sorted[sorted.length - 1].net > 0 ? pick(sorted[sorted.length - 1]) : null,
      worst: sorted.length && sorted[0].net < 0 ? pick(sorted[0]) : null,
    });
  }

  const byRank = (dir: 1 | -1) => (a: EdgeSlice, b: EdgeSlice) => RANK[a.confidence] - RANK[b.confidence] || dir * (a.net - b.net);
  return {
    source: "client",
    leaks: slices.filter((s) => s.net < 0).sort(byRank(1)),
    strengths: slices.filter((s) => s.net > 0).sort(byRank(-1)),
    tested: slices.length,
    total: { trades: rows.length, days: allDays.length, net: round2(totalNet), avg: baseline == null ? null : round2(baseline) },
  };
}

const pick = (r: Row) => ({ id: r.id, ticker: r.ticker, net: round2(r.net) });

/** The What-if rule that removes a leaking slice, when the simulator has one (else null: the tile drills instead). */
export function ruleForSlice(s: Pick<EdgeSlice, "dim" | "key">): Rule | null {
  switch (s.dim) {
    case "seq": {
      const cut: Record<string, number> = { "2": 1, "3": 2, "4-5": 3, "6+": 5 };
      return cut[s.key] ? { type: "maxTradesPerDay", n: cut[s.key] } : null;
    }
    case "prev":
      return s.key === "after-loss" ? { type: "afterLoss", minutes: 30 } : null;
    case "times": {
      const i = TIME_BUCKETS.findIndex((b) => b.key === s.key);
      if (i < 0) return null;
      const hhmm = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
      // Early buckets → start later; late buckets → stop earlier. A midday bucket has no one-sided window.
      if (i <= 3) return { type: "timeWindow", from: hhmm(TIME_BUCKETS[i].before), to: null };
      if (i >= 6) return { type: "timeWindow", from: null, to: hhmm(TIME_BUCKETS[i - 1].before) };
      return null;
    }
    case "price": {
      const i = PRICE_BUCKETS.findIndex((b) => b.key === s.key);
      if (i === 0) return { type: "priceRange", min: PRICE_BUCKETS[0].before, max: null };
      if (i === PRICE_BUCKETS.length - 1) return { type: "priceRange", min: null, max: PRICE_BUCKETS[i - 1].before };
      return null;
    }
    case "strategies":
      return s.key === "MOC" ? { type: "excludeImx" } : null;
  }
}

/**
 * The edge map the tile shows. Source today: client-side over `trades`. Server source (coach-w1): fetch here and return
 * `{ ...fromServer(resp), source: "server" }` when available, falling back to the client map.
 */
export function useEdgeMap(trades: readonly InsightTrade[] | undefined): EdgeMap | null {
  return useMemo(() => (trades ? clientEdgeMap(trades) : null), [trades]);
}
