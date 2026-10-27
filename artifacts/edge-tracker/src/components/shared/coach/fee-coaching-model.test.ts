import { describe, expect, it } from "vitest";
import { bandLabel, feeCardOf, priceRuleHref, type FeeBandRow, type FeeCoaching } from "./fee-coaching-model";

const row = (band: string, p: Partial<FeeBandRow> = {}): FeeBandRow => ({
  band, trades: 40, days: 12, shares: 8000, gross: 200, fees: 100, net: 100, feeShareOfGross: 0.5, fps: 0.0125, gps: 0.025, ratio: 2, gpsHi80: 0.03, flagged: false, ...p,
});
const coaching = (bands: FeeBandRow[], total: Partial<FeeBandRow> = {}): FeeCoaching => ({
  window: { from: "2026-01-02", to: "2026-03-31", days: 55 },
  model: { bands, total: row("all", total), flagged: bands.filter((b) => b.flagged).map((b) => b.band) },
  breakeven: null,
});

describe("fee coaching card", () => {
  it("labels trade-facet price bands", () => {
    expect(bandLabel("lt5")).toBe("< $5");
    expect(bandLabel("10-20")).toBe("$10–20");
    expect(bandLabel("gt200")).toBe("> $200");
  });

  it("names the worst flagged band and the price rule to test", () => {
    const c = feeCardOf(coaching([row("5-10", { flagged: true, ratio: 1.2 }), row("10-20", { flagged: true, ratio: 0.8 }), row("20-50")]))!;
    expect(c.band).toEqual({ key: "10-20", label: "$10–20", ratio: 0.8, loses: true });
    expect(c.minPrice).toBe(20);
    expect(priceRuleHref(20)).toMatch(/^\/what-if\?r=/);
  });

  it("no card when fees are a small share and no band is flagged", () => {
    expect(feeCardOf(coaching([row("20-50")], { feeShareOfGross: 0.1 }))).toBeNull();
    expect(feeCardOf(null)).toBeNull();
  });

  it("a red gross with fees still gets the card (fees bought nothing)", () => {
    const c = feeCardOf(coaching([row("20-50")], { feeShareOfGross: null, gross: -50, fees: 80 }))!;
    expect(c.share).toBeNull();
    expect(c.band).toBeNull();
  });
});
