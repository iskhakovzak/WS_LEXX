/**
 * Staff view of /stats and /analytics without raw trades (Волна 2 п. 2.5): GET /api/stats/aggregate
 * (api-server routes/stats-aggregate.ts → lib/stats/aggregate.ts) and the pure helpers that turn its buckets into the
 * same shapes the trade-based maths produces (Kpis, DayStat, GroupStat, heat cells, fee stats) — so every card and
 * table renders unchanged. A bucket is a number array in `fields` order; values are summed over closed trades only.
 * aggregate.test.ts proves kpisFromAggregate(server snapshot) === computeKpis(the same trades).
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Trade } from "@workspace/api-client-react";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { maxDrawdown, winRateOf } from "@/lib/trade-math";
import { EVENT_LABEL } from "@/components/shared/trade-labels";
import { fmtDayKey, sessionLabel, type DayStat, type EquityPoint, type FeeStats, type GroupStat, type Kpis, type Metric } from "./metrics";

export const BUCKET_FIELDS = [
  "n", "closed", "wins", "losses",
  "rN", "r", "rPos", "rNeg", "rPosN", "rNegN",
  "pnlN", "gross", "grossPos", "grossNeg", "grossPosN", "grossNegN",
  "net", "netPos", "netNeg", "netPosN", "netNegN",
  "fees", "withFees",
] as const;
export type BucketField = (typeof BUCKET_FIELDS)[number];
export type Bucket = number[];
export type Keyed = { key: string; b: Bucket };
export type GroupDim = "trader" | "setup" | "sector" | "ticker" | "session" | "conviction" | "horizon" | "weekday" | "hour" | "account" | "source";
type ByMetric<T> = Record<Metric, T>;

/** Trade fields the extremes list reads (TradeLinkRow / valueOf). */
export type TradeLite = Pick<Trade, "id" | "ticker" | "date" | "result"> & {
  trader: string | null; exitDate: string | null; side: string | null; setup: string | null; eventType: string | null;
  entry: number | null; exit: number | null; stop: number | null; rMultiple: number | null; pnl: number | null; fees: number | null;
  riskUsd: number | null; horizon: string | null;
};

export interface StatsAggregate {
  scope: "desk" | "trader";
  trader: string | null;
  from: string | null;
  to: string | null;
  /** false: the viewer may not see this book's $ — every money sum is 0. */
  money: boolean;
  fields: readonly BucketField[];
  total: Bucket;
  best: ByMetric<number | null>;
  worst: ByMetric<number | null>;
  streaks: { longestWin: number; longestLoss: number; current: { kind: "win" | "loss" | null; len: number } };
  days: Keyed[];
  groups?: Record<GroupDim, Keyed[]>;
  heat?: Keyed[];
  horizonAll?: Keyed[];
  extremes?: ByMetric<{ best: number[]; worst: number[] }>;
  trades?: TradeLite[];
  rHist?: { bins: number[]; median: number | null; big: number };
  tickersOther?: number;
  options?: { setups: string[]; hasNoSetup: boolean; tickers: string[]; accounts: string[]; sources: string[] };
}

export type AggregateQuery = {
  scope: "desk" | "trader";
  trader?: string | null;
  from?: string | null;
  to?: string | null;
  horizon?: string | null;
  side?: string | null;
  ticker?: string | null;
  setup?: string | null;
  account?: string | null;
  source?: string | null;
  lite?: boolean;
  /** «Фильтры» panel + «Исключить IMX» as x* params (lib/trade-facets facetQuery). */
  facets?: string;
};

export function aggregateParams(q: AggregateQuery): Record<string, string> {
  const p: Record<string, string> = { scope: q.trader ? "trader" : q.scope };
  for (const k of ["trader", "from", "to", "horizon", "side", "ticker", "setup", "account", "source"] as const) {
    const v = q[k];
    if (v) p[k] = v;
  }
  if (q.lite) p.lite = "1";
  if (q.facets) for (const [k, v] of new URLSearchParams(q.facets)) p[k] = v;
  return p;
}

