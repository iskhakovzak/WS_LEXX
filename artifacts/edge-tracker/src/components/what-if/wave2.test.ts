/**
 * Wave 2 of /what-if on the web: the new rules (URL round trip, phrasing, the live preview = the engine's no-look-ahead
 * logic), «Как бы выглядел мой месяц» (month-view), «Почему» headline and the own set of «Набор правил».
 */
import { describe, expect, it } from "vitest";
import type { SimTrade } from "./api";
import { type PreviewTrade, type Rule, chipLabel, decodeRules, encodeRules, ifNotPhrase, previewRule, reasonLabel } from "./rules";
import { ALL_MONTHS, maxDrawdownOf, monthView, monthsOf } from "./month-view";
import { whyHeadline } from "./why-fold";
import { ownSet, setApplied } from "./combo-panel";
import { BLOCK_WINDOWS, EXCLUDE_FIELDS, STOP_FIELDS } from "./builder-fields";

let id = 0;
const tr = (p: Partial<PreviewTrade> & { gross: number }): PreviewTrade => {
  id++;
  return { id, day: "2026-10-01", entryMin: 600, ticker: "AAA", side: "long", qty: 100, entry: 10, fees: 0, holdSec: 60, seq: id, ...p };
};
const at = (entryMin: number, gross: number, holdMin = 1, p: Partial<PreviewTrade> = {}) => tr({ entryMin, holdSec: holdMin * 60, ...p, gross });

const NEW_RULES: Rule[] = [
  { type: "afterWin", minutes: 5 }, { type: "redZone", usd: 50, k: 1 }, { type: "redZone", usd: 50, k: 2, floor: 120 },
  { type: "blockWindow", from: "11:30", to: "13:30" }, { type: "maxTradesPerTicker", n: 2 }, { type: "noReentryAfterLoss", minutes: 15 },
  { type: "excludeStrategies", strategies: ["OPG", "MOC"] }, { type: "excludeEarnings" },
];

describe("new rules: URL and phrasing", () => {
  it("survive the URL round trip; junk is dropped", () => {
    expect(decodeRules(encodeRules(NEW_RULES.filter((r, i, a) => a.findIndex((x) => x.type === r.type) === i)))).toEqual([
      NEW_RULES[0], NEW_RULES[1], NEW_RULES[3], NEW_RULES[4], NEW_RULES[5], NEW_RULES[6], NEW_RULES[7],
    ]);
    const bad = encodeRules([{ type: "blockWindow", from: "25:00", to: "10:00" }, { type: "excludeStrategies", strategies: ["Nope"] }, { type: "redZone", usd: -1, k: 1 }] as unknown as Rule[]);
    expect(decodeRules(bad)).toEqual([]);
    // A floor at or above the start is dropped (the engine would skip it as a bad zone).
    expect(decodeRules(encodeRules([{ type: "redZone", usd: 100, k: 1, floor: 80 }]))).toEqual([{ type: "redZone", usd: 100, k: 1 }]);
  });
  it("have a chip, a headline and a reason name", () => {
    for (const r of NEW_RULES) {
      expect(chipLabel(r).length).toBeGreaterThan(3);
      expect(ifNotPhrase(r).length).toBeGreaterThan(8);
      expect(reasonLabel(r.type)).not.toBe(r.type);
    }
  });
  it("the builder offers them (block windows from a short list, the red zone with k as the condition)", () => {
    expect(EXCLUDE_FIELDS.map((f) => f.id)).toEqual(expect.arrayContaining(["afterWin", "reentryLoss", "blockWindow", "strategy", "earnings"]));
    expect(STOP_FIELDS.map((f) => f.id)).toEqual(expect.arrayContaining(["maxPerTicker", "redZone"]));
    const block = EXCLUDE_FIELDS.find((f) => f.id === "blockWindow")!;
    expect(block.build("", BLOCK_WINDOWS[2])).toEqual({ type: "blockWindow", from: "11:30", to: "13:30" });
    expect(STOP_FIELDS.find((f) => f.id === "redZone")!.build("k2", "150")).toEqual({ type: "redZone", usd: 150, k: 2 });
  });
});

