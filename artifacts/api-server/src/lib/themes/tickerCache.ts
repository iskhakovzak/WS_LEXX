/**
 * Per-ticker quote cache for personal themes («Мои темы»): a user's extra tickers never widen the shared base refresh.
 *
 *   fresh    same NY session and younger than the session TTL (30 s rth / 5 min otherwise, logic.ttlMs)
 *   seed     every base refresh writes its quotes here, so a personal ticker that is also in a base theme costs nothing
 *   fetch    only missing / stale tickers, in batches of ≤ 100, through the same provider chain (Finviz → Yahoo, pre /
 *            after-hours filled from Yahoo). Single-flight per batch: a ticker already being fetched is awaited, not
 *            requested again. A ticker the providers did not return is not retried for FAIL_BACKOFF_MS.
 *   answer   what is cached for the tickers and younger than MAX_AGE_MS (a stale quote beats none, last week's does
 *            not); the caller waits ≤ softWaitMs for fetches.
 * Per process, bounded (MAX_ENTRIES, the oldest entries go first).
 */
import { ttlMs, type MemberQuote, type ThemeSession } from "./logic";
import { fetchThemeQuotes, type QuotesResult } from "./quotes";
import { logger } from "../logger";

export const BATCH = 100;
export const FAIL_BACKOFF_MS = 60_000;
export const MAX_ENTRIES = 5_000;
export const MAX_AGE_MS = 12 * 60 * 60_000;

type Entry = { quote: MemberQuote; at: number; session: ThemeSession };

export type TickerCacheDeps = {
  now: () => number;
  fetchQuotes: (tickers: readonly string[], session: ThemeSession, today: string) => Promise<QuotesResult>;
};

const LIVE: TickerCacheDeps = {
  now: () => Date.now(),
  fetchQuotes: (tickers, session, today) => fetchThemeQuotes(tickers, session, today),
};

let deps: TickerCacheDeps = LIVE;
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();

/** Tests: inject deps, start empty. Returns a restore function. */
export function setTickerCacheDeps(d: Partial<TickerCacheDeps>): () => void {
  deps = { ...LIVE, ...d };
  entries.clear();
  inflight.clear();
  failedAt.clear();
  return () => {
    deps = LIVE;
    entries.clear();
    inflight.clear();
    failedAt.clear();
  };
}

function put(ticker: string, quote: MemberQuote, session: ThemeSession, at: number): void {
  entries.delete(ticker); // re-insert: Map order = age order
  entries.set(ticker, { quote, at, session });
  failedAt.delete(ticker);
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** The base refresh hands its quotes over (same timestamp and session as the base cache). */
export function seedQuotes(quotes: ReadonlyMap<string, MemberQuote>, session: ThemeSession, at: number): void {
  for (const [t, q] of quotes) put(t, q, session, at);
}

export function isFresh(ticker: string, session: ThemeSession, now = deps.now()): boolean {
  const e = entries.get(ticker);
  return !!e && e.session === session && now - e.at < ttlMs(session);
}

function fetchBatch(batch: string[], session: ThemeSession, today: string): Promise<void> {
  const job = (async () => {
    try {
      const res = await deps.fetchQuotes(batch, session, today);
      const at = deps.now();
      for (const t of batch) {
        const q = res.quotes.get(t);
        if (q) put(t, q, session, at);
        else failedAt.set(t, at);
      }
    } catch (err) {
      const at = deps.now();
      for (const t of batch) failedAt.set(t, at);
      logger.warn({ error: err instanceof Error ? err.message : String(err), n: batch.length }, "themes: personal quotes failed");
    } finally {
      for (const t of batch) inflight.delete(t);
    }
  })();
  for (const t of batch) inflight.set(t, job);
  return job;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

/** Quotes for `tickers`: fetches what is missing / stale (batched, single-flight), waits ≤ softWaitMs, answers the cache. */
export async function quotesFor(
  tickers: readonly string[],
  session: ThemeSession,
  today: string,
  softWaitMs = 4_000,
): Promise<Map<string, MemberQuote>> {
  const now = deps.now();
  const uniq = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const need = uniq.filter((t) => !isFresh(t, session, now) && !inflight.has(t) && now - (failedAt.get(t) ?? -Infinity) >= FAIL_BACKOFF_MS);
  for (let i = 0; i < need.length; i += BATCH) void fetchBatch(need.slice(i, i + BATCH), session, today);
  const waits = [...new Set(uniq.map((t) => inflight.get(t)).filter((p): p is Promise<void> => !!p))];
  if (waits.length) await Promise.race([Promise.all(waits), sleep(softWaitMs)]);
  const out = new Map<string, MemberQuote>();
  const at = deps.now();
  for (const t of uniq) {
    const e = entries.get(t);
    if (e && at - e.at < MAX_AGE_MS) out.set(t, e.quote);
  }
  return out;
}
