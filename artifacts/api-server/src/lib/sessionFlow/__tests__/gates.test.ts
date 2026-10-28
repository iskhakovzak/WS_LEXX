import { describe, expect, it } from "vitest";
import { openWindowBreach, openWindowEdge, openWindowState, type OpenWindowCfg } from "../openWindow";
import { ideaBreaches, isLimited, missedIdeas, tierStats, type IdeaMark } from "../ideas";
import { bandOf, prefillChecks, scoreOf, suggestedRisk, type ChecklistItem } from "../checklist";
import { ruleLevel } from "../../leakGuard/ruleScan";
import type { FlowTrade } from "../types";

const DAY = "2026-10-27";
const at = (hh: number, mm: number) => Date.UTC(2026, 9, 27, hh + 4, mm);
let seq = 0;
function tr(p: Partial<FlowTrade> & { net: number; in: [number, number]; out: [number, number] }): FlowTrade {
  const { in: i, out: o, ...rest } = p;
  return {
    id: ++seq, trader: "T", day: DAY, ticker: "AAA", side: "long", result: p.net > 0 ? "win" : p.net < 0 ? "loss" : "be",
    entryAt: at(...i), exitAt: at(...o), entrySec: i[0] * 3600 + i[1] * 60, notional: 10_000, exitKind: "whole", strategy: "Day",
    setupId: null, setupName: null, pnl: p.net, fees: 0, ...rest,
  };
}

describe("opening window 09:30–10:00 (feature 7)", () => {
  const cfg: OpenWindowCfg = { shares: { junior: 0.25, trader: 0.5, senior: 0.5 }, liftMinTrades: 30 };
  const weak = { n: 40, net: 300, netExTop3: -120, outliers: true };
  const proven = { n: 40, net: 900, netExTop3: 350, outliers: false };

  it("a stage share of the daily limit — lower for juniors — lifted only by a proven, robust edge", () => {
    expect(openWindowState({ stage: "junior", dailyLimit: 400, ownLimit: null, edge: weak, cfg })).toMatchObject({ limitUsd: 100, source: "stage", lifted: false });
    expect(openWindowState({ stage: "trader", dailyLimit: 400, ownLimit: null, edge: weak, cfg })).toMatchObject({ limitUsd: 200 });
    expect(openWindowState({ stage: "trader", dailyLimit: 400, ownLimit: null, edge: proven, cfg })).toMatchObject({ limitUsd: null, lifted: true, stageLimitUsd: 200 });
    expect(openWindowState({ stage: "trader", dailyLimit: 400, ownLimit: null, edge: { ...proven, n: 12 }, cfg }).lifted).toBe(false);
    // the risk desk's own limit stays even with a proven edge
    expect(openWindowState({ stage: "junior", dailyLimit: 400, ownLimit: 60, edge: proven, cfg })).toMatchObject({ limitUsd: 60, source: "own", lifted: false });
    expect(openWindowState({ stage: "trader", dailyLimit: null, ownLimit: null, edge: weak, cfg }).limitUsd).toBeNull();
  });

  it("the gate fires at the first exit before 10:00 that takes the window's net to −limit; hard for juniors, soft otherwise", () => {
    const day = [
      tr({ net: -60, in: [9, 31], out: [9, 35] }), tr({ net: 20, in: [9, 36], out: [9, 40] }), tr({ net: -70, in: [9, 41], out: [9, 50] }),
      tr({ net: -500, in: [10, 5], out: [10, 20] }),
    ];
    expect(openWindowBreach(day, 100, at(10, 0))).toEqual({ at: at(9, 50), tradeId: day[2]!.id, loss: 110 });
    expect(openWindowBreach(day, 200, at(10, 0))).toBeNull();
    expect(openWindowEdge(day)).toMatchObject({ n: 3, net: -110 });
    expect(ruleLevel("open_window", "junior", "firm")).toBe("hard");
    expect(ruleLevel("open_window", "trader", "firm")).toBe("soft");
    expect(ruleLevel("open_window", "junior", "off")).toBeNull();
  });
});

