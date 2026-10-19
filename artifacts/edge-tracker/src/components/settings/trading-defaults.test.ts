import { describe, expect, it } from "vitest";
import { deskPrefill } from "./trading-defaults";

describe("trading defaults: desk prefill (MAKSIM-26)", () => {
  const desk = { accountSize: 50_000, maxRiskPerTrade: 200 };
  it("never-saved defaults take the desk capital and 1R in $", () => {
    expect(deskPrefill({ updatedAt: null }, desk)).toEqual({ accountSize: 50_000, riskUsd: 200, riskMode: "usd" });
  });
  it("own saved defaults and missing limits are left alone", () => {
    expect(deskPrefill({ updatedAt: "2026-10-18T10:00:00Z" }, desk)).toBeNull();
    expect(deskPrefill({ updatedAt: null }, null)).toBeNull();
    expect(deskPrefill({ updatedAt: null }, { accountSize: null, maxRiskPerTrade: null })).toBeNull();
    expect(deskPrefill({ updatedAt: null }, { accountSize: 30_000, maxRiskPerTrade: null })).toEqual({ accountSize: 30_000 });
  });
});
