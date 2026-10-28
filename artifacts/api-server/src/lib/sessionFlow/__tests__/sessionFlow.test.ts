import { describe, expect, it } from "vitest";
import { chaseIds, dayGiveback, entryNumbers, greenToRed, reentryBreaches, reentryBuckets, robustEdge } from "../flow";
import { offTiming, timingOf } from "../timing";
import { detectRules, type RulesCfg } from "../../leakGuard/rules";
import type { FlowTrade } from "../types";

const DAY = "2026-10-27";
const at = (hh: number, mm: number) => Date.UTC(2026, 9, 27, hh + 4, mm); // EDT: NY = UTC − 4
let seq = 0;
function tr(p: Partial<FlowTrade> & { net: number; in: [number, number]; out: [number, number] }): FlowTrade {
  const { in: i, out: o, ...rest } = p;
  return {
    id: ++seq, trader: "T", day: DAY, ticker: "AAA", side: "long", result: p.net > 0 ? "win" : p.net < 0 ? "loss" : "be",
    entryAt: at(...i), exitAt: at(...o), entrySec: i[0] * 3600 + i[1] * 60, notional: 10_000, exitKind: "whole", strategy: "Day",
    setupId: null, setupName: null, pnl: p.net, fees: 0, ...rest,
  };
}

describe("re-entries (feature 1)", () => {
  it("numbers entries per ticker and side, buckets them 1 / 2 / 3 / 4+ and flags the entry past the max", () => {
    const day = [
      tr({ net: -50, in: [9, 40], out: [9, 45] }), tr({ net: -40, in: [9, 50], out: [9, 55] }), tr({ net: 30, in: [10, 5], out: [10, 10] }),
      tr({ net: -20, in: [10, 20], out: [10, 25] }), tr({ net: 15, in: [10, 30], out: [10, 35], side: "short" }), tr({ net: 5, in: [11, 0], out: [11, 5], ticker: "BBB" }),
    ];
    const n = entryNumbers(day);
    expect(day.map((t) => n.get(t.id))).toEqual([1, 2, 3, 4, 1, 1]);
    const b = reentryBuckets(day);
    expect(b.map((r) => [r.bucket, r.n, r.net])).toEqual([["1", 3, -30], ["2", 1, -40], ["3", 1, 30], ["4+", 1, -20]]);
    expect(b[0]!.winrate).toBeCloseTo(2 / 3, 3);
    const br = reentryBreaches(day, 2);
    expect(br).toEqual([{ ticker: "AAA", side: "long", entries: 4, tradeId: day[2]!.id, at: day[2]!.entryAt }]);
  });

  it("chase: a new entry after a stop in the pre-market / print / after-market of the same ticker", () => {
    const pre = tr({ net: -80, in: [8, 0], out: [8, 30], strategy: "OPG", entrySec: 8 * 3600, exitKind: "stopped" });
    const again = tr({ net: 20, in: [9, 35], out: [9, 50] });
    const other = tr({ net: 10, in: [9, 40], out: [9, 45], ticker: "ZZZ" });
    const dayStop = tr({ net: -30, in: [11, 0], out: [11, 10], ticker: "ZZZ" });
    const afterDayStop = tr({ net: -30, in: [11, 20], out: [11, 30], ticker: "ZZZ" });
    expect([...chaseIds([pre, again, other, dayStop, afterDayStop])]).toEqual([again.id]);
  });

  it("the guard raises one soft re-entry stop per ticker / side, scoped to it, until the close", () => {
    const day = [tr({ net: -10, in: [9, 40], out: [9, 41] }), tr({ net: -10, in: [9, 42], out: [9, 43] }), tr({ net: -10, in: [9, 44], out: [9, 45] })];
    const cfg: RulesCfg = { reentry: true, greenToRed: false, openWindow: false, ideaLimits: false, maxReentries: 2, g2r: { sizeRatio: 1.3, paceRatio: 1.5, minAfter: 2 }, g2rPauseMinutes: 15 };
    const d = detectRules({ trader: "T", day: DAY, now: at(9, 46), closeAt: at(16, 0), today: day, cfg });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ pattern: "reentry", sourceKey: "AAA:long", triggeredAt: day[2]!.entryAt, pauseUntil: at(16, 0), late: false, stale: false });
    expect(d[0]!.stats).toMatchObject({ ticker: "AAA", side: "long", entries: 3, max: 2 });
  });
});

