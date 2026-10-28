import { describe, expect, it } from "vitest";
import { broken, historicalMove, impliedMove, levels, reactionDay } from "../model";
import type { ChainContract } from "../../options/types";

const c = (strike: number, bid: number, ask: number): ChainContract => ({
  contractSymbol: `X${strike}`, strike, bid, ask, last: 0, mid: (bid + ask) / 2, iv: null, volume: 0, openInterest: 0, inTheMoney: false, change: 0, changePct: 0, greeks: null,
});

describe("expected move (feature 5)", () => {
  it("implied = the ATM straddle ÷ spot; historical = the mean |move|; levels and the post-report flag", () => {
    expect(impliedMove({ calls: [c(95, 6, 6.2), c(100, 3, 3.2), c(105, 1, 1.2)], puts: [c(95, 1, 1.1), c(100, 3.4, 3.6), c(105, 6, 6.4)] }, 101)).toBe(6.53);
    expect(impliedMove({ calls: [c(100, 0, 0)], puts: [c(100, 3, 3)] }, 100)).toBeNull();
    expect(historicalMove([-4, 6, -10, 2], 3)).toEqual({ em: 6, quarters: 3 });
    expect(levels(200, 5)).toEqual({ up: 210, down: 190 });
    expect(broken(-7.2, 6)).toBe(true);
    expect(broken(5.9, 6)).toBe(false);
    expect(reactionDay("2026-10-28", "amc", "2026-10-29")).toBe("2026-10-29");
    expect(reactionDay("2026-10-28", "bmo", "2026-10-29")).toBe("2026-10-28");
  });
});
