import { describe, expect, it } from "vitest";
import type { FactorResult } from "./api";
import { factorVerdict, kmDays } from "./model";

const group = { juniors: 8, reached: 6, reachedShare: 0.75, medianCost: 900, medianDays: 30 };
const factor = (over: Partial<FactorResult>): FactorResult => ({
  factor: "trainer", threshold: 4, yes: group, no: group, excluded: 0,
  costDiff: { point: -1200, lo: -1800, hi: -400 }, daysDiff: { point: -15, lo: -25, hi: -2 }, q: 0.04, status: "reliable", verdict: "pays", ...over,
});

describe("junior cost view model", () => {
  it("«что окупается» names the price and the days, and never a verdict on a small sample", () => {
    const text = factorVerdict(factor({}));
    expect(text).toContain("$1,200");
    expect(text).toContain("15");
    expect(factorVerdict(factor({ status: "low" }))).not.toContain("$");
  });

  it("an undefined Kaplan–Meier median reads as «more than N days»", () => {
    expect(kmDays({ medianDays: 12, maxTenure: 40 })).toContain("12");
    expect(kmDays({ medianDays: null, maxTenure: 40 })).toContain("40");
  });
});
