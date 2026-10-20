/**
 * The watchlist on the common quote layer (Волна 1, item 1.7): GET /api/watchlist/quotes answers from the same
 * per-ticker cache /themes reads (Finviz: gap, time-of-day RVOL; Yahoo: the premarket print, held for the day). Those
 * numbers replace the watchlist's own gap / RVOL, so «в игре» (gap ≥ 3 %, RVOL ≥ 1.5) agrees with /themes; before the
 * open the gap IS the premarket move. The rest of a quote (ATR, prev close, 52 w, sparkline) still comes from
 * /api/stockdata/quote.
 */
import type { Quote } from "./lib";

export type LayerQuote = {
  price: number | null; today: number | null; fromOpen: number | null; premarket: number | null; afterHours: number | null;
  gap: number | null; rvol: number | null; float: number | null;
};
export type LayerResponse = { session: "pre" | "rth" | "post" | "closed"; asOf: string; quotes: Record<string, LayerQuote> };

const EMPTY: Omit<Quote, "price" | "change"> = {
  open: null, high: null, low: null, prevClose: null, volume: null, avgVolume: null, relativeVolume: null,
  high52w: null, low52w: null, name: null, gapPct: null, atr: null,
};

/** The page's quotes with the layer's gap / RVOL / premarket on top (a ticker only the layer knows gets a short quote). */
export function overlayLayer(base: Readonly<Record<string, Quote>>, layer: LayerResponse | null | undefined): Record<string, Quote> {
  if (!layer?.quotes) return base as Record<string, Quote>;
  const out: Record<string, Quote> = { ...base };
  for (const [t, l] of Object.entries(layer.quotes)) {
    const b = out[t] ?? { ...EMPTY, price: l.price, change: l.today };
    out[t] = {
      ...b,
      // Before the open the gap is the premarket move (yesterday's open-vs-close is not today's gap).
      gapPct: layer.session === "pre" ? l.premarket : l.gap ?? b.gapPct,
      relativeVolume: l.rvol ?? b.relativeVolume,
      premarketPct: l.premarket,
    };
  }
  return out;
}
