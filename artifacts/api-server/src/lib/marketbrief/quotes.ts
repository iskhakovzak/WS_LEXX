import { logger } from "../logger";
import { nyDate } from "../tradingDate";
import { isMarketClosed } from "../marketDays";
import { themeSession } from "../themes/logic";
import { detailsFor } from "../themes/tickerCache";

/**
 * Yahoo v8 quote layer of the morning brief (routes/marketbrief.ts): chart → quote, premarket / gap formulas,
 * batch fetch and the watchlist premarket %. Split out of routes/marketbrief.ts (size ratchet).
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const YAHOO_HEADERS = { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9" };
type QuoteSnapshot = {
  price: number | null;
  changePct: number | null;
  prevClose: number | null;
  preMarketPrice: number | null;
  preMarketChangePct: number | null;
  postMarketPrice: number | null;
  postMarketChangePct: number | null;
};

export const EMPTY_QUOTE: QuoteSnapshot = { price: null, changePct: null, prevClose: null, preMarketPrice: null, preMarketChangePct: null, postMarketPrice: null, postMarketChangePct: null };

type YahooV8Meta = {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  preMarketPrice?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChangePercent?: number;
};
type YahooV8Result = {
  meta?: YahooV8Meta;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: (number | null)[]; open?: (number | null)[] }> };
};
type YahooV8Response = { chart?: { result?: YahooV8Result[] } };

/**
 * A quote of the brief plus the session it trades in:
 *   lastClose  the close before the session `price` belongs to (today's bar → the bar before; no bar for today yet →
 *              the last bar) — the base of a future's premarket % and of a gap
 *   open       today's regular open (null before today's bar exists)
 */
export type ChartQuote = QuoteSnapshot & { lastClose: number | null; open: number | null };

const pct3 = (price: number | null | undefined, base: number | null | undefined): number | null =>
  price != null && base != null && base > 0 && Number.isFinite(price) && Number.isFinite(base) ? +(((price - base) / base) * 100).toFixed(3) : null;

/** Yahoo v8 chart (range=5d, interval=1d) → quote. `today` = the NY date now. Pure. */
export function quoteFromChart(result: YahooV8Result, today: string): ChartQuote {
  const meta = result.meta ?? {};
  const price = meta.regularMarketPrice ?? null;
  const rawCloses = result.indicators?.quote?.[0]?.close ?? [];
  const rawOpens = result.indicators?.quote?.[0]?.open ?? [];
  const timestamps = result.timestamp ?? [];
  // Valid closes with their bar index (timestamps stay aligned with the raw arrays).
  const bars: { i: number; c: number }[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    if (c != null && Number.isFinite(c) && c > 0) bars.push({ i, c });
  }
  const last = bars[bars.length - 1];
  const lastTs = last ? timestamps[last.i] : undefined;
  // session dates in New York (audit P1-12): UTC flips to "tomorrow" at 20:00 ET
  const lastBarIsToday = lastTs != null && nyDate(new Date(lastTs * 1000)) === today;

  // changePct keeps its meaning: the last move between two daily closes (before the open: the previous session's move).
  const prevClose = (bars.length >= 2 ? bars[bars.length - 2]!.c : null) ?? meta.chartPreviousClose ?? meta.previousClose ?? null;
  const lastClose = lastBarIsToday ? (bars.length >= 2 ? bars[bars.length - 2]!.c : null) : (last?.c ?? null);
  const openRaw = lastBarIsToday && last ? rawOpens[last.i] : null;
  const open = openRaw != null && Number.isFinite(openRaw) && openRaw > 0 ? openRaw : null;

  const changePct = pct3(price, prevClose);
  const preMarketPrice = meta.preMarketPrice ?? null;
  const preMarketChangePct = preMarketPrice != null && lastClose
    ? pct3(preMarketPrice, lastClose)
    : (meta.preMarketChangePercent != null ? +meta.preMarketChangePercent.toFixed(3) : null);
  const postMarketPrice = meta.postMarketPrice ?? null;
  const postMarketChangePct = postMarketPrice != null && price
    ? pct3(postMarketPrice, price)
    : (meta.postMarketChangePercent != null ? +meta.postMarketChangePercent.toFixed(3) : null);
  return { price, changePct, prevClose, preMarketPrice, preMarketChangePct, postMarketPrice, postMarketChangePct, lastClose, open };
}

/** A future's premarket %: the contract's price against the contract's own previous close (no index, no basis). */
export function futuresPremarketPct(q: Pick<ChartQuote, "price" | "lastClose">): number | null {
  return pct3(q.price, q.lastClose);
}

/**
 * Gap of a watchlist ticker: today's open against the previous close; before the open, the premarket print against the
 * previous close (`premarketPct`, the same % /themes shows). Never the day change.
 */
export function gapOf(q: Pick<ChartQuote, "open" | "lastClose">, premarketPct: number | null): number | null {
  if (q.open != null) return pct3(q.open, q.lastClose);
  return premarketPct != null && Number.isFinite(premarketPct) ? +premarketPct.toFixed(3) : null;
}

export const EMPTY_CHART: ChartQuote = { ...EMPTY_QUOTE, lastClose: null, open: null };

async function fetchYahooQuote(symbol: string): Promise<ChartQuote> {
  try {
    // range=5d gives enough daily bars to find the last completed session close.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
    const resp = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return { ...EMPTY_CHART };
    const data = (await resp.json()) as YahooV8Response;
    const result = data?.chart?.result?.[0];
    if (!result) return { ...EMPTY_CHART };
    return quoteFromChart(result, nyDate());
  } catch {
    return { ...EMPTY_CHART };
  }
}

export async function fetchBatchQuotes(symbols: string[]): Promise<Record<string, ChartQuote>> {
  const entries = await Promise.all(symbols.map(async (s) => [s, await fetchYahooQuote(s)] as const));
  return Object.fromEntries(entries);
}

const PREMARKET_WAIT_MS = 3_000;

/** Premarket % of the watchlist tickers (the /themes quote layer: today's last premarket print vs the previous close). */
export async function watchPremarket(tickers: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!tickers.length) return out;
  try {
    const now = new Date();
    const today = nyDate(now);
    const session = themeSession(now, await isMarketClosed(today));
    if (session === "closed") return out;
    const details = await detailsFor(tickers, session, today, PREMARKET_WAIT_MS);
    for (const [t, d] of details) if (d.quote.premarket != null) out.set(t, d.quote.premarket);
  } catch (e: any) {
    logger.warn({ error: e?.message }, "market brief: watchlist premarket failed");
  }
  return out;
}

