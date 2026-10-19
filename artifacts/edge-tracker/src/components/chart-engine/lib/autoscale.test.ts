import { describe, expect, it } from "vitest";
import { robustPriceRange } from "./autoscale";
import type { Candle } from "../types";

const bar = (i: number, c: number, p: Partial<Candle> = {}): Candle => ({ t: 1_000_000 + i * 60, o: c - 0.05, h: c + 0.1, l: c - 0.1, c, v: 1000, ...p });

describe("autoscale without bad prints (MAKSIM-19)", () => {
  const day = Array.from({ length: 60 }, (_, i) => bar(i, 700 + i * 0.05));
  it("a single spike wick (after-hours print at $615) does not stretch the scale", () => {
    const bars = [...day];
    bars[20] = { ...bars[20], l: 615 };
    bars[40] = { ...bars[40], h: 697 + 80 };
    const r = robustPriceRange(bars, 0, bars.length - 1)!;
    expect(r.min).toBeGreaterThan(699);
    expect(r.max).toBeLessThan(704);
  });
  it("a whole bar printed far away is left out; a normal trend keeps its full range", () => {
    const bars = [...day];
    bars[30] = bar(30, 615);
    expect(robustPriceRange(bars, 0, 59)!.min).toBeGreaterThan(699);
    const trend = Array.from({ length: 60 }, (_, i) => bar(i, 100 + i));
    expect(robustPriceRange(trend, 0, 59)).toEqual({ min: 99.9, max: 159.1 });
  });
  it("few bars or an empty view: plain min / max or null", () => {
    expect(robustPriceRange([bar(0, 10), bar(1, 50)], 0, 1)).toEqual({ min: 9.9, max: 50.1 });
    expect(robustPriceRange([], 0, 10)).toBeNull();
  });
});
