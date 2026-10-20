import { describe, expect, it } from "vitest";
import type { Quote } from "./lib";
import { overlayLayer, type LayerQuote, type LayerResponse } from "./quote-layer";

const base: Quote = {
  price: 100, change: 1, open: 99, high: 101, low: 98, prevClose: 99, volume: 1e6, avgVolume: 3e6, relativeVolume: 0.28,
  high52w: 150, low52w: 50, name: "Apple", gapPct: -0.5, atr: 2,
};
const lq = (over: Partial<LayerQuote> = {}): LayerQuote => ({ price: 100, today: 1, fromOpen: 0.5, premarket: 1.2, afterHours: null, gap: 0.8, rvol: 0.77, float: 1e9, ...over });
const res = (session: LayerResponse["session"], quotes: Record<string, LayerQuote>): LayerResponse => ({ session, asOf: "", quotes });

describe("overlayLayer — the watchlist on the common quote layer", () => {
  it("in the session: gap and time-of-day RVOL from the layer, the rest of the quote kept, premarket shown", () => {
    const q = overlayLayer({ AAPL: base }, res("rth", { AAPL: lq() })).AAPL!;
    expect(q).toMatchObject({ gapPct: 0.8, relativeVolume: 0.77, premarketPct: 1.2, atr: 2, prevClose: 99, change: 1 });
  });

  it("before the open the gap is the premarket move — never yesterday's gap", () => {
    expect(overlayLayer({ AAPL: base }, res("pre", { AAPL: lq({ gap: null, premarket: 3.4 }) })).AAPL!.gapPct).toBe(3.4);
    expect(overlayLayer({ AAPL: base }, res("pre", { AAPL: lq({ gap: null, premarket: null }) })).AAPL!.gapPct).toBeNull();
  });

  it("missing layer values keep the page's own; a ticker only the layer has gets a short quote; no layer = as is", () => {
    expect(overlayLayer({ AAPL: base }, res("rth", { AAPL: lq({ gap: null, rvol: null }) })).AAPL).toMatchObject({ gapPct: -0.5, relativeVolume: 0.28 });
    expect(overlayLayer({}, res("rth", { MU: lq({ price: 90, today: -2 }) })).MU).toMatchObject({ price: 90, change: -2, gapPct: 0.8, atr: null });
    const same = { AAPL: base };
    expect(overlayLayer(same, null)).toBe(same);
  });
});
