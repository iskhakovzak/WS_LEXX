/**
 * «Мой edge и рынок» — data layer: types mirrored from api-server/src/lib/myEdge, the query hooks and the strengths
 * ADAPTER. The ranked strengths come from GET /api/my-edge/strengths today; the coaching branch builds a server-side
 * shrunk edge map (GET /api/edge/map) with the same statistics — `strengthsSource()` switches to it (localStorage
 * `ws.myedge.source = "edge-map"`, or STRENGTHS_SOURCE below), and `fromEdgeMap` maps its answer into the same rows.
 * A missing / failing edge map falls back to /my-edge (never a blank block).
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { edgeParams } from "../edge-api";
import { filtersRange, type AnalyticsFilters } from "../metrics";

export type MeInterval = { point: number; lo: number; hi: number };
export type MeStatus = "reliable" | "hypothesis" | "low";
export type MeBlock = { trades: number; perTrade: number | null; sign: 1 | -1 | 0 };

export type MeRow = {
  dim: string;
  key: string;
  trades: number;
  days: number;
  net: number;
  winRate: number | null;
  perDay: MeInterval;
  perTrade: MeInterval;
  p: number;
  q: number | null;
  status: MeStatus;
  blocks: MeBlock[];
  persist: number;
  outcome: boolean;
  ids: number[];
  idsTruncated: boolean;
};

export type MeCoverage = { dim: string; known: number; total: number };
export type MeTotals = { trades: number; days: number; net: number; perDay: number | null };

export type StrengthsData = {
  source: "my-edge" | "edge-map";
  trader: string;
  typicalDay: number | null;
  totals: MeTotals;
  rows: MeRow[];
  strengths: MeRow[];
  leaks: MeRow[];
  coverage: MeCoverage[];
};

export type MarketData = {
  trader: string;
  totals: MeTotals;
  rows: MeRow[];
  coverage: MeCoverage[];
  eodDims: string[];
  missingFeeds: string[];
};

export type CompareMetric = "expectancy" | "winRate" | "payoff" | "feesShare" | "tradesPerDay" | "holdMin";
export type CompareRow = { metric: CompareMetric; current: MeInterval | null; previous: MeInterval | null; diff: MeInterval | null; changed: boolean };
export type CompareData = {
  trader: string;
  days: { current: number; previous: number };
  trades: { current: number; previous: number };
  rows: CompareRow[];
};

export type TodayBasis =
  | { basis: "gap"; dim: "spyGap"; key: string; asOf: string; gapPct: number | null }
  | { basis: "prevVol"; dim: "spyPrevVol"; key: string; asOf: string; rangeAtr: number | null }
  | { basis: null; dim: null; key: null; asOf: string | null };
export type TodayData = { trader: string; today: string; basis: TodayBasis; row: MeRow | null; siblings: MeRow[]; coverage: MeCoverage | null };

/* ─── Strengths adapter ─────────────────────────────────────────────────── */

export type StrengthsSource = "my-edge" | "edge-map";
/** Build-time default; flip to "edge-map" once GET /api/edge/map ships on main. */
export const STRENGTHS_SOURCE: StrengthsSource = "my-edge";
const SOURCE_KEY = "ws.myedge.source";

export function strengthsSource(): StrengthsSource {
  try {
    const v = localStorage.getItem(SOURCE_KEY);
    if (v === "edge-map" || v === "my-edge") return v;
  } catch { /* storage unavailable */ }
  return STRENGTHS_SOURCE;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function intervalOf(v: unknown, fallbackPoint: number | null): MeInterval | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const point = num(o.point ?? o.mean ?? o.est ?? o.shrunk) ?? fallbackPoint;
    const lo = num(o.lo ?? o.low ?? o.lower ?? o.p10);
    const hi = num(o.hi ?? o.high ?? o.upper ?? o.p90);
    if (point != null && lo != null && hi != null) return { point, lo, hi };
  }
  return null;
}

function statusOf(v: unknown, q: number | null, days: number, trades: number): MeStatus {
  if (v === "reliable" || v === "hypothesis" || v === "low") return v;
  if (v === "robust" || v === "confirmed") return "reliable";
  if (v === "insufficient" || v === "lowData" || days < 5 || trades < 10 || q == null) return "low";
  return q <= 0.1 ? "reliable" : "hypothesis";
}

