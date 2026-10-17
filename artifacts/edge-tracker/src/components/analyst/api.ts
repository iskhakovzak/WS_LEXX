/**
 * Analyst actions — data hooks. Plain fetch (auth header is injected globally by install-fetch-auth).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { gpApi, gpKeys, type InPlayItem, type PlanDoc } from "@/components/game-plan/types";
import type { FeedAction, FeedResponse, OpenPosition, Quote } from "./lib";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `Ошибка ${r.status}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export function useAnalystFeed(opts: { days: number; minCapB: number; includeUnknownCap: boolean }) {
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("action", "all");
    p.set("limit", "10000");
    // Round to the hour so the query key is stable between renders.
    const after = new Date(Date.now() - opts.days * 86400_000);
    after.setMinutes(0, 0, 0);
    p.set("after", after.toISOString());
    if (opts.minCapB > 0) {
      p.set("minMarketCap", String(Math.round(opts.minCapB * 1e9)));
      if (opts.includeUnknownCap) p.set("includeUnknownCap", "1");
    }
    return p.toString();
  }, [opts.days, opts.minCapB, opts.includeUnknownCap]);

  return useQuery<FeedResponse>({
    queryKey: ["analyst-actions", "feed", qs],
    queryFn: () => getJson<FeedResponse>(`${BASE}/api/analyst-actions?${qs}`),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

/** Full history for one ticker (detail sheet). */
export function useTickerHistory(ticker: string | null) {
  return useQuery<FeedResponse>({
    queryKey: ["analyst-actions", "ticker", ticker],
    enabled: !!ticker,
    queryFn: () => getJson<FeedResponse>(`${BASE}/api/analyst-actions?ticker=${encodeURIComponent(ticker!)}&action=all&limit=500`),
    staleTime: 5 * 60_000,
  });
}

export type FirmStat = {
  firm: string;
  total: number;
  upgrades: number;
  downgrades: number;
  initiations: number;
  tickers: number;
  avgPtChange: number | null;
  premarketShare: number | null;
  evaluated: number;
  confirmed: number;
  confirmRate: number | null;
  ratingEvaluated: number;
  ratingConfirmed: number;
  ratingConfirmRate: number | null;
  lastAt: string | null;
};
export type FirmStatsResponse = {
  days: number;
  followDays: number;
  baseRate: number | null;
  totalActions: number;
  firms: FirmStat[];
  generatedAt: string;
};

/** Firm reliability (API may be an older build without the endpoint → returns null, UI hides). */
export function useFirmStats(days = 180) {
  return useQuery<FirmStatsResponse | null>({
    queryKey: ["analyst-actions", "firms", days],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/analyst-actions/firms?days=${days}&minActions=3`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Ошибка ${r.status}`);
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("json")) return null;
      return (await r.json()) as FirmStatsResponse;
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** Batched quotes (gap / day change / price) for the visible tickers. */
export function useQuotes(tickers: string[]) {
  const key = useMemo(() => Array.from(new Set(tickers.map((t) => t.toUpperCase()))).sort().slice(0, 100), [tickers]);
  return useQuery<Record<string, Quote>>({
    queryKey: ["analyst-quotes", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < key.length; i += 50) chunks.push(key.slice(i, i + 50));
      const parts = await Promise.all(
        chunks.map((c) =>
          getJson<Record<string, Quote>>(`${BASE}/api/stockdata/quote?symbols=${encodeURIComponent(c.join(","))}`).catch(() => ({})),
        ),
      );
      return Object.assign({}, ...parts) as Record<string, Quote>;
    },
    staleTime: 60_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: 0,
  });
}

type RawTrade = {
  id: number;
  ticker: string;
  date: string;
  result: string;
  trader?: string | null;
  side?: string | null;
  horizon?: string | null;
  exitDate?: string | null;
};

