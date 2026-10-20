// Windowed trade list (audit P1-5): GET /api/trades accepts from/to/trader/limit/tagged. Pages that only need a
// period, one trader or the tagged subset ask for exactly that instead of the whole book. Since Волна 2 п. 2.15 the
// server never returns the whole book: no `from` ⇒ the newest `limit` (default 500), a window wider than 400 days ⇒
// 400. So «Всё время» and very wide windows ask for the newest TRADES_LIST_MAX (the server cap) and the window is
// applied client-side (`select`).
//
// The generated `useListTrades` serialises any key of its params object, so the extra keys are passed through
// with a cast (no codegen). While the running API predates the filters it ignores them and returns the whole
// scoped book — `select` re-applies the same window client-side, so the page is correct on both builds.
import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getListTradesQueryKey, useListTrades, type ListTradesParams, type Trade } from "@workspace/api-client-react";
import { closeDate, isOpen } from "@/lib/trade-math";
import { fetchTradesPage, TRADES_PAGE_KEY } from "@/hooks/use-trades-page";

export type TradesWindow = {
  /** YYYY-MM-DD — keep trades realised on/after this day (plus still-open positions). */
  from?: string | null;
  /** YYYY-MM-DD — keep trades entered on/before this day. */
  to?: string | null;
  /** One trader (staff only server-side; traders are always scoped to themselves). */
  trader?: string | null;
  /** Newest N by trade date. */
  limit?: number | null;
  /** Only trades with a setup or tags. */
  tagged?: boolean;
};

type WindowParams = { trader?: string; from?: string; to?: string; limit?: number; tagged?: "1" };

/** Server caps of GET /api/trades (api lib/tradesListWindow). */
export const TRADES_LIST_MAX = 5000;
export const TRADES_LIST_MAX_WINDOW_DAYS = 400;

const dayNo = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;

export function tradesWindowParams(w: TradesWindow, today: string = new Date().toISOString().slice(0, 10)): WindowParams {
  const p: WindowParams = {};
  if (w.trader) p.trader = w.trader;
  // A window the server refuses (> 400 days) is asked as «newest N» and cut client-side.
  const wide = !!w.from && dayNo(w.to ?? today) - dayNo(w.from) > TRADES_LIST_MAX_WINDOW_DAYS;
  if (w.from && !wide) p.from = w.from;
  if (w.to && !wide) p.to = w.to;
  if (w.limit != null && w.limit > 0) p.limit = Math.min(Math.floor(w.limit), TRADES_LIST_MAX);
  else if (!p.from) p.limit = TRADES_LIST_MAX;
  if (w.tagged) p.tagged = "1";
  return p;
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/** Client mirror of the server window (routes/trades.ts LegacyWindowQuery). */
export function inTradesWindow(t: Pick<Trade, "date" | "exitDate" | "result" | "trader" | "setup" | "tags">, w: TradesWindow): boolean {
  if (w.trader && (t.trader ?? "").trim() !== w.trader.trim()) return false;
  const entry = String(t.date ?? "").slice(0, 10);
  if (w.to && entry > w.to) return false;
  if (w.from) {
    const realised = String(closeDate(t) ?? entry).slice(0, 10);
    if (realised < w.from && !isOpen(t)) return false;
  }
  if (w.tagged && blank(t.setup) && blank(t.tags)) return false;
  return true;
}

export function applyTradesWindow(trades: Trade[], w: TradesWindow): Trade[] {
  const out = trades.filter((t) => inTradesWindow(t, w));
  if (w.limit != null && w.limit > 0 && out.length > w.limit) {
    return [...out].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)).slice(0, w.limit);
  }
  return out;
}

/**
 * useListTrades with a server-side window. Query key stays ["/api/trades", params] so
 * invalidateTradeDependents() keeps refreshing it after trade mutations.
 */
export function useTradesWindow(w: TradesWindow, opts: { enabled?: boolean; staleTime?: number } = {}) {
  const { from, to, trader, limit, tagged } = w;
  const params = useMemo(() => tradesWindowParams({ from, to, trader, limit, tagged }), [from, to, trader, limit, tagged]);
  const select = useCallback(
    (rows: Trade[]) => applyTradesWindow(Array.isArray(rows) ? rows : [], { from, to, trader, limit, tagged }),
    [from, to, trader, limit, tagged],
  );
  const generated = params as unknown as ListTradesParams;
  return useListTrades(generated, {
    query: {
      queryKey: getListTradesQueryKey(generated),
      enabled: opts.enabled ?? true,
      staleTime: opts.staleTime ?? 30_000,
      placeholderData: keepPreviousData,
      select,
    },
  });
}

