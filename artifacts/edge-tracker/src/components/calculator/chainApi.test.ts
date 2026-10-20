/** components/calculator/chainApi — strike ladder window, strike search, derived IV / greeks, AI payload, answer parsing. */
import { describe, expect, it } from "vitest";
import { chainOf, compactForAi, ladderWindow, nearestIndex, parseStrikeQuery, withDerivedGreeks, type ChainResponse } from "./chainApi";
import type { ChainData, ChainOption } from "./strategies";

const strikes = Array.from({ length: 41 }, (_, i) => 200 + i * 2.5); // 200 … 300

function opt(strike: number, mid: number, over: Partial<ChainOption> = {}): ChainOption {
  return {
    contractSymbol: `X${strike}`, strike, bid: mid - 0.05, ask: mid + 0.05, last: mid, mid, iv: null, volume: 10, openInterest: 100,
    inTheMoney: false, change: 0, changePct: 0, greeks: null, ...over,
  };
}

describe("ladderWindow / nearestIndex / parseStrikeQuery", () => {
  it("±radius strikes around the one nearest to the centre, with the hidden counts", () => {
    const w = ladderWindow(strikes, 258.45, 10);
    expect(w.rows).toHaveLength(21);
    expect(w.rows[10]).toBe(257.5);
    expect(w.hiddenBelow).toBe(13);
    expect(w.hiddenAbove).toBe(7);
  });

  it("clamps at the ends; empty list → nothing", () => {
    const w = ladderWindow(strikes, 205, 10);
    expect(w.rows[0]).toBe(200);
    expect(w.hiddenBelow).toBe(0);
    expect(w.rows).toHaveLength(13);
    expect(ladderWindow([], 100, 10)).toEqual({ rows: [], hiddenBelow: 0, hiddenAbove: 0 });
    expect(nearestIndex([], 1)).toBe(-1);
  });

  it("strike search accepts $ / decimal comma / spaces; junk → null", () => {
    expect(parseStrikeQuery("$262,5")).toBe(262.5);
    expect(parseStrikeQuery(" 250 ")).toBe(250);
    expect(parseStrikeQuery("")).toBeNull();
    expect(parseStrikeQuery("abc")).toBeNull();
    expect(strikes[nearestIndex(strikes, 263)]).toBe(262.5);
  });
});

describe("withDerivedGreeks", () => {
  const base: ChainData = {
    symbol: "AAPL", spot: 100, change: null, changePct: null, name: "AAPL", expirationDate: 0, daysToExpiry: 30,
    calls: [opt(100, 3.6), opt(105, 1.6, { iv: 31, greeks: { delta: 0.3, gamma: 0.05, theta: -0.04, vega: 0.1 } })],
    puts: [opt(100, 3.2), opt(60, 0)],
    strikes: [60, 100, 105],
  };

  it("keeps what the feed sent, derives IV + Δ for the rest, leaves unpriceable rows empty", () => {
    const c = withDerivedGreeks(base, 4.5);
    expect(c.calls[1].greeks?.delta).toBe(0.3);
    expect(c.calls[0].iv).toBeGreaterThan(20);
    expect(c.calls[0].greeks!.delta).toBeGreaterThan(0.45);
    expect(c.puts[0].greeks!.delta).toBeLessThan(0);
    expect(c.puts[1].iv).toBeNull();
    expect(c.puts[1].greeks).toBeNull();
  });

  it("compactForAi keeps ATM ±radius strikes only", () => {
    const big: ChainData = { ...base, spot: 250, strikes, calls: strikes.map((k) => opt(k, 1)), puts: strikes.map((k) => opt(k, 1)) };
    const c = compactForAi(big, 15);
    expect(c.strikes).toHaveLength(31);
    expect(c.calls).toHaveLength(31);
    expect(c.strikes[15]).toBe(250);
  });
});

describe("chainOf", () => {
  const r: ChainResponse = { symbol: "AAPL", name: "Apple", spot: 258.45, change: 3.12, changePct: 1.22, source: "yahoo", delayMinutes: 15, expirations: [] };
  it("expirations-only answer → null; with chain fields → ChainData", () => {
    expect(chainOf(r)).toBeNull();
    const c = chainOf({ ...r, expiration: "2026-10-23", expirationDate: 1, daysToExpiry: 2, calls: [], puts: [], strikes: [] });
    expect(c).toMatchObject({ symbol: "AAPL", spot: 258.45, daysToExpiry: 2, name: "Apple" });
  });
});
