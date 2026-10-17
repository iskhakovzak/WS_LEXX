/**
 * Data layer for the edge-finder tabs: server aggregates (/api/edge/*), risk limits (/api/risk/me),
 * filter → query-string mapping and the Trade → SimTrade adapter used by What-if and Monte Carlo.
 */
import { useQuery } from "@tanstack/react-query";
import type { Trade } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api";
import { signedR, netPnl, isOpen, horizonOf } from "@/lib/trade-math";
import { type AnalyticsFilters, periodRange, day, sortChrono } from "./metrics";
import type { SimTrade } from "./edge-stats";

/* ─── Types mirrored from api-server/src/routes/edge.ts ─────────────────── */

export const EDGE_DIMENSIONS = [
  "setup", "horizon", "tod", "hold", "catalyst", "cap", "float", "gap", "weekday", "grade", "conviction", "plan",
  "side", "trader", "account", "source", "month", "ticker",
] as const;
export type EdgeDimension = (typeof EDGE_DIMENSIONS)[number];

export const EDGE_DIMENSION_LABEL: Record<EdgeDimension, string> = {
  setup: "Сетап", horizon: "Горизонт", tod: "Время входа", hold: "Время в сделке", catalyst: "Катализатор",
  cap: "Капитализация", float: "Флоат", gap: "Гэп", weekday: "День недели", grade: "Оценка сетапа",
  conviction: "Уверенность", plan: "По плану", side: "Сторона", trader: "Трейдер", account: "Счёт", source: "Источник",
  month: "Месяц", ticker: "Тикер",
};

export type EdgeCell = {
  row: string; col: string;
  n: number; closed: number; wins: number; losses: number; be: number;
  sumR: number; rN: number; posR: number; negR: number;
  gross: number; net: number; fees: number; pnlN: number; posNet: number; negNet: number;
  rValues: number[]; netValues: number[];
};

export type EdgeMatrix = {
  rows: EdgeDimension; cols: EdgeDimension; tod: number; scope: string | null;
  rowKeys: string[]; colKeys: string[]; cells: EdgeCell[]; total: number; hasJournal: boolean; generatedAt: string;
};

export type EdgeCostRow = {
  key: string;
  trades: number; closed: number; tradesWithPnl: number; tradesWithFees: number;
  gross: number; grossWins: number; fees: number; net: number;
  feePctOfGrossWins: number | null; feePctOfGross: number | null;
  shares: number; feePerShare: number | null; feePerTrade: number | null;
  slippageN: number; slippageSum: number; slippageAvg: number | null;
};
export type EdgeCostGroup = "trader" | "account" | "month" | "setup" | "horizon";
export type EdgeCosts = {
  group: EdgeCostGroup; scope: string | null; items: EdgeCostRow[];
  total: Omit<EdgeCostRow, "key" | "feePerShare" | "feePerTrade" | "slippageAvg" | "feePctOfGross" | "feePctOfGrossWins"> & {
    feePctOfGrossWins: number | null; feePctOfGross: number | null; feePerShare: number | null; feePerTrade: number | null; slippageAvg: number | null;
  };
  generatedAt: string;
};

export type RiskLimits = {
  accountSize: number | null; dailyLossLimit: number | null; weeklyLossLimit: number | null; maxDrawdown: number | null;
};
export type RiskMe = { limits: RiskLimits | null } & Record<string, unknown>;

/* ─── Filters → query string ─────────────────────────────────────────────── */

export function edgeParams(filters: AnalyticsFilters, extra: Record<string, string | number | undefined> = {}): string {
  const sp = new URLSearchParams();
  const range = periodRange(filters.period);
  if (range) { sp.set("from", range.from); sp.set("to", range.to); }
  if (filters.trader) sp.set("trader", filters.trader);
  if (filters.horizon) sp.set("horizon", filters.horizon);
  if (filters.side) sp.set("side", filters.side);
  if (filters.account) sp.set("account", filters.account);
  if (filters.source) sp.set("source", filters.source);
  if (filters.setup && filters.setup !== "__none__") sp.set("setup", filters.setup);
  if (filters.ticker) sp.set("ticker", filters.ticker);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") sp.set(k, String(v));
  return sp.toString();
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(apiUrl(path));
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json() as Promise<T>;
}

export function useEdgeMatrix(filters: AnalyticsFilters, rows: EdgeDimension, cols: EdgeDimension, tod: 15 | 30, enabled = true) {
  const params = edgeParams(filters, { rows, cols, tod });
  return useQuery<EdgeMatrix>({
    queryKey: ["edge-matrix", params],
    enabled,
    staleTime: 60_000,
    queryFn: () => getJson<EdgeMatrix>(`/api/edge/matrix?${params}`),
  });
}

