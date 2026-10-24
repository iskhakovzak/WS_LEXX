import { describe, expect, it } from "vitest";
import { edgeMapRow, fromEdgeMap, type MeRow } from "./api";
import { bestWorst, bucketLabel, changedRows, money, pctOn, rowName, scaleOf, tradesHref, whatIfRule } from "./model";
import { todaySentence } from "./TodayEdgeLine";

const R = (o: Partial<MeRow> & Pick<MeRow, "dim" | "key">): MeRow => ({
  trades: 20, days: 10, net: -200, winRate: 0.4, perDay: { point: -20, lo: -35, hi: -5 }, perTrade: { point: -10, lo: -18, hi: -2 },
  p: 0.01, q: 0.05, status: "reliable", blocks: [{ trades: 6, perTrade: -5, sign: -1 }, { trades: 7, perTrade: -9, sign: -1 }, { trades: 7, perTrade: 2, sign: 1 }],
  persist: 2, outcome: false, ids: [3, 2, 1], idsTruncated: false, ...o,
});

describe("labels", () => {
  it("bucket labels by dimension vocabulary; raw text dims name the dimension in a sentence", () => {
    expect(bucketLabel("seq", "4-5")).toBe("4–5-я сделка");
    expect(bucketLabel("spyTrend", "range")).toBe("боковик");
    expect(bucketLabel("qqqGap", "up")).toBe("гэп вверх");
    expect(bucketLabel("strategy", "Momentum")).toBe("Momentum");
    expect(rowName({ dim: "strategy", key: "Momentum" })).toBe("Стратегия: Momentum");
    expect(rowName({ dim: "setup", key: "none" })).toBe("без сетапа");
    expect(rowName({ dim: "time", key: "9:30-9:50" })).toBe("9:30–9:50 (открытие)");
  });

  it("money: cents below $100, whole dollars above, always signed", () => {
    expect(money(12.5)).toBe("+$12.50");
    expect(money(-1234.4)).toBe("−$1,234");
  });
});

describe("links", () => {
  it("«Сделки»: the exact ids in /trades, list view, staff keep the person", () => {
    expect(tradesHref({ ids: [5, 4] }, { trader: "" })).toBe("/trades?ids=5%2C4&view=list");
    expect(tradesHref({ ids: [5] }, { trader: "Bob" })).toBe("/trades?ids=5&view=list&trader=Bob");
    expect(tradesHref({ ids: [] }, { trader: "" })).toBeNull();
  });

  it("what-if rules only for leaks with a faithful rule", () => {
    expect(whatIfRule(R({ dim: "time", key: "9:30-9:50" }), 100)).toEqual({ type: "timeWindow", from: "09:50", to: null });
    expect(whatIfRule(R({ dim: "time", key: "15:30-16:00" }), 100)).toEqual({ type: "timeWindow", from: null, to: "15:30" });
    expect(whatIfRule(R({ dim: "time", key: "11:15-13:30" }), 100)).toBeNull();
    expect(whatIfRule(R({ dim: "seq", key: "6+" }), 100)).toEqual({ type: "maxTradesPerDay", n: 5 });
    expect(whatIfRule(R({ dim: "prev", key: "after-loss" }), 100)).toEqual({ type: "afterLoss", minutes: 15 });
    expect(whatIfRule(R({ dim: "dayPnl", key: "deepDown" }), 240.4)).toEqual({ type: "dailyLossLimit", usd: 240 });
    expect(whatIfRule(R({ dim: "dayPnl", key: "deepDown" }), null)).toBeNull();
    expect(whatIfRule(R({ dim: "price", key: "lt5" }), 1)).toEqual({ type: "priceRange", min: 5, max: null });
    expect(whatIfRule(R({ dim: "setup", key: "ORB" }), 1)).toEqual({ type: "excludeSetups", setups: ["ORB"] });
    expect(whatIfRule(R({ dim: "side", key: "short" }), 1)).toEqual({ type: "excludeSide", side: "short" });
    expect(whatIfRule(R({ dim: "sizeRel", key: "x3" }), 1)).toEqual({ type: "maxSizeRel", x: 1.5 });
    // strengths, outcomes and dims without a rule
    expect(whatIfRule(R({ dim: "side", key: "short", perDay: { point: 5, lo: 1, hi: 9 } }), 1)).toBeNull();
    expect(whatIfRule(R({ dim: "hold", key: "lt1m", outcome: true }), 1)).toBeNull();
    expect(whatIfRule(R({ dim: "strategy", key: "X" }), 1)).toBeNull();
  });
});