describe("idea tiers (feature 8)", () => {
  const mark = (p: Partial<IdeaMark>): IdeaMark => ({ trader: "T", day: DAY, ticker: "AAA", side: null, tier: 2, authored: false, setupId: null, score: null, maxScore: null, threshold: null, ...p });

  it("authored and tier-3 ideas: at most a share of the stop, no re-entries", () => {
    expect(isLimited(mark({ tier: 3 }))).toBe(true);
    expect(isLimited(mark({ authored: true, tier: 1 }))).toBe(true);
    expect(isLimited(mark({ tier: 1 }))).toBe(false);
    const day = [tr({ net: -150, in: [9, 40], out: [9, 45] }), tr({ net: -80, in: [9, 50], out: [9, 55] }), tr({ net: -500, in: [10, 0], out: [10, 5], ticker: "BBB" })];
    const b = ideaBreaches(day, [mark({ tier: 3 }), mark({ ticker: "BBB", tier: 1 })], 400, 0.5, at(16, 0));
    expect(b.map((x) => [x.sourceKey, x.at, x.stats.kind, x.stats.limit])).toEqual([
      ["AAA:reentry", at(9, 50), "reentry", 200],
      ["AAA:loss", at(9, 55), "loss", 200],
    ]);
  });

  it("stats by tier and the missed tier 1–2 ideas", () => {
    const trades = [tr({ net: 100, in: [9, 40], out: [9, 45] }), tr({ net: -40, in: [11, 0], out: [11, 5], ticker: "CCC" })];
    const marks = [mark({ tier: 1 }), mark({ ticker: "CCC", tier: 3, authored: true }), mark({ ticker: "DDD", tier: 2 }), mark({ ticker: "EEE", tier: 1 })];
    const s = tierStats(trades, marks);
    expect(s.tiers.map((r) => [r.tier, r.n, r.net])).toEqual([["1", 1, 100], ["3", 1, -40]]);
    expect(s.authored.net).toBe(-40);
    const traded = new Set(trades.map((t) => `T\u0000${DAY}\u0000${t.ticker}`));
    const moves = new Map([[`${DAY}|DDD`, -7.5], [`${DAY}|EEE`, 2]]);
    expect(missedIdeas(marks, traded, moves, 5)).toEqual([{ day: DAY, ticker: "DDD", tier: 2, movePct: -7.5 }]);
  });
});

describe("setup checklist scoring (feature 9)", () => {
  const items: ChecklistItem[] = [
    { id: "gap", text: "Gap ≥ 3%", auto: "gap" }, { id: "vol", text: "RVOL ≥ 2", auto: "rvol" }, { id: "cat", text: "Strong catalyst", auto: "catalyst", weight: 2 },
    { id: "lvl", text: "Above yesterday's high" }, { id: "mkt", text: "Market with me" },
  ];
  it("prefills from the day's data, scores by weight against the threshold and cuts the risk below it", () => {
    const pre = prefillChecks(items, { gapPct: -4.2, rvol: 1.4, catalystStrong: true, analyst: false }, { gapPct: 3, rvol: 2 });
    expect(pre).toEqual({ gap: true, cat: true });
    const s = scoreOf(items, { ...pre, lvl: true }, 5)!;
    expect(s).toEqual({ score: 4, max: 6, threshold: 5, passed: false });
    expect(bandOf(s)).toBe("near");
    expect(suggestedRisk(100, s, 0.5)).toEqual({ usd: 50, reduced: true });
    const full = scoreOf(items, { ...pre, lvl: true, mkt: true }, 5)!;
    expect(full.passed).toBe(true);
    expect(suggestedRisk(100, full, 0.5)).toEqual({ usd: 100, reduced: false });
    expect(scoreOf(items, {}, null)!.threshold).toBe(6);
    expect(bandOf({ score: 1, threshold: 4 })).toBe("low");
  });
});
