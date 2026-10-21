import { describe, expect, it } from "vitest";
import { cardFacts } from "./card-model";
import type { Quote } from "./lib";

const quote = (over: Partial<Quote> = {}): Quote => ({
  price: 50, change: 2.5, open: 49, high: 51, low: 48, prevClose: 48.8, volume: 1e6, avgVolume: 5e5, relativeVolume: 2,
  high52w: 60, low52w: 20, name: "X", gapPct: -3.4, atr: 2, ...over,
});

describe("watchlist phone card (2.11)", () => {
  it("price, day %, gap / rVol highlighted on the table's thresholds, ATR as % of the price", () => {
    const f = cardFacts(quote());
    expect(f).toMatchObject({ price: 50, change: 2.5, gap: { value: -3.4, strong: true }, rvol: { value: 2, strong: true }, atrPct: { value: 4, strong: false } });
    const calm = cardFacts(quote({ gapPct: 1, relativeVolume: 1.2 }));
    expect([calm.gap.strong, calm.rvol.strong]).toEqual([false, false]);
  });
  it("no quote yet → dashes (nulls), nothing highlighted", () => {
    expect(cardFacts(undefined)).toEqual({
      price: null, change: null, gap: { value: null, strong: false }, rvol: { value: null, strong: false }, atrPct: { value: null, strong: false },
    });
    expect(cardFacts(quote({ price: 0 })).atrPct.value).toBeNull();
  });
});
