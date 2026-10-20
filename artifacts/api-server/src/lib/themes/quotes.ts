/**
 * Market themes — quotes for many tickers at once. Provider order:
 *   1. Finviz Elite export (lib/finviz/client: `t=` lists of ≤ 100 tickers, the shared ≥ 3 s request queue) when the
 *      feature is on (FINVIZ_AUTH set + desk switch finviz.enabled);
 *   2. otherwise — or when Finviz returned nothing usable — Yahoo v7 /finance/quote, 50 symbols per request through
 *      the shared cookie/crumb session (marketDataService.fetchYahooWithSession), 3 requests in parallel.
 * Finviz has no premarket / after-hours columns: with Finviz as the source those two values are filled from the same
 * Yahoo batches (best effort — a failed Yahoo call leaves them null; today / fromOpen stay Finviz's).
 * Throws when neither produced a single quote (the caller keeps its last good numbers).
 * `deps` are injectable: tests never touch the network.
 */
import { fetchTickers } from "../finviz/client";
import { finvizEnabled } from "../finviz/presets";
import { fetchYahooWithSession } from "../marketDataService";
import { logger } from "../logger";
import {
  quoteFromFinviz, quoteFromYahoo, type FinvizLike, type MemberQuote, type ThemeSession, type ThemeSource, type YahooQuoteLike,
} from "./logic";

export const YAHOO_BATCH = 50;
const YAHOO_PARALLEL = 3;

export type QuotesResult = { source: ThemeSource; quotes: Map<string, MemberQuote> };

export type QuoteDeps = {
  finvizOn: () => boolean;
  finviz: (tickers: readonly string[], today: string) => Promise<{ rows: FinvizLike[]; errors: string[] }>;
  /** One Yahoo v7 quote request → its `quoteResponse.result` (null = the request failed). */
  yahooBatch: (symbols: readonly string[]) => Promise<YahooQuoteLike[] | null>;
};

async function yahooBatchLive(symbols: readonly string[]): Promise<YahooQuoteLike[] | null> {
  const resp = await fetchYahooWithSession((s) =>
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}&crumb=${encodeURIComponent(s.crumb)}`,
  );
  if (!resp || !resp.ok) return null;
  const data = (await resp.json()) as { quoteResponse?: { result?: YahooQuoteLike[] } };
  return data?.quoteResponse?.result ?? [];
}

export const LIVE_QUOTE_DEPS: QuoteDeps = {
  finvizOn: finvizEnabled,
  finviz: (tickers, today) => fetchTickers(tickers, today),
  yahooBatch: yahooBatchLive,
};

const hasMove = (q: MemberQuote) => q.today != null || q.price != null;

async function fromFinviz(tickers: readonly string[], session: ThemeSession, today: string, deps: QuoteDeps): Promise<Map<string, MemberQuote>> {
  const out = new Map<string, MemberQuote>();
  const { rows, errors } = await deps.finviz(tickers, today);
  for (const r of rows) {
    const q = quoteFromFinviz(r, session);
    if (hasMove(q)) out.set(q.ticker, q);
  }
  if (errors.length) logger.warn({ errors: errors.slice(0, 3), got: out.size }, "themes: finviz batches failed");
  return out;
}

async function fromYahoo(tickers: readonly string[], session: ThemeSession, today: string, deps: QuoteDeps): Promise<Map<string, MemberQuote>> {
  const out = new Map<string, MemberQuote>();
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += YAHOO_BATCH) batches.push(tickers.slice(i, i + YAHOO_BATCH));
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      try {
        const res = await deps.yahooBatch(batch);
        if (!res) { failed++; continue; }
        for (const raw of res) {
          const q = quoteFromYahoo(raw, session, today);
          if (q && hasMove(q)) out.set(q.ticker, q);
        }
      } catch (err) {
        failed++;
        logger.warn({ error: err instanceof Error ? err.message : String(err) }, "themes: yahoo batch failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(YAHOO_PARALLEL, batches.length) }, worker));
  if (failed) logger.warn({ failed, batches: batches.length, got: out.size }, "themes: yahoo batches failed");
  return out;
}

/** Premarket / after-hours of Finviz quotes from Yahoo (in place). Never throws. */
async function fillExtended(quotes: Map<string, MemberQuote>, session: ThemeSession, today: string, deps: QuoteDeps): Promise<void> {
  try {
    const extra = await fromYahoo([...quotes.keys()], session, today, deps);
    for (const [t, q] of quotes) {
      const y = extra.get(t);
      if (y) quotes.set(t, { ...q, premarket: y.premarket, afterHours: y.afterHours });
    }
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "themes: yahoo pre/post fill failed");
  }
}

export async function fetchThemeQuotes(
  tickers: readonly string[],
  session: ThemeSession,
  today: string,
  deps: QuoteDeps = LIVE_QUOTE_DEPS,
): Promise<QuotesResult> {
  if (deps.finvizOn()) {
    try {
      const quotes = await fromFinviz(tickers, session, today, deps);
      if (quotes.size) {
        await fillExtended(quotes, session, today, deps);
        return { source: "finviz", quotes };
      }
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, "themes: finviz failed, trying yahoo");
    }
  }
  const quotes = await fromYahoo(tickers, session, today, deps);
  if (!quotes.size) throw new Error("themes: no quotes from any provider");
  return { source: "yahoo", quotes };
}