/** Positions the desk is carrying (result=open). Horizon null ⇒ intraday. */
export function useOpenPositions() {
  return useQuery<OpenPosition[]>({
    queryKey: ["analyst-open-positions"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/trades?result=open`);
      if (!r.ok) return [];
      const rows = (await r.json()) as RawTrade[];
      if (!Array.isArray(rows)) return [];
      return rows
        .filter((t) => String(t.result).toLowerCase() === "open" && !t.exitDate)
        .map((t) => ({
          id: t.id,
          ticker: String(t.ticker).toUpperCase(),
          trader: t.trader ?? null,
          side: t.side ?? null,
          date: t.date,
          horizon: t.horizon === "overnight" || t.horizon === "swing" ? t.horizon : "intraday",
        }));
    },
    staleTime: 60_000,
    retry: 0,
  });
}

type WatchRow = { id: number; ticker: string; status?: string | null };

/** Tickers already on the team watchlist (shares the ["watchlist"] cache with the Watchlist page). */
export function useWatchlistTickers() {
  const q = useQuery<WatchRow[]>({
    queryKey: ["watchlist"],
    queryFn: () => getJson<WatchRow[]>(`${BASE}/api/watchlist`),
    staleTime: 60_000,
    retry: 0,
  });
  const set = useMemo(() => {
    const s = new Set<string>();
    for (const r of Array.isArray(q.data) ? q.data : []) {
      const st = String(r.status ?? "").toLowerCase();
      if (st !== "passed") s.add(String(r.ticker).toUpperCase());
    }
    return s;
  }, [q.data]);
  return { set, isLoading: q.isLoading };
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { ticker: string; catalyst: string; sector?: string | null; longName?: string | null }) => {
      const r = await fetch(`${BASE}/api/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: vars.ticker,
          catalyst: vars.catalyst,
          status: "watching",
          tags: "аналитики",
          ...(vars.sector ? { sector: vars.sector } : {}),
          ...(vars.longName ? { longName: vars.longName } : {}),
        }),
      });
      if (!r.ok) {
        let msg = `Ошибка ${r.status}`;
        try { const j = (await r.json()) as { error?: string }; if (j?.error) msg = j.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      return r.json();
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });
}

