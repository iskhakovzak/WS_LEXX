import { describe, expect, it } from "vitest";
import { candlesWarming } from "../api";

// ROMAN-28: «Свечи есть по 350 из 350 тикеров · догружаются» — the suffix only while some tickers still miss candles.
describe("candlesWarming", () => {
  it("is false once every rated ticker has candles, even if the server still says warming", () => {
    expect(candlesWarming({ tickers: 350, ratedTickers: 350, warming: true })).toBe(false);
    expect(candlesWarming({ tickers: 340, ratedTickers: 350, warming: true })).toBe(true);
    expect(candlesWarming({ tickers: 340, ratedTickers: 350, warming: false })).toBe(false);
    expect(candlesWarming(null)).toBe(false);
  });
});
