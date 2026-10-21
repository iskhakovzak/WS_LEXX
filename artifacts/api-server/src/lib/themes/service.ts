/**
 * GET /api/themes — the in-memory quote cache. No scheduler: a request refreshes lazily, so it works with
 * JOBS_ENABLED=false and on serverless.
 *
 *   fresh     same NY session, younger than its TTL (30 s rth / 5 min otherwise), covers every active ticker → answer
 *   stale     one refresh at a time (single-flight). With older numbers in hand a request answers them at once and the
 *             refresh runs in the background (a full refresh of ~350 tickers takes ~45 s: the Finviz queue + Yahoo);
 *             the next request reads its numbers. Only a cold start (no numbers at all) waits for it.
 *   failure   the last good numbers stay; no new attempt for FAIL_BACKOFF_MS; `stale: true` once they are older
 *             than 2 × TTL or a refresh after them failed.
 * Per process: two instances may each refresh (the providers' own throttles hold). Personal themes are added per viewer
 * in board.ts on top of this shared board.
 */
import { nyDate, type DaySession } from "../tradingDate";
import { sessionFor } from "../marketDays";
import { logger } from "../logger";
import { buildResponse, themeSession, themeTickers, ttlMs, type MemberQuote, type ThemeRow, type ThemeSession, type ThemeSource, type ThemesResponse } from "./logic";
import { fetchThemeQuotes, type QuotesResult } from "./quotes";
import { listThemes } from "./store";
import { seedQuotes } from "./tickerCache";

/** How long a personal board waits for its screener re-resolve before answering (lib/themes/board.ts). */
export const SOFT_WAIT_MS = 4_000;
export const FAIL_BACKOFF_MS = 30_000;

type Cache = { quotes: Map<string, MemberQuote>; asOf: number; source: ThemeSource; session: ThemeSession; tickers: Set<string> };

export type ServiceDeps = {
  now: () => number;
  loadThemes: () => Promise<ThemeRow[]>;
  isClosed: (nyDay: string) => Promise<boolean | DaySession>;
  fetchQuotes: (tickers: readonly string[], session: ThemeSession, today: string) => Promise<QuotesResult>;
};

const LIVE: ServiceDeps = {
  now: () => Date.now(),
  loadThemes: async () => (await listThemes(false)).map((t) => ({ id: t.id, name: t.name, tickers: t.tickers })),
  isClosed: sessionFor,
  fetchQuotes: (tickers, session, today) => fetchThemeQuotes(tickers, session, today),
};

let deps: ServiceDeps = LIVE;
let cache: Cache | null = null;
let inflight: Promise<void> | null = null;
let lastFailAt = 0;

/** Tests: inject deps and start from an empty cache. Returns a restore function. */
export function setThemeServiceDeps(d: Partial<ServiceDeps>): () => void {
  deps = { ...LIVE, ...d };
  cache = null;
  inflight = null;
  lastFailAt = 0;
  return () => {
    deps = LIVE;
    cache = null;
    inflight = null;
    lastFailAt = 0;
  };
}

function refresh(tickers: string[], session: ThemeSession, today: string): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await deps.fetchQuotes(tickers, session, today);
      cache = { quotes: res.quotes, asOf: deps.now(), source: res.source, session, tickers: new Set(tickers) };
      seedQuotes(res.quotes, session, cache.asOf, res.extras); // personal themes / boards reuse base quotes (lib/themes/tickerCache)
    } catch (err) {
      lastFailAt = deps.now();
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, "themes: quote refresh failed");
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The NY session and date right now (boards read quotes for it without touching the shared board). */
export async function sessionNow(): Promise<{ session: ThemeSession; today: string; now: number }> {
  const now = deps.now();
  const today = nyDate(new Date(now));
  return { session: themeSession(new Date(now), await deps.isClosed(today)), today, now };
}

export async function getThemes(): Promise<ThemesResponse> {
  const now = deps.now();
  const today = nyDate(new Date(now));
  const session = themeSession(new Date(now), await deps.isClosed(today));
  const themes = await deps.loadThemes();
  const tickers = themeTickers(themes);
  const ttl = ttlMs(session);
  const isFresh = (c: Cache | null) => !!c && c.session === session && now - c.asOf < ttl && tickers.every((t) => c.tickers.has(t));

  if (tickers.length && !isFresh(cache) && now - lastFailAt >= FAIL_BACKOFF_MS) {
    const job = refresh(tickers, session, today);
    if (!cache) await job; // cold start: nothing to answer yet; otherwise the refresh lands in the background
  }
  const c = cache as Cache | null;
  const t = deps.now();
  // Cached numbers keep the session they were fetched in (a board of the regular session is never labelled
  // post-market), and numbers of another session than the current one are stale until the refresh lands.
  const stale = !!c && (c.session !== session || t - c.asOf > 2 * ttl || lastFailAt > c.asOf);
  return buildResponse(themes, c, c?.session ?? session, stale);
}