export async function runSourceScan(): Promise<{ rowsInserted: number; tickersWithData: number; durationMs: number }> {
  const r = await fetch(`${BASE}/api/analyst-actions/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concurrency: 5 }),
  });
  if (!r.ok) throw new Error(`Скан не удался (${r.status})`);
  return r.json();
}

/* ── Market reaction to ratings (2026-10 API; older builds → 404 → null, the UI hides the block) ── */

export type ReactionAgg = {
  n: number;
  avgGap: number | null;
  avgDay: number | null;
  avgO2c: number | null;
  avgSignedDay: number | null;
  hitRate: number | null;
  avgRatio: number | null;
};
export type ReactionKind = "up" | "down" | "init" | "ptUp" | "ptDown";
export type ReactionEvent = {
  id: number;
  at: string | null;
  firm: string;
  kind: ReactionKind;
  dir: 1 | -1;
  rating: boolean;
  ptChg: number | null;
  reactionDay: string;
  gap: number | null;
  day: number | null;
  o2c: number | null;
  ratio: number | null;
  volRatio: number | null;
};
export type ReactionDetail = {
  ticker: string;
  lookbackDays: number;
  bars: { count: number; from: string | null; to: string | null; fetchedAt: string | null };
  typicalMove: number | null;
  byKind: Record<"rating" | ReactionKind, ReactionAgg>;
  byFirm: { firm: string; events: number; rating: ReactionAgg; all: ReactionAgg; lastAt: string | null }[];
  events: ReactionEvent[];
  prices: { d: string; c: number }[];
  generatedAt: string;
};
export type TickerReaction = { typicalMove: number | null } & Record<"rating" | ReactionKind, ReactionAgg>;
export type ReactionSummaries = { tickers: Record<string, TickerReaction>; pending: string[] };
export type FirmWeightRow = { firm: string; rating: ReactionAgg; up: ReactionAgg; down: ReactionAgg; pt: ReactionAgg; tickers: number };
export type FirmWeightResponse = {
  days: number;
  minN: number;
  street: ReactionAgg;
  firms: FirmWeightRow[];
  generatedAt: string;
  coverage: { tickers: number; ratedTickers: number; warming: boolean };
};
export type DayBucket = { trades: number; days: number; net: number; wins: number; losses: number; winRate: number | null; avgNet: number | null };
export type MyDaysResponse = {
  trader: string | null;
  from: string;
  to: string;
  days: number;
  buckets: Record<"rating" | "target" | "none" | "up" | "down" | "init" | "withCall" | "againstCall", DayBucket>;
  tickers: { ticker: string; trades: number; net: number; wins: number; losses: number; lastDate: string; ratingDays: number }[];
};

/** GET that maps «endpoint not deployed yet» (404 / HTML fallback) to null. */
async function getOptional<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) {
    let msg = `Ошибка ${r.status}`;
    try { const j = (await r.json()) as { error?: string }; if (j?.error) msg = j.error; } catch { /* not json */ }
    throw new Error(msg);
  }
  if (!(r.headers.get("content-type") ?? "").includes("json")) return null;
  return (await r.json()) as T;
}

/** History of the stock's reaction to ratings (sheet). First call for a ticker may wait for Yahoo (~1 s). */
export function useReactionDetail(ticker: string | null) {
  return useQuery<ReactionDetail | null>({
    queryKey: ["analyst-actions", "reaction", ticker],
    enabled: !!ticker,
    queryFn: () => getOptional<ReactionDetail>(`${BASE}/api/analyst-actions/reaction?ticker=${encodeURIComponent(ticker!)}`),
    staleTime: 10 * 60_000,
    retry: 0,
  });
}

/** Cached reaction stats for many tickers. Never blocks on Yahoo: missing ones come back in `pending` and are polled. */
export function useReactionSummaries(tickers: string[]) {
  const key = useMemo(() => Array.from(new Set(tickers.map((t) => t.toUpperCase()))).sort().slice(0, 80), [tickers]);
  return useQuery<ReactionSummaries | null>({
    queryKey: ["analyst-actions", "reactions", key],
    enabled: key.length > 0,
    queryFn: () => getOptional<ReactionSummaries>(`${BASE}/api/analyst-actions/reactions?tickers=${encodeURIComponent(key.join(","))}`),
    staleTime: 5 * 60_000,
    refetchInterval: (q) => (q.state.data?.pending?.length ? 60_000 : false),
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: 0,
  });
}

/** «Вес» of firms: how hard the market historically moves on their calls. */
export function useFirmWeight(days = 730) {
  return useQuery<FirmWeightResponse | null>({
    queryKey: ["analyst-actions", "firm-weight", days],
    queryFn: () => getOptional<FirmWeightResponse>(`${BASE}/api/analyst-actions/firm-weight?days=${days}`),
    staleTime: 15 * 60_000,
    refetchInterval: (q) => (q.state.data?.coverage?.warming ? 3 * 60_000 : false),
    refetchIntervalInBackground: false,
    retry: 0,
  });
}

/** My trades on rating-change days vs normal days (server scopes a trader to themself). */
export function useMyDays(trader: string | null | undefined, days = 365) {
  return useQuery<MyDaysResponse | null>({
    queryKey: ["analyst-my-days", trader ?? "", days],
    queryFn: () => {
      const p = new URLSearchParams({ days: String(days) });
      if (trader) p.set("trader", trader);
      return getOptional<MyDaysResponse>(`${BASE}/api/analyst-actions/my-days?${p}`);
    },
    staleTime: 10 * 60_000,
    retry: 0,
  });
}

/** Tickers already in my personal plan for `date` (shares the game-plan page cache). */
export function useMyPlanTickers(date: string, enabled = true) {
  const q = useQuery({
    queryKey: gpKeys.my(date),
    queryFn: () => gpApi.my(date),
    enabled,
    staleTime: 60_000,
    retry: 0,
  });
  return useMemo(() => {
    const s = new Set<string>();
    for (const i of q.data?.plan?.doc?.inPlay ?? []) if (i?.ticker) s.add(String(i.ticker).toUpperCase());
    return s;
  }, [q.data]);
}

const EMPTY_DOC: PlanDoc = {
  marketView: "", bias: "neutral", riskMode: "normal", keyLevels: {}, inPlay: [], riskNotes: "", macro: [],
  focus: "", maxLossUsd: null, maxTrades: null, media: [], tvLinks: [],
};
const MAX_IN_PLAY = 30;

/** Append a ticker to my personal plan for `date` (existing plan API; keeps everything else as is). */
export function useAddToPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { date: string; ticker: string; catalyst: string; bias: InPlayItem["bias"] }) => {
      const cur = await gpApi.my(vars.date);
      const doc: PlanDoc = { ...EMPTY_DOC, ...(cur.plan?.doc ?? {}) } as PlanDoc;
      const list = Array.isArray(doc.inPlay) ? doc.inPlay : [];
      const t = vars.ticker.toUpperCase();
      if (list.some((i) => String(i.ticker).toUpperCase() === t)) return { already: true as const };
      if (list.length >= MAX_IN_PLAY) throw new Error(`В плане уже ${MAX_IN_PLAY} тикеров`);
      const item: InPlayItem = {
        ticker: t, catalyst: vars.catalyst.slice(0, 240), bias: vars.bias, grade: null,
        levels: { support: [], resistance: [] }, plan: "", horizon: "intraday", risk_note: "",
      };
      await gpApi.saveMy(vars.date, { ...doc, inPlay: [...list, item], status: cur.plan?.status ?? "draft" });
      return { already: false as const };
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: gpKeys.my(vars.date) });
    },
  });
}

export type { FeedAction };
