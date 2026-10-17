import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Candle } from "@/components/chart-engine/types";
import { BASE } from "@/lib/api";
import {
  DAY_CHANGE_EVENT, big7Today, getTickerDay, updateTickerDayField, getMarketContext, saveMarketContext,
  type AutoEarning, type Catalyst, type GapRiskResponse, type MarketCtx, type RiskMeLite, type StockQuote, type TickerDay,
} from "./lib";

async function readError(res: Response) {
  try {
    const j = await res.json();
    return j?.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export const CATALYSTS_KEY = ["big7-catalysts"] as const;

/**
 * Current NY trading date that re-renders the caller when it changes (checked every 30 s and when the tab
 * becomes visible again) — the board, hot list and catalyst week roll over at NY midnight without a reload.
 */
export function useBig7Today(): string {
  const [today, setToday] = useState(big7Today);
  useEffect(() => {
    const tick = () => setToday((prev) => { const next = big7Today(); return next === prev ? prev : next; });
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return today;
}

export type SessionBars = { candles: Candle[]; prevClose: number | null };

/**
 * 5-minute extended-hours bars for the board + benchmarks over a few sessions (GET /api/candles/:t/range).
 * The server stores past days permanently and refreshes today every 5 min, so Yahoo is hit at most once
 * per symbol per 5 min. We re-poll every 3 min only while `live` (pre-market / regular hours) and the tab
 * is visible; a closed session is fetched once.
 */
export function useSessionBars(symbols: string[], from: string, to: string, live: boolean) {
  const results = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ["big7-bars", s, from, to] as const,
      queryFn: async (): Promise<SessionBars | null> => {
        const r = await fetch(`${BASE}/api/candles/${encodeURIComponent(s)}/range?from=${from}&to=${to}&interval=5m&extended=1`);
        if (!r.ok) return null;
        const j = (await r.json()) as { candles?: Candle[]; prevClose?: number | null };
        return { candles: Array.isArray(j.candles) ? j.candles : [], prevClose: j.prevClose ?? null };
      },
      staleTime: live ? 120_000 : 60 * 60_000,
      gcTime: 2 * 60 * 60_000,
      refetchInterval: live ? 180_000 : (false as const),
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: live,
      retry: 1,
    })),
  });
  const data: Record<string, SessionBars | null | undefined> = {};
  symbols.forEach((s, i) => { data[s] = results[i]?.data; });
  return {
    data,
    loading: results.some((r) => r.isLoading),
    fetching: results.some((r) => r.isFetching),
    updatedAt: results.reduce((m, r) => Math.max(m, r.dataUpdatedAt || 0), 0),
    /** Changes whenever any symbol's data changes (memo key for derived models). */
    version: results.reduce((a, r) => a + (r.dataUpdatedAt || 0), 0) + ":" + results.length,
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}

export type MyAgg = { n: number; net: number; wins: number; losses: number; wr: number | null; avg: number | null };
export type MyHour = MyAgg & { key: string; label: string };
export type MyTicker = MyAgg & {
  ticker: string;
  longNet: number;
  shortNet: number;
  lastDate: string | null;
  bestHour: { key: string; label: string; net: number; n: number } | null;
  worstHour: { key: string; label: string; net: number; n: number } | null;
};
export type MyStats = { trader: string; from: string | null; total: MyAgg; tickers: MyTicker[]; hours: MyHour[] };