/** One edge-map cell → a strengths row (tolerant to the coaching branch's field names); null when unusable. */
export function edgeMapRow(c: Record<string, unknown>): MeRow | null {
  const dim = typeof c.dim === "string" ? c.dim : typeof c.dimension === "string" ? c.dimension : null;
  const key = typeof c.key === "string" ? c.key : typeof c.bucket === "string" ? c.bucket : null;
  const trades = num(c.trades ?? c.n) ?? 0;
  const days = num(c.days ?? c.nDays) ?? 0;
  const perDay = intervalOf(c.perDay ?? c.day, null);
  const perTrade = intervalOf(c.perTrade ?? c.trade, null);
  if (!dim || !key || !perDay || !perTrade || !trades) return null;
  const q = num(c.q ?? c.qValue);
  const blocks = Array.isArray(c.blocks) ? (c.blocks as MeBlock[]) : [];
  const sign = Math.sign(perDay.point);
  return {
    dim, key, trades, days, net: num(c.net) ?? perDay.point * days, winRate: num(c.winRate),
    perDay, perTrade, p: num(c.p) ?? 1, q, status: statusOf(c.status, q, days, trades), blocks,
    persist: num(c.persist) ?? (sign ? blocks.filter((b) => b.sign === sign).length : 0),
    outcome: c.outcome === true || dim === "hold",
    ids: Array.isArray(c.ids) ? (c.ids as unknown[]).map(Number).filter((x) => Number.isInteger(x)) : [],
    idsTruncated: c.idsTruncated === true,
  };
}

/** The edge map answer → StrengthsData (ranking as on /my-edge: status, then the conservative impact). */
export function fromEdgeMap(raw: unknown, trader: string): StrengthsData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.rows) ? o.rows : Array.isArray(o.cells) ? o.cells : null;
  if (!list) return null;
  const rows = list.map((c) => (c && typeof c === "object" ? edgeMapRow(c as Record<string, unknown>) : null)).filter((r): r is MeRow => !!r);
  const rank = (s: MeStatus) => (s === "reliable" ? 0 : s === "hypothesis" ? 1 : 2);
  const impact = (r: MeRow) => Math.abs(r.perDay.point > 0 ? Math.max(0, r.perDay.lo) : Math.min(0, r.perDay.hi)) * r.days;
  const usable = rows.filter((r) => r.status !== "low" && !r.outcome);
  const order = (a: MeRow, b: MeRow) => rank(a.status) - rank(b.status) || impact(b) - impact(a);
  const tradesTotal = num((o.totals as Record<string, unknown> | undefined)?.trades) ?? 0;
  return {
    source: "edge-map", trader,
    typicalDay: num(o.typicalDay),
    totals: { trades: tradesTotal, days: num((o.totals as Record<string, unknown> | undefined)?.days) ?? 0, net: num((o.totals as Record<string, unknown> | undefined)?.net) ?? 0, perDay: null },
    rows,
    strengths: usable.filter((r) => r.perDay.point > 0).sort(order).slice(0, 6),
    leaks: usable.filter((r) => r.perDay.point < 0).sort(order).slice(0, 6),
    coverage: Array.isArray(o.coverage) ? (o.coverage as MeCoverage[]) : [],
  };
}

export async function fetchStrengths(params: string, trader: string, source: StrengthsSource, signal?: AbortSignal): Promise<StrengthsData> {
  if (source === "edge-map") {
    try {
      const mapped = fromEdgeMap(await http.get<unknown>(`/api/edge/map?${params}`, { signal }), trader);
      if (mapped && mapped.rows.length) return mapped;
    } catch (e) {
      if (signal?.aborted) throw e;
      /* the edge map is not there (yet) — fall back */
    }
  }
  return http.get<StrengthsData>(`/api/my-edge/strengths?${params}`, { signal });
}

/* ─── Hooks ─────────────────────────────────────────────────────────────── */

/** The query string of the tab (period, trader, page filters, «Разрезы»). */
export const myEdgeParams = (filters: AnalyticsFilters) => edgeParams(filters);

export function useStrengths(filters: AnalyticsFilters, enabled = true) {
  const params = myEdgeParams(filters);
  const source = strengthsSource();
  return useQuery<StrengthsData>({
    queryKey: ["my-edge", "strengths", source, params, filters.trader],
    enabled,
    staleTime: STALE.long,
    queryFn: ({ signal }) => fetchStrengths(params, filters.trader, source, signal),
  });
}

export function useMarket(filters: AnalyticsFilters, enabled = true) {
  const params = myEdgeParams(filters);
  return useQuery<MarketData>({
    queryKey: ["my-edge", "market", params],
    enabled,
    staleTime: STALE.long,
    queryFn: ({ signal }) => http.get<MarketData>(`/api/my-edge/market?${params}`, { signal }),
  });
}

export function useCompare(filters: AnalyticsFilters, enabled = true) {
  const range = filtersRange(filters);
  const params = range ? myEdgeParams(filters) + `&prevFrom=${range.prevFrom}&prevTo=${range.prevTo}` : "";
  return useQuery<CompareData>({
    queryKey: ["my-edge", "compare", params],
    enabled: enabled && !!range,
    staleTime: STALE.long,
    queryFn: ({ signal }) => http.get<CompareData>(`/api/my-edge/compare?${params}`, { signal }),
  });
}

export function useTodayEdge(trader: string | null | undefined, enabled = true) {
  const q = trader ? `?trader=${encodeURIComponent(trader)}` : "";
  return useQuery<TodayData>({
    queryKey: ["my-edge", "today", q],
    enabled,
    staleTime: STALE.long,
    queryFn: ({ signal }) => http.get<TodayData>(`/api/my-edge/today${q}`, { signal }),
  });
}
