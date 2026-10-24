/**
 * Hooks of the dashboard quote card: the bundled library in the reader's language, the synced preferences
 * (users.settings.quotes + the local mirror) and the day's quote with «следующая», history and context.
 *
 * Day quote: one per NY trading date, drawn from the reader's no-repeat cycle (lib/quotes/rotation.ts) with the
 * dashboard weights and the chosen categories; after a red day / on a green streak the draw prefers the matching
 * tags (lib/quotes/context.ts). The context comes from the daily loop the dashboard already loaded (no request of
 * its own): the first draw waits briefly for that cache entry.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyMeQuery } from "@/lib/api/queries";
import type { DailyMe } from "@/lib/daily/types";
import { nyDate } from "@/lib/trading-date";
import { loadQuoteLibrary, type QuoteLibrary } from "@/lib/quotes/library";
import { moodOf, moodTags, recordDay, type QuoteMood } from "@/lib/quotes/context";
import { SURFACE_WEIGHTS, nextQuote, quoteForSlot, type RotationState } from "@/lib/quotes/rotation";
import {
  FAVS_MAX, pushHistory, readHistory, readLedger, readPrefs, readRotation, seedFor, writeLedger, writePrefs, writeRotation,
  type HistoryEntry, type QuotePrefs,
} from "@/lib/quotes/store";
import { fetchQuotePrefs, newSeed, saveQuotePrefs } from "@/lib/quotes/prefs-api";
import type { QuoteLang } from "@/lib/quotes/types";

export function useQuoteLibrary(lang: QuoteLang) {
  return useQuery<QuoteLibrary>({
    queryKey: ["quotes", "library", lang],
    queryFn: () => loadQuoteLibrary(lang),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    meta: { i18n: false },
  });
}

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

export interface DashQuoteFeed {
  /** The quote of the day (or the one picked by «следующая»). */
  currentId: string | null;
  /** The day's own draw (context-matched when there is a mood); «следующая» moves currentId away from it. */
  dayId: string | null;
  history: HistoryEntry[];
  mood: QuoteMood;
  next: () => void;
}

export function useDashQuote(lib: QuoteLibrary | undefined, prefs: QuotePrefs, user: string | null): DashQuoteFeed {
  const { mood, ready } = useQuoteMood(user);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [dayId, setDayId] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>(() => readHistory(user));
  const slot = nyDate();
  const catsKey = prefs.cats.join(",");
  const opt = React.useMemo(
    () => ({ seed: seedFor(prefs, user, "dash"), weights: SURFACE_WEIGHTS.dash, cats: catsKey ? (catsKey.split(",") as QuotePrefs["cats"]) : null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catsKey stands for prefs.cats
    [prefs.seed, user, catsKey],
  );

  const commit = React.useCallback((id: string, state: RotationState) => {
    writeRotation("dash", user, state);
    setHistory(pushHistory(user, { id, at: Date.now(), s: "dash" }));
    setCurrentId(id);
  }, [user]);

  React.useEffect(() => {
    if (!lib || !ready) return;
    const r = quoteForSlot(lib.quotes, readRotation("dash", user), { ...opt, preferTags: moodTags(mood) }, slot);
    if (!r) return;
    if (r.changed) commit(r.id, r.state);
    else setCurrentId(r.id);
    setDayId(r.id);
  }, [lib, ready, opt, slot, user, commit, mood]);

  const next = React.useCallback(() => {
    if (!lib) return;
    const r = nextQuote(lib.quotes, readRotation("dash", user), opt, slot);
    if (r) commit(r.id, r.state);
  }, [lib, opt, slot, user, commit]);

  return { currentId, dayId, history, mood, next };
}
