/**
 * lib/offeringsScore — a rejected offer price (outside −70 %…+25 % of the last close) moves neither rating nor risk
 * (item 1.14, audit market.md: INLF «−84 % к офферу»). Pure: no DB, no network.
 */
import { describe, expect, it } from "vitest";
import { applyOfferPriceCheck, byRiskThenRating, changeVsOffer, finalize, offerDiscount } from "../offeringsScore";
import type { Offering, OfferingBase } from "../offeringsTypes";

function base(over: Partial<OfferingBase> = {}): OfferingBase {
  return {
    ticker: "INLF", company: "INLF Inc", type: "Follow-on", date: "2026-10-19",
    offerPrice: 10, currentPrice: 1.6, priceChangePct: changeVsOffer(1.6, 10),
    dealSizeM: 5, sharesOffered: 500_000, sharesOutstandingBefore: null, sharesOutstandingAfter: null, dilutionPct: null,
    sellerType: "company", insiderShares: null, companyShares: null, underwriter: null, lockupDays: null,
    volume: null, avgVolume: null, relVol: null, marketCapM: 40, sector: null,
    status: "trading", source: "edgar", kind: "424B", form: "424B5", filingUrl: null, cik: null, exchange: null,
    priceRange: null, shelfCapacityM: null, babyShelf: false, babyShelfLimitM: null, offerPctOfMcap: null, dealFlags: [],
    ...over,
  };
}
const keys = (o: Offering) => [...(o.ratingFactorItems ?? []), ...(o.riskFactorItems ?? [])].map((f) => f.k);

describe("offerDiscount", () => {
  it("inside −70 %…+25 % → discount, not suspect", () => {
    expect(offerDiscount(9, 10)).toEqual({ discountPct: -10, suspect: false });
    expect(offerDiscount(12.5, 10)).toEqual({ discountPct: 25, suspect: false });
  });
  it("outside the window → rejected (suspect), no discount", () => {
    expect(offerDiscount(10, 1.7)).toEqual({ discountPct: null, suspect: true });
    expect(offerDiscount(2, 10)).toEqual({ discountPct: null, suspect: true });
  });
  it("no offer price or no close → cannot judge", () => {
    expect(offerDiscount(null, 10).suspect).toBeNull();
    expect(offerDiscount(10, null).suspect).toBeNull();
  });
});

describe("applyOfferPriceCheck", () => {
  it("rejected price: priceChangePct → null, marked suspect, rating / risk recomputed without «к офферу»", () => {
    const o: Offering = { ...finalize(base()), prevClose: 1.7 };
    expect(o.priceChangePct).toBeCloseTo(-84, 0);
    expect(keys(o)).toEqual(expect.arrayContaining(["rating.farBelow", "risk.broken"]));

    expect(applyOfferPriceCheck(o, finalize)).toBe(true);
    const clean = finalize(base({ priceChangePct: null }));
    expect(o.offerPriceSuspect).toBe(true);
    expect(o.priceChangePct).toBeNull();
    expect(o.discountPct).toBeNull();
    expect(o.rating).toBe(clean.rating);
    expect(o.dilutionRisk).toBe(clean.dilutionRisk);
    expect(keys(o)).not.toContain("rating.farBelow");
    expect(keys(o)).not.toContain("risk.broken");
  });

  it("accepted price: only discountPct is set, scores untouched", () => {
    const o: Offering = { ...finalize(base({ offerPrice: 1.5, priceChangePct: changeVsOffer(1.6, 1.5) })), prevClose: 1.7 };
    const before = { rating: o.rating, risk: o.dilutionRisk };
    expect(applyOfferPriceCheck(o, finalize)).toBe(false);
    expect(o.discountPct).toBeCloseTo(-11.76, 2);
    expect(o.offerPriceSuspect).toBeUndefined();
    expect({ rating: o.rating, risk: o.dilutionRisk }).toEqual(before);
  });

  it("a later check with a sane close undoes the rejection", () => {
    const o: Offering = { ...finalize(base()), prevClose: 1.7 };
    applyOfferPriceCheck(o, finalize);
    o.prevClose = 11;
    expect(applyOfferPriceCheck(o, finalize)).toBe(true);
    expect(o.offerPriceSuspect).toBeUndefined();
    expect(o.priceChangePct).toBeCloseTo(-84, 0);
    expect(keys(o)).toContain("rating.farBelow");
  });

  it("no close (cannot judge) keeps the previous verdict", () => {
    const o: Offering = { ...finalize(base()), prevClose: 1.7 };
    applyOfferPriceCheck(o, finalize);
    o.prevClose = null;
    expect(applyOfferPriceCheck(o, finalize)).toBe(false);
    expect(o.offerPriceSuspect).toBe(true);
  });
});

describe("byRiskThenRating", () => {
  it("risk first, then rating", () => {
    const rows = [{ dilutionRisk: 30, rating: 90 }, { dilutionRisk: 70, rating: 10 }, { dilutionRisk: 30, rating: 95 }];
    expect(rows.sort(byRiskThenRating)).toEqual([{ dilutionRisk: 70, rating: 10 }, { dilutionRisk: 30, rating: 95 }, { dilutionRisk: 30, rating: 90 }]);
  });
});
