import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getListDailyFeedQueryKey, type DailyFeed } from "@workspace/api-client-react";
import { BASE } from "@/lib/api";
import { addDays, nyDate } from "@/lib/trading-date";
import { safeHttpUrl } from "@/lib/url";

/* ─────────────── server shape (additive fields on top of the generated DailyFeed) ─────────────── */

export type AckKind = "read" | "ack" | "trading_this";
export type FeedAcks = { counts: Record<AckKind, number>; mine: AckKind[]; users: Record<AckKind, string[]> };
/** `GET /api/dailyfeed` entries also carry the author and per-trader acks (read / принято / торгую это). */
export type FeedEntry = DailyFeed & { createdBy?: string | null; acks?: FeedAcks };
export const hasServerAcks = (f: FeedEntry): f is FeedEntry & { acks: FeedAcks } => !!f.acks && Array.isArray(f.acks.mine);

/* ─────────────── parsing ─────────────── */

export function splitList(s?: string | null): string[] {
  if (!s) return [];
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

/** Tickers are written free-form ("NVDA, meta  MSFT"); normalise to unique upper-case symbols. */
export function parseTickers(s?: string | null): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const raw of s.split(/[,\s;/]+/)) {
    const t = raw.replace(/^\$/, "").trim().toUpperCase();
    if (t && /^[A-Z0-9.\-^=]{1,12}$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

export const dayOf = (f: Pick<DailyFeed, "date">) => f.date.substring(0, 10);

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function parseDay(d: string): Date {
  return new Date(d + "T12:00:00");
}

/** Calendar shift of a YYYY-MM-DD day — pure date arithmetic, no browser-timezone drift. */
export function shiftDay(d: string, delta: number): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? addDays(d, delta) : d;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

export function formatDayLong(d: string): string {
  try {
    const s = parseDay(d).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch { return d; }
}

export function formatDayShort(d: string): string {
  try { return parseDay(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); } catch { return d; }
}

export function relativeDayLabel(d: string, today = nyDate()): string | null {
  const diff = daysBetween(d, today);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  if (diff === -1) return "Завтра";
  if (diff > 1 && diff < 7) return `${diff} ${pluralRu(diff, "день", "дня", "дней")} назад`;
  return null;
}

/** Screenshot list with TradingView share links converted to their snapshot image. */
export type Shot = { href: string; img: string; note: string };

export function tvSnapshot(url: string): string {
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)\/?/);
  if (!m) return url;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id.charAt(0).toLowerCase()}/${id}.png`;
}

export function parseShots(urls?: string | null, notes?: string | null): Shot[] {
  const list = (urls || "").split("\n").map((u) => safeHttpUrl(u)).filter((u): u is string => !!u);
  let noteList: string[] = [];
  if (notes) {
    try {
      const parsed = JSON.parse(notes);
      if (Array.isArray(parsed)) noteList = parsed.map((n) => (typeof n === "string" ? n : ""));
    } catch {
      noteList = notes.split("\n");
    }
  }
  return list.map((href, i) => ({ href, img: tvSnapshot(href), note: noteList[i] ?? "" }));
}

/** Plain-text version of an entry for pasting into Telegram / chat. */
export function entryToText(f: DailyFeed): string {
  const lines = [`📅 ${formatDayLong(dayOf(f))}`];
  if (f.marketTheme) lines.push(`Тема: ${f.marketTheme}`);
  const tickers = parseTickers(f.bestTickers);
  if (tickers.length) lines.push(`Тикеры: ${tickers.join(", ")}`);
  if (f.whatWorksNow) lines.push(`✅ Работает: ${f.whatWorksNow}`);
  if (f.whatDoesntWork) lines.push(`⛔ Не работает: ${f.whatDoesntWork}`);
  if (f.notes) lines.push("", f.notes);
  const tags = splitList(f.tags);
  if (tags.length) lines.push("", tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" "));
  return lines.join("\n");
}

/* ─────────────── per-viewer read state & bookmarks (localStorage) ─────────────── */

type StoredState = { baseline: string; read: number[]; bookmarks: number[] };
const UNREAD_LOOKBACK_DAYS = 3;
const MAX_READ = 2000;

function storageKey(user: string) {
  return `ws-feed-state:${user || "anon"}`;
}

function loadState(user: string): StoredState {
  const fallbackBaseline = new Date(Date.now() - UNREAD_LOOKBACK_DAYS * 86400000).toISOString();
  try {
    const raw = localStorage.getItem(storageKey(user));
    if (raw) {
      const p = JSON.parse(raw) as Partial<StoredState>;
      return {
        baseline: typeof p.baseline === "string" ? p.baseline : fallbackBaseline,
        read: Array.isArray(p.read) ? p.read.filter((n) => typeof n === "number") : [],
        bookmarks: Array.isArray(p.bookmarks) ? p.bookmarks.filter((n) => typeof n === "number") : [],
      };
    }
  } catch { /* storage unavailable */ }
  return { baseline: fallbackBaseline, read: [], bookmarks: [] };
}

function saveState(user: string, s: StoredState) {
  try { localStorage.setItem(storageKey(user), JSON.stringify(s)); } catch { /* ignore */ }
}

/**
 * "Непрочитанное": an entry is unread when it was created after the viewer's baseline
 * (first visit minus a short lookback) and hasn't been seen yet. Stored per viewer.
 */
export function useFeedViewerState(user: string) {
  const [state, setState] = useState<StoredState>(() => loadState(user));
  useEffect(() => { setState(loadState(user)); }, [user]);

  const update = useCallback((fn: (s: StoredState) => StoredState) => {
    setState((prev) => {
      const next = fn(prev);
      if (next !== prev) saveState(user, next);
      return next;
    });
  }, [user]);

  const readSet = useMemo(() => new Set(state.read), [state.read]);
  const bookmarkSet = useMemo(() => new Set(state.bookmarks), [state.bookmarks]);
  const baselineMs = useMemo(() => Date.parse(state.baseline) || 0, [state.baseline]);

  /** Created after the viewer's baseline (first visit minus a short lookback / last «прочитать всё»). */
  const afterBaseline = useCallback(
    (f: Pick<DailyFeed, "createdAt">) => (Date.parse(f.createdAt) || 0) > baselineMs,
    [baselineMs],
  );
  const isUnread = useCallback(
    (f: Pick<DailyFeed, "id" | "createdAt">) => !readSet.has(f.id) && afterBaseline(f),
    [readSet, afterBaseline],
  );

  const markRead = useCallback((id: number) => update((s) => (
    s.read.includes(id) ? s : { ...s, read: [...s.read, id].slice(-MAX_READ) }
  )), [update]);

  const markUnread = useCallback((id: number, createdAt: string) => update((s) => {
    const created = Date.parse(createdAt) || Date.now();
    const baseline = created <= Date.parse(s.baseline) ? new Date(created - 1000).toISOString() : s.baseline;
    return { ...s, baseline, read: s.read.filter((x) => x !== id) };
  }), [update]);

  /** Moving the baseline to "now" marks everything existing as read and keeps the read list small. */
  const markAllRead = useCallback(() => update((s) => ({ ...s, baseline: new Date().toISOString(), read: [] })), [update]);

  const toggleBookmark = useCallback((id: number) => update((s) => ({
    ...s,
    bookmarks: s.bookmarks.includes(id) ? s.bookmarks.filter((x) => x !== id) : [...s.bookmarks, id],
  })), [update]);

  return { isUnread, afterBaseline, markRead, markUnread, markAllRead, bookmarkSet, toggleBookmark };
}

/**
 * Unread = not acked as read on the server (per trader, `feed_acks`) AND created after the local baseline,
 * so a first visit doesn't flood the viewer with every old entry. The author never sees their own entry as new.
 * Entries without server acks (older API) fall back to the localStorage read list.
 */
export function entryIsUnread(f: FeedEntry, me: string, viewer: Pick<ReturnType<typeof useFeedViewerState>, "isUnread" | "afterBaseline">): boolean {
  if (!hasServerAcks(f)) return viewer.isUnread(f);
  if (me && f.createdBy === me) return false;
  if (f.acks.mine.includes("read")) return false;
  return viewer.isUnread(f);
}

/**
 * `POST /api/dailyfeed/:id/ack {kind, on}` with an optimistic patch of the cached list.
 * Resolves to the server summary, or null when the endpoint is not deployed (404).
 */
export function useFeedAck(me: string) {
  const qc = useQueryClient();
  const patch = useCallback((id: number, fn: (a: FeedAcks) => FeedAcks) => {
    qc.setQueriesData<FeedEntry[]>({ queryKey: getListDailyFeedQueryKey() }, (old) =>
      old?.map((f) => (f.id === id && hasServerAcks(f) ? { ...f, acks: fn(f.acks) } : f)));
  }, [qc]);
  return useCallback(async (id: number, kind: AckKind, on: boolean): Promise<FeedAcks | null> => {
    patch(id, (a) => {
      const had = a.mine.includes(kind);
      if (had === on) return a;
      const users = { ...a.users, [kind]: on ? [...(a.users[kind] ?? []), me].filter(Boolean) : (a.users[kind] ?? []).filter((u) => u !== me) };
      return {
        counts: { ...a.counts, [kind]: Math.max(0, (a.counts[kind] ?? 0) + (on ? 1 : -1)) },
        mine: on ? [...a.mine, kind] : a.mine.filter((k) => k !== kind),
        users,
      };
    });
    const r = await fetch(`${BASE}/api/dailyfeed/${id}/ack`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, on }),
    });
    if (r.status === 404) return null;
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      void qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() });
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    const data = (await r.json()) as { id: number; acks: FeedAcks };
    patch(id, () => data.acks);
    return data.acks;
  }, [me, patch, qc]);
}

/** Small remembered UI preference (filters, collapsed panels). `allowed` rejects stale/garbage stored values. */
export function useStoredPref<T>(key: string, initial: T, allowed?: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      const v = JSON.parse(raw) as T;
      return allowed && !allowed.includes(v) ? initial : v;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }, [key, value]);
  return [value, setValue] as const;
}

/* ─────────────── session context (trades + events per day) ─────────────── */

/** `GET /api/dailyfeed/context` per NY trading day — one math from the API (WR excludes BE, net = gross − |fees|). */
export type DayContext = {
  trades: number;
  wins: number;
  losses: number;
  be?: number;
  open?: number;
  traders: number;
  sumR: number | null;
  grossPnl?: number | null;
  fees?: number | null;
  netPnl?: number | null;
  synced?: boolean;
  lastSyncedAt?: string | null;
  byAccount?: { account: string; n: number; grossPnl: number | null; fees: number | null; netPnl: number | null; synced?: boolean }[];
  tickers: { ticker: string; n: number }[];
  events: number;
  eventItems: { id: number; ticker: string; eventType: string; headline: string; percentMove: number | null; session?: string | null }[];
};

export function useFeedContext(from: string | null, to: string | null) {
  return useQuery({
    queryKey: ["dailyfeed-context", from, to],
    enabled: !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, DayContext>> => {
      const r = await fetch(`${BASE}/api/dailyfeed/context?from=${from}&to=${to}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { days?: Record<string, DayContext> };
      return data.days ?? {};
    },
  });
}
