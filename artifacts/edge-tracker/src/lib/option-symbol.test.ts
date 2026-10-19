import { describe, expect, it } from "vitest";
import { displayTicker, isOptionSymbol, parseOptionSymbol } from "./option-symbol";

describe("option symbols (OCC)", () => {
  it("parses root, expiry, right and strike", () => {
    expect(parseOptionSymbol("META261016P00725000")).toEqual({ root: "META", expiry: "2026-10-16", right: "P", strike: 725 });
    expect(parseOptionSymbol("AMZN261023C00255000")?.strike).toBe(255);
    expect(parseOptionSymbol("SPY261016C00672500")?.strike).toBe(672.5);
  });
  it("stock tickers are not options", () => {
    for (const s of ["META", "BRK.B", "AAPL", "", "NVDA2"]) expect(isOptionSymbol(s)).toBe(false);
  });
  it("displays a readable name; the year only when it is not the current one", () => {
    expect(displayTicker("META261016P00725000", 2026)).toBe("META 725P 16.10");
    expect(displayTicker("SPY251219C00672500", 2026)).toBe("SPY 672.5C 19.12.25");
    expect(displayTicker("AAPL", 2026)).toBe("AAPL");
  });
});
