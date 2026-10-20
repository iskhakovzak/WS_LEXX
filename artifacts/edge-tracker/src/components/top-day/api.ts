/**
 * «Топ дня» — data. Mirror of api-server lib/topDay.ts:
 *   GET /api/top/calendar?month=YYYY-MM        → TopCalendar
 *   GET /api/top/day/:date                     → TopDay (top 10 profit / loss + the viewer's own day)
 *   GET /api/top/day/:date/trader/:alias       → TraderDay
 * `mode`: staff (names + $), anonymous (aliases, a trader while names are hidden), named (names). In both trader modes
 * other traders' $ and the desk sums are null (owner decision 9, 2026-10-20); the trader's own $ stays.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";

export type TopMode = "staff" | "anonymous" | "named";

export type CalendarDay = {
  date: string;
  net: number | null;
  trades: number;
  traders: number;
  best: number | null;
  worst: number | null;
  mine: number | null;
};

export type TopCalendar = { month: string; mode: TopMode; days: CalendarDay[]; holidays: string[] };

export type TopTicker = { ticker: string; trades: number; net: number | null };

export type TopRow = {
  alias: number;
  me: boolean;
  name: string | null;
  /** 0 = no place (the loss list for a trader, Волна 2 п. 2.14). */
  place: number;
  net: number | null;
  /** Σ R of the day (null: no trade has an R; absent on an older API). */
  r?: number | null;
  /** Wins / decided in % (null: nothing decided). */
  winPct?: number | null;
  trades: number;
  wins: number;
  losses: number;
  tickers: TopTicker[];
  bestTicker: string | null;
};

export type TopDay = {
  date: string;
  mode: TopMode;
  desk: { net: number | null; trades: number; traders: number };
  profit: TopRow[];
  loss: TopRow[];
  me: TopRow | null;
};

export type TraderDayTicker = {
  ticker: string;
  side: "long" | "short" | "both";
  trades: number;
  wins: number;
  losses: number;
  net: number | null;
  firstAt: string | null;
  lastAt: string | null;
};

export type TraderDay = {
  date: string;
  mode: TopMode;
  alias: number;
  me: boolean;
  name: string | null;
  list: "profit" | "loss" | "flat";
  /** 0 = no place (a trader's loss day, 2.14). */
  place: number;
  net: number | null;
  r?: number | null;
  winPct?: number | null;
  trades: number;
  wins: number;
  losses: number;
  tickers: TraderDayTicker[];
};

const YM = /^\d{4}-\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function useTopCalendar(month: string, enabled = true) {
  return useQuery<TopCalendar>({
    queryKey: ["top", "calendar", month],
    queryFn: ({ signal }) => http.get<TopCalendar>(`/api/top/calendar?month=${month}`, { signal }),
    enabled: enabled && YM.test(month),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useTopDay(date: string | null, enabled = true) {
  return useQuery<TopDay>({
    queryKey: ["top", "day", date],
    queryFn: ({ signal }) => http.get<TopDay>(`/api/top/day/${date}`, { signal }),
    enabled: enabled && !!date && YMD.test(date),
    staleTime: 60_000,
  });
}

export function useTraderDay(date: string | null, alias: number | null) {
  return useQuery<TraderDay>({
    queryKey: ["top", "trader", date, alias],
    queryFn: ({ signal }) => http.get<TraderDay>(`/api/top/day/${date}/trader/${alias}`, { signal }),
    enabled: !!date && YMD.test(date) && alias != null && alias > 0,
    staleTime: 60_000,
    retry: false,
  });
}
