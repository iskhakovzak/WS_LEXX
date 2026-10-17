/**
 * Query factories for endpoints that several features read. Each feature transforms the rows with `select`, so the
 * cache always holds the raw server answer (one request, one cache entry).
 */
import { queryOptions } from "@tanstack/react-query";
import { nyDate } from "@/lib/trading-date";
import { http } from "./http";
import { KEYS, STALE } from "./keys";

/** Row of GET /api/trades?result=open, as much as the readers need. */
export type OpenTradeRow = {
  id: number;
  ticker: string;
  result: string;
  date?: string | null;
  trader?: string | null;
  side?: string | null;
  horizon?: string | null;
  exitDate?: string | null;
  [key: string]: unknown;
};

export const openTradesQuery = () =>
  queryOptions({
    queryKey: KEYS.openTrades(),
    queryFn: ({ signal }) => http.get<OpenTradeRow[]>("/api/trades", { query: { result: "open" }, signal }),
    staleTime: STALE.short,
  });

export const tradeIdeasQuery = <T = unknown>() =>
  queryOptions({
    queryKey: KEYS.tradeIdeas(),
    queryFn: ({ signal }) => http.get<T[]>("/api/trade-ideas", { signal }),
    staleTime: STALE.default,
  });

/**
 * The viewer's own risk state for the NY trading day (GET /api/risk/me?date=). Each reader types the answer with its own
 * `RiskMe` shape (dashboard, risk page) or narrows it with `select` (shell badge).
 */
export const riskMeQuery = <T = unknown>(date: string = nyDate()) =>
  queryOptions({
    queryKey: KEYS.riskMe(date),
    queryFn: ({ signal }) => http.get<T>("/api/risk/me", { query: { date }, signal }),
    staleTime: STALE.default,
  });
