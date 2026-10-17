import { createElement, useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { links } from "@/lib/links";
import { gpApi, gpKeys } from "@/components/game-plan/types";
import { docToDraft, draftToDoc, emptyTicker, MAX_TICKERS } from "@/components/game-plan/plan-draft";
import type {
  Exposure, InsiderSummary, IpoCalendarResponse, MyOfferingStats, Offering, OfferingsResponse, OpenTrade, TickerDetail,
  TickerHistory, TradeRow, WatchItem,
} from "./types";
import { watchCatalyst } from "./types";

type HttpError = Error & { status?: number };
const statusOf = (e: unknown): number | undefined => (e as HttpError | null)?.status;
/** New endpoints answer 404 until the API is rebuilt: never retry those. */
const retryUnless404 = (count: number, err: unknown) => statusOf(err) !== 404 && count < 1;
export const isMissingEndpoint = (e: unknown) => statusOf(e) === 404;

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string; message?: string } | null;
    const err = new Error(body?.message || body?.error || `HTTP ${r.status}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

const watchQuery = (day: string) => ({
  queryKey: ["offerings", day] as const,
  queryFn: () => getJson<OfferingsResponse>(`/api/offerings/watch?day=${encodeURIComponent(day)}`),
  staleTime: 5 * 60_000,
});

/**
 * One market day of filings. When the server answered before timing / reactions / fundamentals were ready
 * (`enrichment.complete === false`) it is re-asked a few times, 45 s apart — the server keeps warming its caches.
 */
export function useOfferings(day: string, enabled = true) {
  return useQuery<OfferingsResponse>({
    ...watchQuery(day),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.enrichment?.complete === false && q.state.dataUpdateCount < 4 ? 45_000 : false,
  });
}

/** Several days at once (week view); shares the per-day cache with useOfferings. */
export function useOfferingsDays(days: string[], enabled: boolean) {
  return useQueries({
    queries: days.map((d) => ({ ...watchQuery(d), enabled, retry: 1 })),
  });
}

/** SEC timeline + daily reaction to each past offering (server: /offerings/history/:ticker). */
export function useTickerHistory(ticker: string | null) {
  return useQuery<TickerHistory>({
    queryKey: ["offerings", "history", ticker],
    queryFn: () => getJson<TickerHistory>(`/api/offerings/history/${encodeURIComponent(ticker ?? "")}`),
    enabled: !!ticker,
    staleTime: 60 * 60_000,
    retry: retryUnless404,
  });
}

/**
 * The trader's results on offering days vs normal days. The server resolves SEC filings for ~40 tickers per call;
 * while `coverage.pending > 0` the query re-asks every 4 s (cap 15 rounds) and the numbers fill in.
 */
export function useMyOfferingStats(win: 0 | 1, enabled: boolean) {
  return useQuery<MyOfferingStats>({
    queryKey: ["offerings", "my-stats", win],
    queryFn: () => getJson<MyOfferingStats>(`/api/offerings/my-stats?window=${win}`),
    enabled,
    staleTime: 10 * 60_000,
    retry: retryUnless404,
    refetchInterval: (q) => ((q.state.data?.coverage.pending ?? 0) > 0 && q.state.dataUpdateCount < 15 ? 4_000 : false),
  });
}

/** Upcoming IPOs, recent IPOs and lock-up expirations. */
export function useIpoCalendar(enabled: boolean) {
  return useQuery<IpoCalendarResponse>({
    queryKey: ["offerings", "ipo-calendar"],
    queryFn: () => getJson<IpoCalendarResponse>("/api/offerings/ipo-calendar"),
    enabled,
    staleTime: 10 * 60_000,
    retry: retryUnless404,
  });
}

/** The viewer's own trades on one ticker (latest 50). */
export function useMyTickerTrades(ticker: string | null, trader: string | null | undefined) {
  return useQuery<TradeRow[]>({
    queryKey: ["offerings", "ticker-trades", ticker, trader ?? ""],
    queryFn: async () => {
      const qs = new URLSearchParams({ ticker: ticker ?? "", limit: "50", sort: "date", dir: "desc" });
      if (trader) qs.set("trader", trader);
      const r = await getJson<{ items: TradeRow[] }>(`/api/trades/page?${qs}`);
      return r.items ?? [];
    },
    enabled: !!ticker,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Force-refresh bypassing the 10-min server cache (server allows it once per minute). */
export async function fetchOfferingsFresh(day: string): Promise<OfferingsResponse> {
  return getJson<OfferingsResponse>(`/api/offerings/watch?day=${encodeURIComponent(day)}&force=1`);
}

/** Open positions (own for traders, desk-wide for curators) and the shared watchlist. */
export function useExposure() {
  const trades = useQuery<OpenTrade[]>({
    queryKey: ["offerings", "open-trades"],
    queryFn: () => getJson<OpenTrade[]>("/api/trades?result=open"),
    staleTime: 60_000,
    retry: 1,
  });
  const watch = useQuery<WatchItem[]>({
    queryKey: ["watchlist"],
    queryFn: () => getJson<WatchItem[]>("/api/watchlist"),
    staleTime: 60_000,
    retry: 1,
  });
  const map = useMemo(() => {
    const m = new Map<string, Exposure>();
    for (const t of trades.data ?? []) {
      const k = String(t.ticker ?? "").toUpperCase();
      if (!k) continue;
      const e = m.get(k) ?? { held: [], watched: false };
      e.held.push(t);
      m.set(k, e);
    }
    for (const w of watch.data ?? []) {
      const k = String(w.ticker ?? "").toUpperCase();
      // Archived («Пропустил») rows are out of work — «В вотчлист» brings them back.
      if (!k || String(w.status ?? "").toLowerCase() === "passed") continue;
      const e = m.get(k) ?? { held: [], watched: false };
      e.watched = true;
      m.set(k, e);
    }
    return m;
  }, [trades.data, watch.data]);
  return { exposure: map, tradesLoading: trades.isLoading, watchLoading: watch.isLoading, watchTickers: watch.data };
}

export function useTickerDetail(ticker: string | null) {
  return useQuery<TickerDetail>({
    queryKey: ["offerings", "ticker", ticker],
    queryFn: () => getJson<TickerDetail>(`/api/offerings/ticker/${encodeURIComponent(ticker ?? "")}`),
    enabled: !!ticker,
    staleTime: 30 * 60_000,
    retry: retryUnless404,
  });
}

export function useInsiders(tickers: string[]) {
  const key = tickers.slice(0, 8).join(",");
  return useQuery<{ fetchedAt: number; items: InsiderSummary[]; missing: string[] }>({
    queryKey: ["offerings", "insiders", key],
    queryFn: () => getJson(`/api/offerings/insiders?tickers=${encodeURIComponent(key)}`),
    enabled: key.length > 0,
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

/**
 * Add a ticker to the shared watchlist «Сегодня» (a deal in play is traded today) with the filing as catalyst.
 * Already there / archived (409) → the quick endpoint moves or restores the existing row instead.
 */
export function useAddToWatchlist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  return useMutation({
    mutationFn: async (o: Offering) => {
      const post = (path: string, body: unknown) => fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let r = await post("/api/watchlist", {
        ticker: o.ticker,
        catalyst: watchCatalyst(o),
        notes: o.filingUrl ? `SEC: ${o.filingUrl}` : undefined,
        sector: o.sector ?? undefined,
        list: "today",
        inPlay: true,
      });
      if (r.status === 409) r = await post("/api/watchlist/quick", { tickers: [o.ticker], list: "today" });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      return r.json();
    },
    onMutate: async (o) => {
      await qc.cancelQueries({ queryKey: ["watchlist"] });
      const prev = qc.getQueryData<WatchItem[]>(["watchlist"]);
      qc.setQueryData<WatchItem[]>(["watchlist"], (old) => [...(old ?? []), { id: -Date.now(), ticker: o.ticker, status: "watching" }]);
      return { prev };
    },
    onError: (e, o, ctx) => {
      if (ctx?.prev) qc.setQueryData(["watchlist"], ctx.prev);
      toast({ title: `Не удалось добавить ${o.ticker}`, description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    },
    onSuccess: (_d, o) => {
      toast({
        title: `${o.ticker} → вотчлист «Сегодня»`,
        description: watchCatalyst(o),
        action: createElement(ToastAction, { altText: "Открыть в вотчлисте", onClick: () => navigate(links.watchlist(o.ticker)) }, "Открыть") as unknown as ToastActionElement,
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}

/**
 * Add the ticker to the viewer's own plan for `date` (personal game plan, same API the plan editor autosaves to).
 * Reads the current plan first and appends — nothing in the plan is overwritten.
 */
export function useAddToPlan() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ o, date }: { o: Offering; date: string }) => {
      const cur = await gpApi.my(date);
      const draft = docToDraft(cur.plan?.doc);
      const t = o.ticker.toUpperCase();
      if (draft.inPlay.some((i) => i.ticker.trim().toUpperCase() === t)) return { already: true, date };
      if (draft.inPlay.length >= MAX_TICKERS) throw new Error(`В плане уже ${MAX_TICKERS} тикеров`);
      draft.inPlay.push(emptyTicker({ ticker: t, catalyst: watchCatalyst(o), bias: "bear" }));
      await gpApi.saveMy(date, { ...draftToDoc(draft), status: cur.plan?.status ?? "draft" });
      return { already: false, date };
    },
    onSuccess: (r, { o }) => {
      void qc.invalidateQueries({ queryKey: gpKeys.my(r.date) });
      toast({ title: r.already ? `${o.ticker} уже в плане` : `${o.ticker} добавлен в план дня`, description: r.already ? undefined : watchCatalyst(o) });
    },
    onError: (e, { o }) => {
      toast({ title: `Не удалось добавить ${o.ticker} в план`, description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    },
  });
}
