import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import {
  EMPTY_FACET_VIEW, activeCount, facetQuery, imxLineOf, isChecked, normalizeFacetView, resetFacets, setColumn, timeBucketOfSec,
  toggleKey, tradeFacetKeys, tradePassesFacets, uncheckedChips, type FacetsResponse,
} from "./trade-facets";

const DESK = ["IMX", "FOMO"];
const trade = (over: Partial<Trade> = {}): Trade => ({
  id: 1, ticker: "AAPL", date: "2026-06-10", result: "win", createdAt: "2026-06-10T20:00:00Z", side: "Long", tags: "ORB, IMX",
  strategy: "MOC", isImx: true, entrySec: 14 * 3600, pnl: 50, ...over,
} as Trade);

describe("facet view model", () => {
  it("everything checked by default; toggle / all / none / reset", () => {
    let v = EMPTY_FACET_VIEW;
    expect(isChecked(v, "years", "2026")).toBe(true);
    v = toggleKey(v, "years", "2026");
    expect(isChecked(v, "years", "2026")).toBe(false);
    expect(activeCount(v)).toBe(1);
    v = setColumn(v, "strategies", ["MOC", "Day"], false);
    expect(v.off.strategies).toEqual(["MOC", "Day"]);
    v = setColumn(v, "strategies", ["MOC", "Day"], true);
    expect(v.off.strategies).toBeUndefined();
    v = toggleKey(v, "years", "2026");
    expect(v.off).toEqual({});
    expect(resetFacets({ off: { days: ["1"] }, excludeImx: true, open: true })).toEqual({ off: {}, excludeImx: true, open: true });
  });

  it("query string is stable and carries excludeImx", () => {
    expect(facetQuery(EMPTY_FACET_VIEW)).toBe("");
    expect(facetQuery({ off: { years: ["2026", "2024"], gtags: ["__none__"] }, excludeImx: true, open: false }))
      .toBe("xYears=2024%2C2026&xGtags=__none__&excludeImx=1");
  });

  it("normalizes a stored view", () => {
    expect(normalizeFacetView({ off: { years: ["2025", 3, "2025", ""], bogus: ["x"] }, excludeImx: true, open: "yes" }))
      .toEqual({ off: { years: ["2025"] }, excludeImx: true, open: false });
    expect(normalizeFacetView(null)).toEqual(EMPTY_FACET_VIEW);
  });

  it("chips label hidden values from the last answer", () => {
    const data = { dims: { months: [{ key: "6", label: "Jun", count: 1, net: 1 }] } } as unknown as FacetsResponse;
    expect(uncheckedChips({ off: { months: ["6", "7"] }, excludeImx: false, open: false }, data))
      .toEqual([{ dim: "months", key: "6", label: "Jun" }, { dim: "months", key: "7", label: "7" }]);
  });
});

describe("raw trades (the own /stats book)", () => {
  it("keys per column, same rules as the server", () => {
    expect(tradeFacetKeys(trade(), DESK)).toEqual({
      years: ["2026"], months: ["6"], days: ["3"], times: ["13:30-15:30"], strategies: ["MOC"], types: ["long"],
      gtags: ["IMX"], ptags: ["ORB"],
    });
    const k = tradeFacetKeys(trade({ date: "2026-06-14", tags: null, strategy: null, side: null, entrySec: null }), DESK);
    expect(k).toMatchObject({ days: ["7"], gtags: ["__none__"], ptags: ["__none__"], strategies: ["unknown"], types: ["unknown"], times: ["unknown"] });
  });

  it("time buckets", () => {
    expect(timeBucketOfSec(8 * 3600 + 29 * 60)).toBe("before-8:30");
    expect(timeBucketOfSec(9 * 3600 + 30 * 60)).toBe("9:30-9:50");
    expect(timeBucketOfSec(16 * 3600)).toBe("after-16:00");
    expect(timeBucketOfSec(null)).toBe("unknown");
  });

  it("passes the selection: scalar columns, tag columns (any tag left checked), «Исключить IMX»", () => {
    const t = trade();
    expect(tradePassesFacets(t, EMPTY_FACET_VIEW, DESK)).toBe(true);
    expect(tradePassesFacets(t, { off: { years: ["2026"] }, excludeImx: false, open: false }, DESK)).toBe(false);
    expect(tradePassesFacets(t, { off: { ptags: ["ORB"] }, excludeImx: false, open: false }, DESK)).toBe(false);
    expect(tradePassesFacets(trade({ tags: "ORB, A+" }), { off: { ptags: ["ORB"] }, excludeImx: false, open: false }, DESK)).toBe(true);
    expect(tradePassesFacets(t, { off: {}, excludeImx: true, open: false }, DESK)).toBe(false);
    expect(tradePassesFacets(trade({ strategy: "Day", isImx: false, tags: "ORB" }), { off: {}, excludeImx: true, open: false }, DESK)).toBe(true);
  });

  it("IMX line over raw trades", () => {
    const list = [trade({ pnl: 50 }), trade({ strategy: "Day", isImx: false, pnl: 10 }), trade({ isImx: undefined, pnl: -20.004 })];
    expect(imxLineOf(list, (t) => t.pnl ?? null)).toEqual({ count: 2, net: 30 });
  });
});
