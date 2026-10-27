import { describe, expect, it } from "vitest";
import { findSuggestions } from "../whatIfSuggest";
import { mixedTrades } from "./whatIfFixtures";

/** Wall time of the whole suggestion search (grid → fast path → max-t → selection → finalists). */
function timed(trades: ReturnType<typeof mixedTrades>, team: boolean): number {
  const t0 = performance.now();
  const r = findSuggestions(trades, { team });
  const ms = performance.now() - t0;
  expect(r.tested).toBeGreaterThan(40);
  return ms;
}

describe("suggestion search performance", () => {
  it("1,000 trades (2 traders, 120 days, every field populated) < 1.5 s", () => {
    const trades = mixedTrades({ traders: 2, days: 120, perDay: 5, seed: 31 }).filter((_, i) => i % 6 !== 5);
    expect(trades).toHaveLength(1000);
    const ms = timed(trades, false);
    console.log(`[whatIfPerf] 1000 trades: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(1500);
  });

  it("20,000 trades (10 traders, 250 days, desk-wide) < 6 s", () => {
    const trades = mixedTrades({ traders: 10, days: 250, perDay: 8, seed: 32 });
    expect(trades).toHaveLength(20_000);
    const ms = timed(trades, true);
    console.log(`[whatIfPerf] 20000 trades: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(6000);
  });
});
