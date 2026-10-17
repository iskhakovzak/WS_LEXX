/**
 * Data for WS Chart: base candles (+ optional daily), executions, trade-day events.
 * Reads only: GET /api/candles/:ticker/range, GET /api/trades/:id/executions, GET /api/events.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { addDays, nyDate, prevWeekday } from "@/lib/trading-date";
import type { ApiInterval, Candle, Execution, MarketEventLite, TradeLike } from "../types";
import { API_INTERVAL_SECONDS } from "../types";

export type RangeResponse = { ticker: string; from: string; to: string; interval: string; candles: Candle[]; prevClose: number | null };

export type ChartError = Error & { status?: number; reason?: string };

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    const body: { error?: string; reason?: string } = await resp.json().catch(() => ({}));
    const err = new Error(body.error || `HTTP ${resp.status}`) as ChartError;
    err.status = resp.status; err.reason = body.reason;
    throw err;
  }
  return resp.json() as Promise<T>;
}

const noRetry = (count: number, err: unknown) => {
  const s = (err as ChartError).status;
  return s !== 422 && s !== 400 && s !== 404 && s !== 401 && count < 1;
};

/** Trade-day window: from `contextDays` trading days before the entry day to the exit day (or today for open multi-day). */
export function tradeWindow(trade: TradeLike, contextDays: number): { dateKey: string; toKey: string; fromKey: string; multiDay: boolean } {
  const dateKey = (trade.date || "").slice(0, 10);
  const multiDay = trade.horizon === "overnight" || trade.horizon === "swing";
  const exitKey = trade.exitDate ? trade.exitDate.slice(0, 10) : null;
  let toKey = dateKey;
  if (multiDay) {
    if (exitKey && exitKey > dateKey) toKey = exitKey;
    else if (trade.result === "open") toKey = nyDate();
    else toKey = addDays(dateKey, trade.horizon === "swing" ? 5 : 1);
  }
  const today = nyDate();
  if (toKey > today) toKey = today;
  let fromKey = dateKey;
  for (let i = 0; i < Math.max(0, contextDays); i++) fromKey = prevWeekday(fromKey);
  return { dateKey, toKey, fromKey, multiDay };
}

export type ChartData = {
  dateKey: string;
  toKey: string;
  fromKey: string;
  /** Base bars as served (sorted, deduplicated by the API). */
  bars: Candle[];
  baseInterval: ApiInterval | null;
  baseSec: number;
  prevClose: number | null;
  executions: Execution[];
  events: MarketEventLite[];
  daily: { bars: Candle[]; loading: boolean; requested: boolean; request: () => void };
  loading: boolean;
  fetching: boolean;
  error: ChartError | null;
  multiDay: boolean;
};

export function useChartData(trade: TradeLike, opts: { executions?: Execution[]; contextDays?: number; enabled?: boolean } = {}): ChartData {
  const contextDays = opts.contextDays ?? 2;
  const enabled = opts.enabled !== false && Boolean(trade.ticker && trade.date);
  const { dateKey, toKey, fromKey, multiDay } = React.useMemo(() => tradeWindow(trade, contextDays), [trade, contextDays]);
  const ticker = trade.ticker;

  const bars = useQuery<RangeResponse, ChartError>({
    queryKey: ["ws-chart", "range", ticker, fromKey, toKey],
    queryFn: () => getJson<RangeResponse>(`${BASE}/api/candles/${encodeURIComponent(ticker)}/range?from=${fromKey}&to=${toKey}&interval=1m&extended=1`),
    enabled, staleTime: 5 * 60 * 1000, retry: noRetry,
  });

  const [dailyRequested, setDailyRequested] = React.useState(false);
  const dailyFrom = React.useMemo(() => addDays(dateKey, -120), [dateKey]);
  const daily = useQuery<RangeResponse, ChartError>({
    queryKey: ["ws-chart", "daily", ticker, dailyFrom, toKey],
    queryFn: () => getJson<RangeResponse>(`${BASE}/api/candles/${encodeURIComponent(ticker)}/range?from=${dailyFrom}&to=${toKey}&interval=1d`),
    enabled: enabled && dailyRequested, staleTime: 10 * 60 * 1000, retry: noRetry,
  });

  const execs = useQuery<{ tradeId: number; executions: Execution[] }, ChartError>({
    queryKey: ["trade-executions", trade.id],
    queryFn: () => getJson<{ tradeId: number; executions: Execution[] }>(`${BASE}/api/trades/${trade.id}/executions`),
    enabled: enabled && opts.executions === undefined && trade.id > 0, staleTime: 30 * 1000, retry: noRetry,
  });

  const events = useQuery<MarketEventLite[], ChartError>({
    queryKey: ["ws-chart", "events", ticker, dateKey, toKey],
    queryFn: async () => {
      try {
        const r = await getJson<unknown>(`${BASE}/api/events?ticker=${encodeURIComponent(ticker)}&from=${dateKey}&to=${toKey}&limit=50`);
        return Array.isArray(r) ? (r as MarketEventLite[]).filter((e) => e && typeof e.headline === "string" && typeof e.date === "string") : [];
      } catch { return []; }
    },
    enabled, staleTime: 5 * 60 * 1000, retry: false,
  });

  const baseInterval = (bars.data?.interval as ApiInterval | undefined) ?? null;
  const baseSec = baseInterval && API_INTERVAL_SECONDS[baseInterval] ? API_INTERVAL_SECONDS[baseInterval] : 60;
  const barList = React.useMemo(() => {
    const raw = bars.data?.candles ?? [];
    // Keep bars with sane numbers only; the API already sorts/dedups.
    return raw.filter((c) => Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c) && c.h >= c.l);
  }, [bars.data]);
  const executions = React.useMemo(() => opts.executions ?? execs.data?.executions ?? [], [opts.executions, execs.data]);
  const requestDaily = React.useCallback(() => setDailyRequested(true), []);

  return {
    dateKey, toKey, fromKey,
    bars: barList,
    baseInterval, baseSec,
    prevClose: bars.data?.prevClose ?? null,
    executions,
    events: events.data ?? [],
    daily: { bars: daily.data?.candles ?? [], loading: daily.isLoading, requested: dailyRequested, request: requestDaily },
    loading: bars.isLoading || (opts.executions === undefined && execs.isLoading),
    fetching: bars.isFetching,
    error: bars.error ?? null,
    multiDay,
  };
}
