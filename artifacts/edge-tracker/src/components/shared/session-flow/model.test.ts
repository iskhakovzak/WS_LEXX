import { describe, expect, it } from "vitest";
import { reentryInsight, robustEdge, type ReentryRow } from "./model";

describe("robustEdge (same rule as the api's lib/sessionFlow/flow)", () => {
  it("net without the top 3, median, top-3 share and the outlier flag", () => {
    expect(robustEdge([500, 300, 200, -50, -40, -30, -20, 10])).toEqual({ n: 8, net: 870, netExTop3: -130, median: -5, top3Share: 1.15, outliers: true });
    expect(robustEdge([40, 35, 30, 30, 25, 20, -10, -15])).toMatchObject({ netExTop3: 50, outliers: false });
    expect(robustEdge([])).toMatchObject({ n: 0, net: 0, median: null, outliers: false });
  });
});

describe("reentryInsight", () => {
  const row = (bucket: ReentryRow["bucket"], n: number, net: number): ReentryRow => ({
    bucket, n, net, wins: 0, losses: 0, winrate: null, expectancy: null, avgWin: null, avgLoss: null, payoff: null, profitFactor: null, best: null, worst: null,
  });
  it("picks the costliest re-entry bucket with enough trades, never the first entry", () => {
    expect(reentryInsight([row("1", 40, -900), row("2", 10, -120), row("3", 5, -300), row("4+", 2, -800)])?.bucket).toBe("3");
    expect(reentryInsight([row("1", 40, 900), row("2", 10, 50)])).toBeNull();
  });
});