export const STATS_AGGREGATE_KEY = "stats-aggregate";

/** GET /api/stats/aggregate; `enabled` false = not asked (a trader's own view keeps its raw trades). */
export function useStatsAggregate(q: AggregateQuery, enabled = true) {
  const params = aggregateParams(q);
  return useQuery({
    queryKey: [STATS_AGGREGATE_KEY, params],
    queryFn: ({ signal }) => http.get<StatsAggregate>("/api/stats/aggregate", { query: params, signal }),
    staleTime: STALE.short,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/* ───────────── buckets ───────────── */

const IDX = Object.fromEntries(BUCKET_FIELDS.map((k, i) => [k, i])) as Record<BucketField, number>;
export const field = (b: Bucket | undefined, k: BucketField): number => (b ? b[IDX[k]] ?? 0 : 0);

/** Sum and count of the metric's values in a bucket (R: trades with an R; $: trades with a P&L). */
export function metricOf(b: Bucket, metric: Metric): { sum: number; n: number; pos: number; neg: number; posN: number; negN: number } {
  if (metric === "r") return { sum: field(b, "r"), n: field(b, "rN"), pos: field(b, "rPos"), neg: field(b, "rNeg"), posN: field(b, "rPosN"), negN: field(b, "rNegN") };
  const p = metric === "usd" ? "gross" : "net";
  return {
    sum: field(b, p), n: field(b, "pnlN"), pos: field(b, `${p}Pos` as BucketField), neg: field(b, `${p}Neg` as BucketField),
    posN: field(b, `${p}PosN` as BucketField), negN: field(b, `${p}NegN` as BucketField),
  };
}

/** The bucket's value for a metric (null when no trade has one). */
export function bucketValue(b: Bucket, metric: Metric): number | null {
  const m = metricOf(b, metric);
  return m.n ? m.sum : null;
}

/** Calendar days (DayStat without the trade list — the day opens its «Разбор дня»). */
export function daysOf(a: StatsAggregate, metric: Metric): DayStat[] {
  return a.days.map((d) => ({ key: d.key, count: field(d.b, "n"), wins: field(d.b, "wins"), losses: field(d.b, "losses"), value: bucketValue(d.b, metric), trades: [] }));
}

/** KPI cards — the same numbers as computeKpis over the raw trades (aggregate.test.ts). */
export function kpisFromAggregate(a: StatsAggregate, metric: Metric): Kpis {
  const t = a.total;
  const m = metricOf(t, metric);
  const closed = field(t, "closed");
  const wins = field(t, "wins");
  const losses = field(t, "losses");
  const days = daysOf(a, metric);
  const dd = days.some((d) => d.value != null) ? maxDrawdown(days.filter((d) => d.value != null).map((d) => d.value!)) : null;
  const avgWin = m.posN ? m.pos / m.posN : null;
  const avgLoss = m.negN ? m.neg / m.negN : null;
  return {
    total: field(t, "n"),
    closed,
    open: field(t, "n") - closed,
    wins,
    losses,
    breakeven: closed - wins - losses,
    valued: m.n,
    missing: closed - m.n,
    winRate: winRateOf(wins, losses),
    net: m.n ? m.sum : null,
    avgWin,
    avgLoss,
    payoff: avgWin != null && avgLoss != null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    expectancy: m.n ? m.sum / m.n : null,
    profitFactor: m.neg < 0 ? m.pos / Math.abs(m.neg) : null,
    maxDrawdown: m.n ? Math.round((dd ?? 0) * 1e6) / 1e6 : null,
    bestTrade: m.n ? a.best[metric] : null,
    worstTrade: m.n ? a.worst[metric] : null,
    longestWin: a.streaks.longestWin,
    longestLoss: a.streaks.longestLoss,
    current: a.streaks.current,
    tradingDays: days.length,
    greenDays: days.filter((d) => d.value != null && d.value > 0).length,
    redDays: days.filter((d) => d.value != null && d.value < 0).length,
  };
}

/** Daily equity curve (end of day) with its drawdown under the running peak. */
export function dailyEquity(days: readonly DayStat[]): EquityPoint[] {
  let cum = 0, peak = 0;
  const out: EquityPoint[] = [];
  for (const d of days) {
    if (d.value == null) continue;
    cum += d.value;
    peak = Math.max(peak, cum);
    out.push({ idx: out.length + 1, equity: cum, drawdown: cum - peak, label: fmtDayKey(d.key), id: 0 });
  }
  return out;
}

export function monthlyOf(a: StatsAggregate, metric: Metric): { month: string; value: number; count: number }[] {
  const map = new Map<string, { month: string; value: number; count: number }>();
  for (const d of a.days) {
    const m = metricOf(d.b, metric);
    if (!m.n) continue;
    const k = d.key.substring(0, 7);
    const e = map.get(k) ?? { month: k, value: 0, count: 0 };
    e.value += m.sum;
    e.count += m.n;
    map.set(k, e);
  }
  return [...map.values()].sort((x, y) => x.month.localeCompare(y.month));
}

/** A breakdown row as the trade-based groupBy builds it. */
export function groupStat(key: string, b: Bucket, metric: Metric): GroupStat {
  const m = metricOf(b, metric);
  const wins = field(b, "wins"), losses = field(b, "losses");
  return {
    key, count: field(b, "n"), closed: field(b, "closed"), wins,
    winRate: wins + losses ? wins / (wins + losses) : null,
    value: m.n ? m.sum : null, avg: m.n ? m.sum / m.n : null, valued: m.n,
  };
}

/** Display key of a server group key (event types, sessions and conviction get the page's labels). */
export function groupLabel(dim: GroupDim, key: string): string {
  if (dim === "setup" && key.startsWith("~ev:")) { const ev = key.slice(4); return EVENT_LABEL[ev] ?? ev; }
  if (dim === "session") return sessionLabel(key);
  if (dim === "conviction") return key === "—" ? key : `${key}★`;
  return key;
}

export function groupsOf(a: StatsAggregate, dim: GroupDim, metric: Metric): GroupStat[] {
  return (a.groups?.[dim] ?? []).map((g) => groupStat(groupLabel(dim, g.key), g.b, metric));
}

/** Fees card: gross vs net over closed trades with a P&L, and how many of them carry no fee. */
export function feesOf(a: StatsAggregate): { fees: FeeStats; closed: number; noFee: number } {
  const t = a.total;
  const withPnl = field(t, "pnlN");
  return {
    fees: { gross: withPnl ? field(t, "gross") : null, fees: field(t, "fees"), net: withPnl ? field(t, "net") : null, withFees: field(t, "withFees"), withPnl },
    closed: field(t, "closed"),
    noFee: withPnl - field(t, "withFees"),
  };
}

/** Weekday × hour cells of the heatmap ({n, closed, wins, losses, v}) keyed "weekday|hour". */
export type HeatCell = { n: number; closed: number; wins: number; losses: number; v: number | null };
export function heatOf(a: StatsAggregate, metric: Metric): Map<string, HeatCell> {
  return new Map((a.heat ?? []).map((c) => [c.key, { n: field(c.b, "n"), closed: field(c.b, "closed"), wins: field(c.b, "wins"), losses: field(c.b, "losses"), v: bucketValue(c.b, metric) }]));
}

/** The best / worst trades of a metric as rows for the extremes list. */
export function extremesOf(a: StatsAggregate, metric: Metric): { best: Trade[]; worst: Trade[] } {
  const byId = new Map((a.trades ?? []).map((t) => [t.id, t as unknown as Trade]));
  const pick = (ids: number[] | undefined) => (ids ?? []).map((id) => byId.get(id)).filter((t): t is Trade => !!t);
  return { best: pick(a.extremes?.[metric].best), worst: pick(a.extremes?.[metric].worst) };
}
