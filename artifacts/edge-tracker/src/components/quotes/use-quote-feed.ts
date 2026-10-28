/**
 * Hooks of the dashboard quote card (quotes by id: lib/quotes/hooks): the synced preferences
 * (users.settings.quotes + the local mirror) and the day's quote with «следующая», history and context.
 *
 * Day quote: one per NY trading date, drawn by the server (POST /api/quotes/pick) from the reader's no-repeat cycle,
 * which stays in this browser (lib/quotes/store) — with the dashboard weights and the chosen categories; after a red
 * day / on a green streak the draw prefers the matching tags (lib/quotes/context). Once today's quote is drawn it is
 * kept with the cycle, so reloads that day show it without a request. The next draw is prefetched when the reader
 * points at «Следующая» or the page goes idle, so the click shows it at once. The context comes from the daily loop
 * the dashboard already loaded (no request of its own): the first draw waits briefly for that cache entry.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyMeQuery } from "@/lib/api/queries";
import type { DailyMe } from "@/lib/daily/types";
import { nyDate } from "@/lib/trading-date";
import { cachedCat, cachedTotal, pickQuote, type PickRequest, type PickResult } from "@/lib/quotes/api";
import { moodOf, moodTags, recordDay, type QuoteMood } from "@/lib/quotes/context";
import {
  FAVS_MAX, pushHistory, readHistory, readLedger, readPrefs, readRotation, rotationCurrent, userKey, writeLedger, writePrefs, writeRotation,
  type HistoryEntry, type QuotePrefs,
} from "@/lib/quotes/store";
import { fetchQuotePrefs, newSeed, saveQuotePrefs } from "@/lib/quotes/prefs-api";
import type { QuoteLang } from "@/lib/quotes/types";

/** Preferences: the local mirror at once, the server copy when it arrives; writes go to both (guests: local only). */
export function useQuotePrefs(user: string | null, member: boolean) {
  const qc = useQueryClient();
  const key = React.useMemo(() => ["quotes", "prefs", user] as const, [user]);
  const [prefs, setPrefs] = React.useState<QuotePrefs>(() => readPrefs(user));
  const server = useQuery({
    queryKey: key,
    queryFn: fetchQuotePrefs,
    enabled: member && !!user,
    staleTime: 10 * 60_000,
    retry: 1,
    meta: { i18n: false },
  });

  const save = React.useCallback((next: QuotePrefs) => {
    setPrefs(next);
    writePrefs(user, next);
    qc.setQueryData(key, next);
    if (member) void saveQuotePrefs(next).catch(() => undefined); // a failed write keeps the local copy
  }, [user, member, qc, key]);

  // Adopt the server copy; the first time (no seed stored yet) give the reader their own seed.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!server.isSuccess) return;
    const remote = server.data ?? { favs: [], cats: [] };
    if (remote.seed === undefined && !seeded.current) {
      seeded.current = true;
      save({ ...remote, seed: readPrefs(user).seed ?? newSeed() });
      return;
    }
    setPrefs(remote);
    writePrefs(user, remote);
  }, [server.isSuccess, server.data, user, save]);

  const toggleFav = React.useCallback((id: string) => {
    const has = prefs.favs.includes(id);
    save({ ...prefs, favs: has ? prefs.favs.filter((x) => x !== id) : [id, ...prefs.favs].slice(0, FAVS_MAX) });
  }, [prefs, save]);

  return { prefs, save, toggleFav };
}

/** The last finished day from the dashboard's daily-loop cache → mood; null until known (or after `waitMs`). */
function useQuoteMood(user: string | null, waitMs = 1500): { mood: QuoteMood; ready: boolean } {
  const daily = useQuery<DailyMe | null>({ ...dailyMeQuery(nyDate()), enabled: false });
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), waitMs);
    return () => window.clearTimeout(t);
  }, [waitMs]);
  const evening = daily.data?.evening ?? null;
  const mood = React.useMemo(() => {
    const before = readLedger(user);
    const next = recordDay(before, evening?.date, evening?.netPnl);
    if (next !== before) writeLedger(user, next);
    return moodOf(next);
  }, [user, evening?.date, evening?.netPnl]);
  return { mood, ready: daily.data !== undefined || timedOut };
}