export function useEdgeCosts(filters: AnalyticsFilters, group: EdgeCostGroup, enabled = true) {
  const params = edgeParams(filters, { group });
  return useQuery<EdgeCosts>({
    queryKey: ["edge-costs", params],
    enabled,
    staleTime: 60_000,
    queryFn: () => getJson<EdgeCosts>(`/api/edge/costs?${params}`),
  });
}

/** Caller's risk limits; resolves to null when the risk desk is not installed (404) or the caller has no limits. */
export function useRiskLimits() {
  return useQuery<RiskLimits | null>({
    queryKey: ["edge-risk-me"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const me = await getJson<RiskMe>("/api/risk/me");
        return me?.limits ?? null;
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
  });
}

/* ─── Key labels for server dimensions ───────────────────────────────────── */

const SESSION_LABEL: Record<string, string> = { premarket: "Премаркет", regular: "Основная сессия", rth: "Основная сессия", afterhours: "Постмаркет", postmarket: "Постмаркет" };

export function edgeKeyLabel(dim: EdgeDimension, key: string, tod: number): string {
  if (dim === "tod") {
    if (key.startsWith("m")) {
      const m = Number(key.slice(1));
      if (Number.isFinite(m)) {
        const to = m + tod;
        const f = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
        return `${f(m)}–${f(to)}`;
      }
    }
    if (key.startsWith("s:")) { const s = key.slice(2); return SESSION_LABEL[s.toLowerCase()] ?? s; }
  }
  if (dim === "horizon") return key === "intraday" ? "Интрадей" : key === "overnight" ? "Овернайт" : key === "swing" ? "Свинг" : key;
  return key;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс", "Без даты"];
const GRADES = ["A+", "A", "B", "C", "Без оценки"];
const HOLD = ["До 5 мин", "5–15 мин", "15–60 мин", "1–4 ч", "Больше 4 ч", "Больше дня", "Не указано"];
const CAP = ["Нано < $50M", "Микро $50–300M", "Малая $300M–2B", "Средняя $2–10B", "Крупная > $10B", "Нет капитализации"];
const FLOAT = ["Флоат < 10M", "Флоат 10–50M", "Флоат 50–200M", "Флоат > 200M", "Нет флоата"];
const GAP = ["Гэп ≤ −10%", "Гэп −3…−10%", "Гэп ±3%", "Гэп +3…10%", "Гэп +10…30%", "Гэп > 30%", "Гэп вверх", "Гэп вниз", "Другой гэп", "Без гэпа"];
const HORIZON = ["intraday", "overnight", "swing"];
const PLAN = ["По плану", "Не по плану", "Не отмечено"];

/** Natural ordering for a dimension's keys (time buckets numeric, known lists fixed, else alphabetical with "Без…" last). */
export function sortEdgeKeys(dim: EdgeDimension, keys: string[]): string[] {
  const fixed =
    dim === "weekday" ? WEEKDAYS : dim === "grade" ? GRADES : dim === "hold" ? HOLD : dim === "cap" ? CAP : dim === "float" ? FLOAT
      : dim === "gap" ? GAP : dim === "horizon" ? HORIZON : dim === "plan" ? PLAN : null;
  const rank = (k: string) => {
    if (dim === "tod") return k.startsWith("m") ? Number(k.slice(1)) : k.startsWith("s:") ? 10_000 : 20_000;
    if (dim === "conviction") return k === "Без уверенности" ? 99 : Number(k.split("/")[0]) || 50;
    if (fixed) { const i = fixed.indexOf(k); return i < 0 ? fixed.length : i; }
    return /^(Без|Нет |Не указан)/.test(k) ? 1 : 0;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "ru"));
}

/* ─── Trade → SimTrade ───────────────────────────────────────────────────── */

/** Minutes since midnight of the entry when `date` carries a time (YYYY-MM-DDTHH:MM…), else null. */
export function entryMinutesOf(t: Trade): number | null {
  const raw = t.date ?? "";
  const m = raw.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Closed trades in chronological order as simulation inputs (open trades are skipped). */
export function toSimTrades(trades: Trade[]): SimTrade[] {
  return sortChrono(trades)
    .filter((t) => !isOpen(t))
    .map((t, i) => ({
      id: t.id,
      day: day(t),
      entryMin: entryMinutesOf(t),
      setup: (t.setup ?? "").trim() || "Без сетапа",
      grade: (t.confidenceGrade ?? "").trim() || null,
      horizon: horizonOf(t),
      r: signedR(t),
      net: netPnl(t),
      seq: i,
    }));
}
