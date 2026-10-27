import { describe, expect, it } from "vitest";
import { computeHonesty } from "../whatIfHonesty";
import { mixedTrades } from "./whatIfFixtures";
import { plant } from "./whatIfHonestyFixtures";

describe("honest path performance", () => {
  it("1,000 trades (1 trader, 250 days, every field populated), full settings (600 replicates, 200 permutations) < 8 s", () => {
    const trades = plant(mixedTrades({ traders: 1, days: 250, perDay: 4, seed: 41 }), { seed: 42, ticker: "BAD" });
    expect(trades).toHaveLength(1000);
    const t0 = performance.now();
    const r = computeHonesty(trades);
    const ms = performance.now() - t0;
    console.log(`[whatIfHonestyPerf] 1000 trades: ${Math.round(ms)} ms, ${r.tested} slots (${r.testedOrdering} ordering), ${r.months} months`);
    expect(r.tested).toBeGreaterThan(40);
    expect(r.wfAvailable).toBe(true);
    expect(ms).toBeLessThan(8000);
  });
});
