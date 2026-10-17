import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BASE } from "@/lib/api";

/**
 * Auto feed (`GET /api/dailyfeed/stream`): items the server assembles from trades, academy, rules/risk, reviews,
 * ideas, playbook, threads, game plans and market events. Raw fetch (no orval) — the endpoint is new.
 * Mirrors `FeedItem` in api-server/src/lib/feedStream.ts.
 */
export type FeedTone = "up" | "down" | "warn" | "accent" | "purple" | "neutral";
export type FeedCategory = "mine" | "desk" | "achievement" | "market" | "announcement";
export type FeedKind =
  | "day_result" | "streak" | "best_day" | "best_week" | "exam" | "promotion" | "clean_streak"
  | "violations" | "risk_breach" | "review" | "idea" | "playbook" | "thread" | "game_plan" | "event" | "weekly_summary";

export type StreamItem = {
  id: string;
  kind: FeedKind;
  cats: FeedCategory[];
  date: string;
  at: string;
  trader: string | null;
  actor: string | null;
  title: string;
  subtitle: string | null;
  tone: FeedTone;
  value: number | null;
  valueFmt: "usd" | "pct" | "int" | null;
  ticker: string | null;
  href: string | null;
  group: string | null;
  visibility: "own" | "staff" | "public";
  meta?: Record<string, unknown>;
};

export type StreamPage = {
  from: string;
  to: string;
  today: string;
  items: StreamItem[];
  myTickers: string[];
  earliest: string | null;
  staff: boolean;
  lastSeenAt: string | null;
  hasMore: boolean;
  nextTo: string;
};

export const STREAM_DAYS = 14;
export const STREAM_KEY = ["dailyfeed-stream"] as const;

/** Thrown when the API has no /dailyfeed/stream yet (old build) — the page falls back to announcements only. */
export class StreamUnavailableError extends Error {
  constructor() {
    super("stream-unavailable");
  }
}

async function fetchStream(to: string | null, days: number): Promise<StreamPage> {
  const qs = new URLSearchParams({ days: String(days) });
  if (to) qs.set("to", to);
  const r = await fetch(`${BASE}/api/dailyfeed/stream?${qs.toString()}`);
  if (r.status === 404) throw new StreamUnavailableError();
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    // An API build without the stream route matches /dailyfeed/:id and rejects "stream" as an id (400).
    if (r.status === 400 && !/^to must be/.test(j.error ?? "")) throw new StreamUnavailableError();
    throw new Error(j.error ?? `HTTP ${r.status}`);
  }
  const data = (await r.json()) as StreamPage;
  // An old API might answer /dailyfeed/stream with /dailyfeed/:id semantics — guard the shape.
  if (!data || !Array.isArray(data.items)) throw new StreamUnavailableError();
  return data;
}

const noRetryUnavailable = (n: number, err: unknown) => !(err instanceof StreamUnavailableError) && n < 1;

/** Paged feed: 14 trading-calendar days per page, newest first; `fetchNextPage` loads the 14 days before. */
export function useFeedStream(enabled = true) {
  const q = useInfiniteQuery<StreamPage>({
    queryKey: STREAM_KEY,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchStream(pageParam as string | null, STREAM_DAYS),
    getNextPageParam: (last) => (last.hasMore ? last.nextTo : undefined),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: noRetryUnavailable,
  });
  const pages = q.data?.pages ?? [];
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: StreamItem[] = [];
    for (const p of pages) for (const it of p.items) if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
    return out;
  }, [pages]);
  const first = pages[0] ?? null;
  const last = pages[pages.length - 1] ?? null;
  return {
    ...q,
    items,
    first,
    /** Oldest loaded day (inclusive). */
    loadedFrom: last?.from ?? null,
    unavailable: q.error instanceof StreamUnavailableError,
  };
}

/** One day (deep link / calendar pick), independent of the paged list. */
export function useFeedStreamDay(day: string | null) {
  return useQuery<StreamPage>({
    queryKey: [...STREAM_KEY, "day", day],
    enabled: !!day,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: noRetryUnavailable,
    queryFn: () => fetchStream(day, 1),
  });
}

/**
 * «Новое с последнего визита»: the baseline is frozen from the first response (the server's previous visit),
 * then the visit is recorded once per mount after a short delay so a quick bounce doesn't clear the markers.
 */
export function useSeenBaseline(first: StreamPage | null, canMark: boolean) {
  const [baseline, setBaseline] = useState<string | null | undefined>(undefined);
  const marked = useRef(false);
  useEffect(() => {
    if (first && baseline === undefined) setBaseline(first.lastSeenAt ?? null);
  }, [first, baseline]);
  useEffect(() => {
    if (!first || !canMark || marked.current) return;
    const t = setTimeout(() => {
      marked.current = true;
      fetch(`${BASE}/api/dailyfeed/stream/seen`, { method: "POST" }).catch(() => { /* old API / offline: markers just stay */ });
    }, 5000);
    return () => clearTimeout(t);
  }, [first, canMark]);
  return baseline ?? null;
}

export function isNewItem(it: StreamItem, baseline: string | null): boolean {
  return !!baseline && it.at > baseline;
}

/* ─────────────── formatting ─────────────── */

export function fmtValue(v: number | null, fmt: StreamItem["valueFmt"]): string | null {
  if (v == null || !Number.isFinite(v) || !fmt) return null;
  if (fmt === "pct") return `${Math.round(v)}%`;
  if (fmt === "int") return v.toLocaleString("ru-RU");
  // Money as everywhere on the desk ($1,234.56 — formatCurrency, trade tables, the server-written subtitles).
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v > 0 ? `+$${abs}` : v < 0 ? `−$${abs}` : `$${abs}`;
}

const TIME_FMT = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
export function fmtTime(at: string): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? TIME_FMT.format(d) : "";
}

/* ─────────────── grouping ─────────────── */

export type StreamEntry =
  | { type: "item"; key: string; item: StreamItem }
  | { type: "group"; key: string; group: string; items: StreamItem[] };

/** Items sharing a `group` key on the same day collapse into one card (≥2), placed where the newest one was. */
export function groupDay(items: StreamItem[]): StreamEntry[] {
  const counts = new Map<string, number>();
  for (const it of items) if (it.group) counts.set(it.group, (counts.get(it.group) ?? 0) + 1);
  const out: StreamEntry[] = [];
  const placed = new Map<string, StreamItem[]>();
  for (const it of items) {
    if (it.group && (counts.get(it.group) ?? 0) >= 2) {
      const arr = placed.get(it.group);
      if (arr) { arr.push(it); continue; }
      const fresh = [it];
      placed.set(it.group, fresh);
      out.push({ type: "group", key: `g:${it.group}`, group: it.group, items: fresh });
    } else {
      out.push({ type: "item", key: it.id, item: it });
    }
  }
  return out;
}
