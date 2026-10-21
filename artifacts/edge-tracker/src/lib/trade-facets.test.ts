import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import {
  EMPTY_FACET_VIEW, FACET_DIMS, FACET_GROUPS, activeCount, facetQuery, imxLineOf, isChecked, normalizeFacetView, resetFacets,
  setColumn, timeBucketOfSec, toggleKey, tradeFacetKeys, tradePassesFacets, uncheckedChips, type FacetView, type FacetsResponse,
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
      seq: ["unknown"], prev: ["unknown"], entry: ["unknown"], exit: ["unknown"], hold: ["unknown"], tickers: ["AAPL"],
      price: ["unknown"], size: ["unknown"], accounts: ["manual"], result: ["win"], adds: ["unknown"], stop: ["unknown"], sizeRel: ["unknown"],
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

  it("keys of the derived columns (when / how / what / result)", () => {
    const t = trade({
      ticker: " tsla ", entry: 250, pnl: 10, fees: 10, brokerAccount: "ACC1", holdSec: 600, overnight: false,
      entryKind: "scaled", exitKind: "stopped", notional: 125_000, daySeq: 4, prevKind: "after-loss",
    });
    expect(tradeFacetKeys(t, DESK)).toMatchObject({
      seq: ["4-5"], prev: ["after-loss"], entry: ["scaled"], exit: ["stopped"], hold: ["5-15m"], tickers: ["TSLA"],
      price: ["gt200"], size: ["gt100k"], accounts: ["ACC1"], result: ["be"],
    });
    expect(tradeFacetKeys(trade({ holdSec: 30, overnight: true, pnl: -1, daySeq: 1 }), DESK))
      .toMatchObject({ hold: ["overnight"], result: ["loss"], seq: ["1"] });
    expect(tradeFacetKeys(trade({ pnl: null, ticker: "" }), DESK)).toMatchObject({ result: ["unknown"], tickers: ["unknown"] });
  });

  it("passes the new columns: one excluded bucket drops the trade", () => {
    const t = trade({ ticker: "TSLA", daySeq: 1, prevKind: "first", brokerAccount: null, holdSec: 30, entry: 4, notional: 400 });
    const off = (o: FacetView["off"]) => ({ off: o, excludeImx: false, open: false });
    expect(tradePassesFacets(t, off({ tickers: ["AAPL"] }), DESK)).toBe(true);
    expect(tradePassesFacets(t, off({ tickers: ["TSLA"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ seq: ["1"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ prev: ["first"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ accounts: ["manual"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ hold: ["lt1m"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ price: ["lt5"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ size: ["lt2k"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ result: ["win"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ result: ["loss", "be"], hold: ["gt4h"], size: ["gt100k"] }), DESK)).toBe(true);
    expect(facetQuery(off({ tickers: ["TSLA", "AAPL"], hold: ["overnight"] }))).toBe("xHold=overnight&xTickers=AAPL%2CTSLA");
  });

  it("v3 columns: entry aggressive / adds / exit flip / stop / size vs usual, from full and lite rows alike", () => {
    const t = trade({ entryKind: "aggressive", addsKind: "pyramid", exitKind: "flip", hasStop: true, sizeRel: 3 });
    expect(tradeFacetKeys(t, DESK)).toMatchObject({ entry: ["aggressive"], adds: ["pyramid"], exit: ["flip"], stop: ["with"], sizeRel: ["x3"] });
    expect(tradeFacetKeys(trade({ hasStop: false, sizeRel: 0.4999, addsKind: null }), DESK)).toMatchObject({ stop: ["none"], sizeRel: ["lt05"], adds: ["unknown"] });
    expect(tradeFacetKeys(trade({ sizeRel: 1.5 }), DESK).sizeRel).toEqual(["x2"]);
    expect(tradeFacetKeys(trade({ sizeRel: 0.5 }), DESK).sizeRel).toEqual(["normal"]);
    expect(tradeFacetKeys(trade(), DESK)).toMatchObject({ stop: ["unknown"], sizeRel: ["unknown"] });
    // a lite row (snapshot cut to openedAt / closedAt) carries the same derived columns
    const lite = trade({ contextSnapshot: { openedAt: "2026-06-10T10:00:00" }, addsKind: "average", hasStop: false, sizeRel: 2 });
    expect(tradeFacetKeys(lite, DESK)).toMatchObject({ adds: ["average"], stop: ["none"], sizeRel: ["x2"] });
    const off = (o: FacetView["off"]) => ({ off: o, excludeImx: false, open: false });
    expect(tradePassesFacets(t, off({ adds: ["pyramid"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ stop: ["with"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ sizeRel: ["x3"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ entry: ["aggressive"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ exit: ["flip"] }), DESK)).toBe(false);
    expect(tradePassesFacets(t, off({ adds: ["average"], stop: ["none"], sizeRel: ["lt05"] }), DESK)).toBe(true);
    expect(facetQuery(off({ adds: ["mixed"], sizeRel: ["x2"], stop: ["none"] }))).toBe("xAdds=mixed&xStop=none&xSizeRel=x2");
  });

  it("groups cover every column once, in FACET_DIMS order", () => {
    expect(FACET_GROUPS.flatMap((g) => g.dims)).toEqual([...FACET_DIMS]);
  });

  it("IMX line over raw trades", () => {
    const list = [trade({ pnl: 50 }), trade({ strategy: "Day", isImx: false, pnl: 10 }), trade({ isImx: undefined, pnl: -20.004 })];
    expect(imxLineOf(list, (t) => t.pnl ?? null)).toEqual({ count: 2, net: 30 });
  });
});