/** Union of two windowed lists by trade id (a carried / open trade can be in both windows). */
export function mergeTradeLists(a: Trade[] | undefined, b: Trade[] | undefined): Trade[] | undefined {
  if (!a) return undefined;
  if (!b || !b.length) return a;
  const seen = new Set(a.map((t) => t.id));
  const out = [...a];
  for (const t of b) if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
  return out;
}

export type PeriodTradesWindow = {
  /** YYYY-MM-DD start of the current period; null = «Всё время» (the whole scoped book). */
  from: string | null;
  /** The equally long previous period (comparison only); both or neither. */
  prevFrom?: string | null;
  prevTo?: string | null;
  trader?: string | null;
};

/**
 * DEV-01: a period page asks for the current window first (GET /api/trades?from=…) and renders on it; the previous
 * window (?from=…&to=…), needed only for the «к прошлому периоду» deltas, loads after the current one arrives. The
 * current-window query key is the same on /stats and /analytics, so switching pages reuses it.
 * `data` = current ∪ previous (deduplicated); `prevLoading` while the comparison is not there yet.
 * `enabled: false` (the staff view of /stats and /analytics reads server aggregates) fetches nothing.
 */
export function usePeriodTrades(w: PeriodTradesWindow, enabled = true) {
  const cur = useTradesWindow({ from: w.from, trader: w.trader }, { enabled });
  const hasPrev = !!(w.from && w.prevFrom && w.prevTo);
  const prev = useTradesWindow(
    { from: hasPrev ? w.prevFrom : null, to: hasPrev ? w.prevTo : null, trader: w.trader },
    { enabled: enabled && hasPrev && cur.isSuccess && !cur.isPlaceholderData },
  );
  const prevReady = hasPrev && prev.isSuccess && !prev.isPlaceholderData;
  const data = useMemo(() => mergeTradeLists(cur.data, prevReady ? prev.data : undefined), [cur.data, prev.data, prevReady]);
  const { refetch: refetchCur } = cur;
  const { refetch: refetchPrev } = prev;
  const refetch = useCallback(async () => {
    const r = await refetchCur();
    if (hasPrev) void refetchPrev();
    return r;
  }, [refetchCur, refetchPrev, hasPrev]);
  return {
    data,
    isLoading: enabled && cur.isLoading,
    isError: enabled && cur.isError,
    isFetching: cur.isFetching || prev.isFetching,
    refetch,
    /** The previous window is requested but not loaded yet (deltas pending). */
    prevLoading: enabled && hasPrev && !prevReady && !prev.isError,
  };
}

export type TradesBookFacets = {
  /** Trades in the caller's scope (whole book, not windowed). */
  total: number;
  traders: string[];
  horizons: Record<string, number>;
  /** Latest entry date in scope. */
  lastDate: string | null;
};

/**
 * Cheap scope-wide facts (trader list, totals, horizon counts) from GET /api/trades/page?limit=1 — so a page
 * that windows its trade list does not need the whole book just to fill a trader selector or a counter.
 * null when the endpoint is unavailable (old build) — callers fall back to what the windowed list gives.
 */
export function useTradesBookFacets(opts: { trader?: string | null; enabled?: boolean } = {}) {
  const trader = opts.trader || "";
  return useQuery<TradesBookFacets | null>({
    queryKey: [TRADES_PAGE_KEY, "facets", trader],
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      // lite=1: the API skips rows / curve / streak / preset counts (an older API ignores it and answers in full).
      const p = new URLSearchParams({ limit: "1", lite: "1" });
      if (trader) p.set("trader", trader);
      try {
        const r = await fetchTradesPage(p, signal);
        return {
          total: Number(r.summary?.total ?? 0),
          traders: Array.isArray(r.facets?.traders) ? r.facets.traders : [],
          horizons: r.facets?.horizons ?? {},
          lastDate: r.summary?.lastDate ?? null,
        };
      } catch (err) {
        if (signal?.aborted) throw err;
        return null;
      }
    },
  });
}
