import { describe, expect, it } from "vitest";
import { leadershipCard } from "./card-model";
import type { Big7Row } from "./context";

const row = (over: Partial<Big7Row> = {}): Big7Row => ({
  symbol: "NVDA", price: 120, pdc: 118, chg: 1.7, gap: 0.8, pmChg: 1.1, rsQqq: 0.9, rs30: 0.1, rvol: 1.8, vwap: 119.5, vwapDist: 0.42,
  atr: 4, atrUsed: 60, corr: 0.8, beta: 1.4, rs5: 0.2, levels: [], above: null, below: null, spark: [], wQqq: 8, wSpy: 6,
  contribQqq: 0.14, contribSpy: 0.1, ...over,
});

describe("Big 7 leadership phone card (2.11)", () => {
  it("after the open: gap, RVOL highlighted from 1.5×, distance from VWAP", () => {
    expect(leadershipCard(row(), false)).toEqual({ symbol: "NVDA", chg: 1.7, rs: 0.9, gapLabel: "gap", gap: 0.8, rvol: 1.8, rvolStrong: true, vwap: 0.42 });
  });
  it("before the open: the premarket move (else the gap), no VWAP", () => {
    expect(leadershipCard(row(), true)).toMatchObject({ gapLabel: "premarket", gap: 1.1, vwap: null });
    expect(leadershipCard(row({ pmChg: null }), true).gap).toBe(0.8);
    expect(leadershipCard(row({ rvol: 1.2 }), false).rvolStrong).toBe(false);
  });
});
