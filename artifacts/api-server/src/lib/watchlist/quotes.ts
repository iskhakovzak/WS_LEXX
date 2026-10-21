/**
 * Watchlist quotes on the common quote layer (Волна 1, item 1.7): the same per-ticker cache /themes reads
 * (lib/themes/tickerCache → Finviz export, Yahoo fallback, premarket held for the day) — so premarket %, gap and the
 * time-of-day RVOL of a ticker are one number on /themes, the tickers boards and the watchlist.
 */
import { sessionNow } from "../themes/service";
import { detailsFor } from "../themes/tickerCache";
import { ttlMs, type ThemeSession } from "../themes/logic";

/** Percent units (1.25 = 1.25 %); null = the provider had no value. */
export type LayerQuote = {
  price: number | null;
  /** vs the previous close (in premarket: the premarket print). */
  today: number | null;
  fromOpen: number | null;
  premarket: number | null;
  afterHours: number | null;
  /** Open vs the previous close (null before the open). */
  gap: number | null;
  /** Relative volume normalised to the time of day (Finviz); the Yahoo fallback sends volume / average volume. */
  rvol: number | null;
  float: number | null;
};

export type LayerQuotesResponse = { session: ThemeSession; asOf: string; quotes: Record<string, LayerQuote> };

export const LAYER_MAX_TICKERS = 200;
const SOFT_WAIT_MS = 3_000;
/** Stale-while-revalidate window: a same-session quote up to 2 × the layer TTL (≤ 3 min) is answered at once. */
export const layerStaleOkMs = (session: ThemeSession) => Math.min(2 * ttlMs(session), 3 * 60_000);

export async function layerQuotes(tickers: readonly string[]): Promise<LayerQuotesResponse> {
  const { session, today, now } = await sessionNow();
  const details = await detailsFor(tickers.slice(0, LAYER_MAX_TICKERS), session, today, SOFT_WAIT_MS, layerStaleOkMs(session));
  const quotes: Record<string, LayerQuote> = {};
  for (const [t, d] of details) {
    quotes[t] = {
      price: d.quote.price, today: d.quote.today, fromOpen: d.quote.fromOpen, premarket: d.quote.premarket, afterHours: d.quote.afterHours,
      gap: d.extras.gap, rvol: d.extras.rvol, float: d.extras.float,
    };
  }
  return { session, asOf: new Date(now).toISOString(), quotes };
}