/** Run `fn` when the page is idle (or after `ms` at the latest). Returns the cancel. */
function onIdle(fn: () => void, ms: number): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: ms });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, Math.min(ms, 2000));
  return () => window.clearTimeout(t);
}

export interface DashQuoteFeed {
  /** The quote of the day (or the one picked by «следующая»). */
  currentId: string | null;
  /** The day's own draw (context-matched when there is a mood); «следующая» moves currentId away from it. */
  dayId: string | null;
  history: HistoryEntry[];
  mood: QuoteMood;
  /** Library size (the card's counter); null until the first answer. */
  total: number | null;
  /** The day's draw failed (no quote to show). */
  error: boolean;
  retry: () => void;
  next: () => void;
  /** Warm the next draw (hover / focus on «Следующая»). */
  prefetchNext: () => void;
}

export function useDashQuote(lang: QuoteLang, prefs: QuotePrefs, user: string | null): DashQuoteFeed {
  const { mood, ready } = useQuoteMood(user);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [dayId, setDayId] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>(() => readHistory(user));
  const [total, setTotal] = React.useState<number | null>(() => cachedTotal());
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const slot = nyDate();
  const catsKey = prefs.cats.join(",");
  const base = React.useMemo(
    () => ({ surface: "dash" as const, seed: prefs.seed ?? null, who: userKey(user), cats: catsKey ? (catsKey.split(",") as QuotePrefs["cats"]) : null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catsKey stands for prefs.cats
    [prefs.seed, user, catsKey],
  );

  const commit = React.useCallback((r: PickResult) => {
    if (r.changed) {
      writeRotation("dash", user, r.state);
      setHistory(pushHistory(user, { id: r.id, at: Date.now(), s: "dash" }));
    }
    setTotal(r.total);
    setCurrentId(r.id);
  }, [user]);

  // The day's quote: the stored one while the slot is today and its category is on, else a draw.
  React.useEffect(() => {
    const raw = readRotation("dash", user);
    const cur = rotationCurrent(raw);
    const cat = cur?.slot === slot ? cachedCat(cur.id) : null;
    if (cur && cat && (!base.cats || base.cats.includes(cat))) {
      setCurrentId(cur.id);
      setDayId(cur.id);
      setError(false);
      return;
    }
    if (!ready) return;
    let alive = true;
    pickQuote({ ...base, lang, slot, tags: moodTags(mood), state: raw })
      .then((r) => { if (!alive) return; commit(r); setDayId(r.id); setError(false); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [ready, base, slot, user, lang, mood, commit, attempt]);

  // «Следующая»: one prefetched draw for the current cycle; the click takes it (or asks now).
  const pending = React.useRef<{ key: string; p: Promise<PickResult> } | null>(null);
  const nextRequest = React.useCallback((): PickRequest => ({ ...base, lang, slot, next: true, state: readRotation("dash", user) }), [base, lang, slot, user]);
  const prefetchNext = React.useCallback(() => {
    const req = nextRequest();
    const key = JSON.stringify(req);
    if (pending.current?.key === key) return;
    const p = pickQuote(req);
    pending.current = { key, p };
    p.catch(() => { if (pending.current?.p === p) pending.current = null; });
  }, [nextRequest]);

  const next = React.useCallback(() => {
    prefetchNext();
    const p = pending.current?.p;
    if (!p) return;
    pending.current = null;
    void p.then(commit).catch(() => undefined);
  }, [prefetchNext, commit]);

  // Idle prefetch once the day's quote is on screen.
  React.useEffect(() => {
    if (!currentId) return;
    return onIdle(prefetchNext, 5000);
  }, [currentId, prefetchNext]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);

  return { currentId, dayId, history, mood, total, error, retry, next, prefetchNext };
}