describe("verdict picks and scales", () => {
  it("best / worst of one dimension skip «мало данных»", () => {
    const rows = [
      R({ dim: "spyTrend", key: "trendUp", perDay: { point: 40, lo: 10, hi: 70 } }),
      R({ dim: "spyTrend", key: "range", perDay: { point: -15, lo: -30, hi: 0 } }),
      R({ dim: "spyTrend", key: "trendDown", perDay: { point: -90, lo: -200, hi: 5 }, status: "low" }),
    ];
    const bw = bestWorst(rows, "spyTrend")!;
    expect([bw.best.key, bw.worst.key]).toEqual(["trendUp", "range"]);
    expect(bestWorst(rows.slice(0, 1), "spyTrend")).toBeNull();
  });

  it("scale always holds zero; positions are clamped", () => {
    const s = scaleOf([R({ dim: "a", key: "b", perDay: { point: 5, lo: 2, hi: 8 } })]);
    expect(s).toEqual({ min: 0, max: 8 });
    expect(pctOn(0, s)).toBe(0);
    expect(pctOn(100, s)).toBe(100);
    expect(changedRows([{ metric: "winRate", current: null, previous: null, diff: { point: 0.1, lo: 0.05, hi: 0.2 }, changed: true }])).toHaveLength(1);
  });
});

describe("edge map adapter", () => {
  it("maps tolerant field names and ranks like /my-edge", () => {
    const raw = {
      totals: { trades: 50, days: 20, net: 100 },
      cells: [
        { dimension: "seq", bucket: "6+", n: 20, days: 10, perDay: { mean: -30, lower: -50, upper: -10 }, perTrade: { mean: -15, lower: -25, upper: -5 }, q: 0.04 },
        { dim: "time", key: "9:30-9:50", trades: 25, days: 12, perDay: { point: 20, lo: 5, hi: 35 }, perTrade: { point: 9, lo: 2, hi: 15 }, status: "hypothesis" },
        { dim: "x", key: "y", trades: 3, days: 2, perDay: { point: 1, lo: 0, hi: 2 }, perTrade: { point: 1, lo: 0, hi: 2 } },
        { dim: "broken" },
      ],
    };
    const d = fromEdgeMap(raw, "Ann")!;
    expect(d.source).toBe("edge-map");
    expect(d.rows).toHaveLength(3);
    expect(d.leaks[0]).toMatchObject({ dim: "seq", key: "6+", status: "reliable" });
    expect(d.strengths[0]).toMatchObject({ dim: "time", status: "hypothesis" });
    expect(d.rows.find((r) => r.dim === "x")!.status).toBe("low");
    expect(fromEdgeMap({ nope: 1 }, "Ann")).toBeNull();
    expect(edgeMapRow({ dim: "a", key: "b", trades: 0 })).toBeNull();
  });
});

describe("today sentence", () => {
  it("gap basis, prevVol basis with low data, nothing stored", () => {
    const row = R({ dim: "spyGap", key: "up", perDay: { point: 42, lo: 10, hi: 80 }, days: 14 });
    expect(todaySentence({ trader: "a", today: "2026-10-23", basis: { basis: "gap", dim: "spyGap", key: "up", asOf: "2026-10-23", gapPct: 0.45 }, row, siblings: [], coverage: null }))
      .toBe("SPY сегодня — гэп вверх (+0.45%). В такие дни у вас +$42.00 в день (80 %: +$10.00 … +$80.00, 14 торговых дней).");
    const low = { ...row, status: "low" as const };
    expect(todaySentence({ trader: "a", today: "2026-10-24", basis: { basis: "prevVol", dim: "spyPrevVol", key: "high", asOf: "2026-10-22", rangeAtr: 1.7 }, row: low, siblings: [], coverage: null }))
      .toMatch(/высокая волатильность.*Мало данных/);
    expect(todaySentence({ trader: "a", today: "2026-10-24", basis: { basis: "prevVol", dim: "spyPrevVol", key: "low", asOf: "2026-10-22", rangeAtr: 0.6 }, row: { ...row, status: "hypothesis", perDay: { point: 3, lo: -50, hi: 70 } }, siblings: [], coverage: null }))
      .toMatch(/включает ноль/);
    expect(todaySentence({ trader: "a", today: "2026-10-24", basis: { basis: null, dim: null, key: null, asOf: null }, row: null, siblings: [], coverage: null }))
      .toMatch(/Нет свежих/);
  });
});