/** The trader's own results on the board tickers (GET /api/big7/mystats). null → endpoint absent or no access. */
export function useMyStats(symbols: string[], days: number, trader: string | null | undefined) {
  const key = [...symbols].sort().join(",");
  return useQuery<MyStats | null>({
    queryKey: ["big7-mystats", key, days, trader ?? ""],
    queryFn: async () => {
      const qs = new URLSearchParams({ symbols: key, days: String(days) });
      if (trader) qs.set("trader", trader);
      const r = await fetch(`${BASE}/api/big7/mystats?${qs}`);
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("json")) return null;
      return (await r.json()) as MyStats;
    },
    enabled: symbols.length > 0,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

/**
 * Quotes (board + SPY/QQQ). Server caches 60s; we poll every 60s only while `live` (regular session)
 * and the tab is visible. Outside the session one fetch is enough (avg volume, prior close).
 */
export function useQuotes(symbols: string[], live = true) {
  const key = symbols.join(",");
  return useQuery<Record<string, StockQuote>>({
    queryKey: ["stockdata-quote", key],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/stockdata/quote?symbols=${encodeURIComponent(key)}`);
      if (!r.ok) return {};
      const j = await r.json();
      return j && typeof j === "object" ? j : {};
    },
    enabled: symbols.length > 0,
    staleTime: live ? 60_000 : 30 * 60_000,
    refetchInterval: live ? 60_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
    retry: 1,
  });
}

/** Daily-bar stats (ATR, overnight gaps, RS vs SPY/QQQ). Changes slowly → 20 min stale, no polling. */
export function useGapRisk(symbols: string[]) {
  const key = [...symbols].sort().join(",");
  return useQuery<GapRiskResponse | null>({
    queryKey: ["big7-gaprisk", key],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/big7/gaprisk?symbols=${encodeURIComponent(key)}`);
      if (r.status === 404) return null; // endpoint not deployed yet → hide gracefully
      if (!r.ok) throw new Error(await readError(r));
      return (await r.json()) as GapRiskResponse;
    },
    enabled: symbols.length > 0,
    staleTime: 20 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

/** Earnings for board tickers from the shared calendar (next 10 trading days). */
export function useAutoEarnings(symbols: string[]) {
  const set = new Set(symbols);
  const q = useQuery<AutoEarning[]>({
    queryKey: ["big7-auto-earnings"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/earnings/upcoming?days=10&limit=60`);
      if (!r.ok) return [];
      const j = (await r.json()) as { days?: Array<{ date: string; items?: Array<{ ticker: string; callType: string; epsEstimate: number | null }> }> };
      const out: AutoEarning[] = [];
      for (const d of j.days ?? []) {
        for (const it of d.items ?? []) out.push({ ticker: String(it.ticker).toUpperCase(), date: d.date, callType: it.callType, epsEstimate: it.epsEstimate ?? null });
      }
      return out;
    },
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
  return { ...q, data: (q.data ?? []).filter((e) => set.has(e.ticker)) };
}

export function useCatalysts() {
  return useQuery<Catalyst[]>({
    queryKey: CATALYSTS_KEY,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/big7/catalysts`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    },
    staleTime: 30_000,
  });
}

export type CatalystInput = { ticker: string; date: string; type: string; description: string | null; impact: string };

export function useCatalystMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: CATALYSTS_KEY });
  const create = useMutation({
    mutationFn: async (body: CatalystInput) => {
      const r = await fetch(`${BASE}/api/big7/catalysts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await readError(r));
      return (await r.json()) as Catalyst;
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...body }: Partial<CatalystInput> & { id: number }) => {
      const r = await fetch(`${BASE}/api/big7/catalysts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status === 404) throw new Error("Редактирование появится после обновления API");
      if (!r.ok) throw new Error(await readError(r));
      return (await r.json()) as Catalyst;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/big7/catalysts/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await readError(r));
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: CATALYSTS_KEY });
      const prev = qc.getQueryData<Catalyst[]>(CATALYSTS_KEY);
      if (prev) qc.setQueryData<Catalyst[]>(CATALYSTS_KEY, prev.filter((c) => c.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(CATALYSTS_KEY, ctx.prev);
    },
    onSettled: invalidate,
  });
  return { create, update, remove };
}

/** Trader's risk limits; null when the risk desk API is absent (404) or no limits set. */
export function useRiskMe() {
  return useQuery<RiskMeLite | null>({
    queryKey: ["big7-risk-me"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/risk/me`);
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("json")) return null;
      return (await r.json()) as RiskMeLite;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

/** Re-render on any Big 7 local day-state change (bias, in play, notes…). */
export function useDayVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = () => setV((x) => x + 1);
    window.addEventListener(DAY_CHANGE_EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(DAY_CHANGE_EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return v;
}

export function useTickerDay(ticker: string): [TickerDay, <K extends keyof TickerDay>(key: K, val: TickerDay[K]) => void] {
  const version = useDayVersion();
  const [day, setDay] = useState<TickerDay>(() => getTickerDay(ticker));
  useEffect(() => { setDay(getTickerDay(ticker)); }, [ticker, version]);
  const update = useCallback(<K extends keyof TickerDay>(key: K, val: TickerDay[K]) => {
    setDay(updateTickerDayField(ticker, key, val));
  }, [ticker]);
  return [day, update];
}

export function useMarketCtx(): [MarketCtx, (key: keyof MarketCtx, val: string) => void] {
  const version = useDayVersion();
  const [ctx, setCtx] = useState<MarketCtx>(getMarketContext);
  useEffect(() => { setCtx(getMarketContext()); }, [version]);
  const update = useCallback((key: keyof MarketCtx, val: string) => {
    const next = { ...getMarketContext(), [key]: val } as MarketCtx;
    setCtx(next);
    saveMarketContext(next);
  }, []);
  return [ctx, update];
}

/** Ticks every `ms` so "обновлено N сек назад" stays fresh. */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function agoLabel(ts: number | undefined, now: number) {
  if (!ts) return "нет данных";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return "только что";
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  return `${Math.round(m / 60)} ч назад`;
}
