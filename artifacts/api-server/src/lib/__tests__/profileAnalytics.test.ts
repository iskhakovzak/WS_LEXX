/**
 * lib/profile/analytics — key stats, equity, slices, style fingerprint, clean streak and the closest style peer.
 */
import { describe, expect, it } from "vitest";
import { cleanStreakOf, closestPeer, equityOf, holdBucket, keyStatsOf, priceBucket, recentDays, slicesBy, styleOf, windowOf } from "../profile/analytics";
import { daysOf } from "../profile/attributes";
import type { ProfileTrade } from "../profile/types";

const t = (day: string, net: number, over: Partial<ProfileTrade> = {}): ProfileTrade => ({
  day, seq: 34200, net, result: net > 0 ? "win" : net < 0 ? "loss" : "be", side: "long", horizon: "intraday",
  holdSec: 120, entrySec: 34200, ticker: "AAA", setup: null, price: 30, ...over,
});

describe("keyStatsOf / equityOf", () => {
  it("net, win rate (BE excluded), PF, expectancy, averages, drawdown", () => {
    const trades = [t("2026-01-05", 30), t("2026-01-05", -10), t("2026-01-06", 0), t("2026-01-07", -40), t("2026-01-08", 20)];
    const s = keyStatsOf(trades, daysOf(trades));
    expect(s).toMatchObject({ net: 0, trades: 5, wins: 2, losses: 2, winRate: 0.5, profitFactor: 1, expectancy: 0, avgWin: 25, avgLoss: -25, activeDays: 4, greenDays: 2, bestDay: 20, worstDay: -40, maxDrawdown: 40 });
  });
  it("empty book: nulls, not zeros, where there is nothing to divide", () => {
    const s = keyStatsOf([], []);
    expect(s).toMatchObject({ trades: 0, winRate: null, profitFactor: null, expectancy: null, bestDay: null, maxDrawdown: 0 });
  });
  it("equity is the running sum by day", () => {
    expect(equityOf(daysOf([t("2026-01-06", -5), t("2026-01-05", 10)]))).toEqual([{ day: "2026-01-05", net: 10, cum: 10 }, { day: "2026-01-06", net: -5, cum: 5 }]);
  });
});

describe("slices", () => {
  it("best positive and worst negative slices with a minimum size", () => {
    const trades = [
      ...Array(4).fill(0).map(() => t("2026-01-05", 10, { ticker: "WIN" })),
      ...Array(4).fill(0).map(() => t("2026-01-05", -10, { ticker: "LOSE" })),
      t("2026-01-05", 500, { ticker: "ONE" }),
    ];
    const s = slicesBy(trades, (x) => x.ticker);
    expect(s.best).toEqual([{ key: "WIN", n: 4, net: 40, winRate: 1 }]);
    expect(s.worst).toEqual([{ key: "LOSE", n: 4, net: -40, winRate: 0 }]);
  });
  it("half-hour windows in NY time", () => {
    expect(windowOf(34200)).toBe("09:30");
    expect(windowOf(35999)).toBe("09:30");
    expect(windowOf(36000)).toBe("10:00");
    expect(windowOf(null)).toBeNull();
  });
});

describe("style", () => {
  it("buckets", () => {
    expect(priceBucket(3)).toBe("lt5");
    expect(priceBucket(150)).toBe("gt100");
    expect(priceBucket(null)).toBeNull();
    expect(holdBucket({ holdSec: 30, horizon: "intraday" })).toBe("lt1m");
    expect(holdBucket({ holdSec: 4000, horizon: "intraday" })).toBe("30mto2h");
    expect(holdBucket({ holdSec: 30, horizon: "swing" })).toBe("multiday");
  });
  it("shares sum to 1 per group; median hold over intraday trades", () => {
    const s = styleOf([t("2026-01-05", 1, { side: "short", price: 3 }), t("2026-01-05", 1, { holdSec: 600 }), t("2026-01-06", 1, { horizon: "swing", price: 200 })]);
    expect(s.horizon).toEqual({ intraday: 0.6667, overnight: 0, swing: 0.3333 });
    expect(s.side).toEqual({ long: 0.6667, short: 0.3333 });
    expect(s.price.lt5 + s.price["20to100"] + s.price.gt100).toBeCloseTo(1, 3);
    expect(s.medianHoldSec).toBe(360);
    expect(s.tradesPerDay).toBe(1.5);
  });
  it("closest peer by style; none below the trade minimum", () => {
    const scalp = (n: number, hold: number, price = 30) => styleOf(Array.from({ length: n }, (_, i) => t(`2026-01-${String((i % 20) + 1).padStart(2, "0")}`, 1, { holdSec: hold, price })));
    const me = scalp(40, 30);
    const peer = closestPeer(me, [{ name: "B", style: scalp(40, 3000, 200) }, { name: "A", style: scalp(40, 40) }, { name: "C", style: scalp(5, 30) }]);
    expect(peer?.name).toBe("A");
    expect(peer!.similarity).toBeGreaterThan(0.9);
    expect(closestPeer(scalp(5, 30), [{ name: "A", style: me }])).toBeNull();
  });
});

describe("clean streak and recent days", () => {
  it("counts trading days without a violation back from the latest", () => {
    const days = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
    expect(cleanStreakOf(days, new Set(["2026-01-06"]))).toEqual({ current: 3, best: 3 });
    expect(cleanStreakOf(days, new Set(["2026-01-09"]))).toEqual({ current: 0, best: 4 });
    expect(cleanStreakOf([], new Set())).toEqual({ current: 0, best: 0 });
  });
  it("recent days keep the last n calendar days", () => {
    const d = daysOf([t("2025-01-02", 5), t("2026-10-20", 7)]);
    expect(recentDays(d, "2026-10-25").map((x) => x.day)).toEqual(["2026-10-20"]);
  });
});