describe("live preview = the engine (no look-ahead)", () => {
  it("afterWin: only after the win is realised", () => {
    const win = at(600, 50, 10), open = at(605, -5), inPause = at(612, -20), later = at(616, 7);
    expect(previewRule([win, open, inPause, later], { type: "afterWin", minutes: 5 })).toMatchObject({ affected: 1, net: -20, effect: 20 });
  });
  it("redZone: sticky from the first realised touch, k entries", () => {
    const t = [at(590, 5), at(600, -60, 1), at(602, 80, 1), at(610, 3)];
    expect(previewRule(t, { type: "redZone", usd: 50, k: 1 })).toMatchObject({ affected: 1, net: 3 });
    const floor = [at(600, -60, 1), at(602, -100, 1), at(605, 50)];
    expect(previewRule(floor, { type: "redZone", usd: 50, k: 3, floor: 150 })).toMatchObject({ affected: 1, net: 50 });
  });
  it("blockWindow, maxTradesPerTicker, noReentryAfterLoss, strategies, earnings", () => {
    expect(previewRule([at(570, 1), at(574, 2), at(575, 3)], { type: "blockWindow", from: "09:30", to: "09:35" }).affected).toBe(2);
    expect(previewRule([at(600, 1), at(601, 2, 1, { ticker: "BBB" }), at(602, 3)], { type: "maxTradesPerTicker", n: 1 })).toMatchObject({ affected: 1, net: 3 });
    const reentry = [at(600, -40, 10), at(605, 1), at(612, -9), at(612, 3, 1, { ticker: "BBB" })];
    expect(previewRule(reentry, { type: "noReentryAfterLoss", minutes: 15 })).toMatchObject({ affected: 1, net: -9 });
    const marked = [tr({ gross: -5, strategy: "OPG" }), tr({ gross: 4, strategy: "Day" }), tr({ gross: -7, earnings: true })];
    expect(previewRule(marked, { type: "excludeStrategies", strategies: ["OPG"] }).net).toBe(-5);
    expect(previewRule(marked, { type: "excludeEarnings" }).net).toBe(-7);
  });
});

describe("«Как бы выглядел мой месяц»", () => {
  const sim = (p: Partial<SimTrade> & { gross: number; day: string }): SimTrade => {
    id++;
    return { id, entryMin: 600, ticker: "AAA", side: "long", qty: 100, entry: 10, fees: 1, holdSec: 60, setup: null, seq: id, ...p };
  };
  const trades = [
    sim({ day: "2026-09-30", gross: 50 }),
    sim({ day: "2026-10-01", gross: 101 }), sim({ day: "2026-10-01", gross: -81, entryMin: 610 }),
    sim({ day: "2026-10-02", gross: -41 }), sim({ day: "2026-10-03", gross: 21 }),
  ];
  it("months newest first; the fact and the scenario side by side", () => {
    expect(monthsOf(trades)).toEqual(["2026-10", "2026-09"]);
    const removed = trades[2], changed = trades[3];
    const v = monthView(trades, [{ id: removed.id }], [{ id: changed.id, after: -10 }], "2026-10");
    expect(v.points.map((p) => [p.fact, p.scenario, p.removed, p.changed])).toEqual([[100, 100, false, false], [18, 100, true, false], [-24, 90, false, true], [-4, 110, false, false]]);
    expect(v.fact).toMatchObject({ net: -4, maxDrawdown: -42, worstDay: { day: "2026-10-02", net: -42 }, redDays: 1, days: 3, trades: 4 });
    expect(v.scenario).toMatchObject({ net: 110, maxDrawdown: -10, worstDay: { day: "2026-10-02", net: -10 }, redDays: 1, trades: 3 });
    expect([v.removed, v.changed]).toEqual([1, 1]);
    expect(monthView(trades, [], [], ALL_MONTHS).fact.trades).toBe(5);
  });
  it("drawdown on the end-of-day curve from 0", () => {
    expect(maxDrawdownOf([100, -150, 20, -40])).toBe(-170);
    expect(maxDrawdownOf([-30, 10])).toBe(-30);
    expect(maxDrawdownOf([])).toBe(0);
  });
});

describe("«Почему» and the own set", () => {
  it("a rule carried by one day is flagged", () => {
    const base = { total: 120, days: 3, topTrades: [], topDays: [], top3Share: 1, withoutTopDay: 20 };
    expect(whyHeadline({ ...base, topDayShare: 0.83 })).toEqual({ key: "oneDay", pct: 83, lucky: true });
    expect(whyHeadline({ ...base, topDayShare: 0.3 })).toEqual({ key: "spread", pct: 30, lucky: false });
    expect(whyHeadline({ ...base, total: -5, topDayShare: null })).toEqual({ key: "none", pct: 0, lucky: false });
  });
  it("the own set: distinct types, no tariff, at most three", () => {
    const rules: Rule[] = [
      { type: "maxTradesPerDay", n: 3 }, { type: "commissionPlan", perShare: 0.01, minPerOrder: 1, ecnPerShare: 0 },
      { type: "afterWin", minutes: 5 }, { type: "excludeEarnings" }, { type: "blockWindow", from: "09:30", to: "09:35" },
    ];
    expect(ownSet(rules).map((r) => r.type)).toEqual(["maxTradesPerDay", "afterWin", "excludeEarnings"]);
    expect(setApplied(rules, [{ type: "afterWin", minutes: 5 }, { type: "excludeEarnings" }])).toBe(true);
    expect(setApplied(rules, [{ type: "afterWin", minutes: 10 }])).toBe(false);
  });
});