describe("give-back from the peak (feature 2)", () => {
  const cfg = { thresholdStops: 1.5, nearPeakShare: 0.1 };
  it("measures peak − close in daily stops and flags at the threshold", () => {
    const day = [tr({ net: 900, in: [9, 35], out: [9, 50] }), tr({ net: 300, in: [10, 0], out: [10, 30] }), tr({ net: -700, in: [11, 0], out: [11, 20] }), tr({ net: -200, in: [12, 0], out: [12, 5] })];
    const g = dayGiveback(day, 500, cfg)!;
    expect(g).toMatchObject({ peak: 1200, close: 300, giveback: 900, stops: 1.8, unit: "stops", flagged: true });
  });
  it("uses R when there is no daily limit, and never flags a day closed at or near its peak", () => {
    const withR = [tr({ net: 400, in: [9, 35], out: [9, 50], riskUsd: 100 }), tr({ net: -250, in: [10, 0], out: [10, 30], riskUsd: 100 })];
    expect(dayGiveback(withR, null, cfg)).toMatchObject({ giveback: 250, stops: null, r: 2.5, unit: "r", flagged: true });
    const nearPeak = [tr({ net: 1000, in: [9, 35], out: [9, 50] }), tr({ net: -50, in: [10, 0], out: [10, 30] })];
    expect(dayGiveback(nearPeak, 20, cfg)!.flagged).toBe(false);
  });
});

describe("robust edge (feature 3)", () => {
  it("net without the top 3, the median and the top-3 share; flags an edge on outliers", () => {
    expect(robustEdge([500, 300, 200, -50, -40, -30, -20, 10])).toEqual({ n: 8, net: 870, netExTop3: -130, median: -5, top3Share: 1.15, outliers: true });
    const steady = robustEdge([40, 35, 30, 30, 25, 20, -10, -15]);
    expect(steady).toMatchObject({ net: 155, netExTop3: 50, outliers: false });
    expect(robustEdge([-10, -20]).outliers).toBe(false);
  });
});

describe("green to red (feature 4)", () => {
  const cfg = { sizeRatio: 1.3, paceRatio: 1.5, minAfter: 2 };
  it("compares size and pace after the cross with before it", () => {
    const day = [
      tr({ net: 200, in: [9, 30], out: [9, 40], notional: 10_000 }), tr({ net: -350, in: [10, 0], out: [10, 30], notional: 10_000 }),
      tr({ net: -100, in: [10, 35], out: [10, 40], notional: 20_000 }), tr({ net: -100, in: [10, 45], out: [10, 50], notional: 20_000 }),
    ];
    const g = greenToRed(day, cfg)!;
    expect(g).toMatchObject({ crossTradeId: day[1]!.id, peak: 200, sizeRatio: 2, material: true });
    expect(g.before.trades).toBe(2);
    expect(g.after.trades).toBe(2);
  });
  it("is null when the day never went green first, and not material with too few trades after", () => {
    expect(greenToRed([tr({ net: -10, in: [9, 30], out: [9, 40] })], cfg)).toBeNull();
    const one = [tr({ net: 50, in: [9, 30], out: [9, 40] }), tr({ net: -80, in: [9, 45], out: [9, 50] }), tr({ net: -5, in: [9, 55], out: [10, 0], notional: 50_000 })];
    expect(greenToRed(one, cfg)!.material).toBe(false);
  });
});

describe("timing axis (feature 6)", () => {
  it("maps the stored strategy and splits Day at 10:00", () => {
    expect(timingOf({ strategy: "OPG" })).toBe("am");
    expect(timingOf({ strategy: "Print" })).toBe("opg");
    expect(timingOf({ strategy: "Day", entrySec: 9 * 3600 + 45 * 60 })).toBe("open30");
    expect(timingOf({ strategy: "Day", entrySec: 10 * 3600 })).toBe("day");
    expect(timingOf({ strategy: "OPGtoDAY" })).toBe("opg_day");
    expect(timingOf({ strategy: "Swing" })).toBe("swing");
    expect(timingOf({ strategy: "AfterMarket" })).toBe("pm");
    expect(timingOf({ strategy: "OPT" })).toBeNull();
    expect(timingOf({ strategy: null, entrySec: 16 * 3600 + 5 * 60 })).toBe("pm");
    expect(offTiming("open30", ["day", "moc"])).toBe(true);
    expect(offTiming("open30", [])).toBe(false);
  });
});
