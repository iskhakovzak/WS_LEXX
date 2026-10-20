/**
 * GET /api/themes — the in-memory quote cache. No scheduler: a request refreshes lazily, so it works with
 * JOBS_ENABLED=false and on serverless.
 *
 *   fresh     same NY session, younger than its TTL (30 s rth / 5 min otherwise), covers every active ticker → answer
 *   stale     one refresh at a time (single-flight). With older numbers in hand a request waits ≤ SOFT_WAIT_MS for it,
 *             then answers with what it has (the refresh finishes in the background); without any it waits.
 *   failure   the last good numbers stay; no new attempt for FAIL_BACKOFF_MS; `stale: true` once they are older
 *             than 2 × TTL or a refresh after them failed.
 * Per process: two instances may each refresh (the providers' own throttles hold).
 */
import { nyDate } from "../tradingDate";
import { isMarketClosed } from "../marketDays";
import { logger } from "../logger";
import { buildResponse, themeSession, themeTickers, ttlMs, type MemberQuote, type ThemeRow, type ThemeSession, type ThemeSource, type ThemesResponse } from "./logic";
import { fetchThemeQuotes, type QuotesResult } from "./quotes";
import { listThemes } from "./store";

export const SOFT_WAIT_MS = 4_000;
export const FAIL_BACKOFF_MS = 30_000;

type Cache = { quotes: Map<string, MemberQuote>; asOf: number; source: ThemeSource; session: ThemeSession; tickers: Set<string> };

export type ServiceDeps = {
  now: () => number;
  loadThemes: () => Promise<ThemeRow[]>;
  isClosed: (nyDay: string) => Promise<boolean>;
  fetchQuotes: (tickers: readonly string[], session: ThemeSession, today: string) => Promise<QuotesResult>;
};

const LIVE: ServiceDeps = {
  now: () => Date.now(),
  loadThemes: async () => (await listThemes(false)).map((t) => ({ id: t.id, name: t.name, tickers: t.tickers })),
  isClosed: isMarketClosed,
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
    } catch (err) {
      lastFailAt = deps.now();
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, "themes: quote refresh failed");
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

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
    if (cache) await Promise.race([job, sleep(SOFT_WAIT_MS)]);
    else await job;
  }
  const c = cache as Cache | null;
  const t = deps.now();
  const stale = !!c && (t - c.asOf > 2 * ttl || lastFailAt > c.asOf);
  return buildResponse(themes, c, session, stale);
}
