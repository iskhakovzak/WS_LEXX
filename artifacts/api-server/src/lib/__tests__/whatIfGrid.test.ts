import { describe, expect, it } from "vitest";
import type { Rule, RuleType, SimTrade } from "../whatIf";
import { suggestionGrid, trainDays, type GridCandidate } from "../whatIfGrid";
import { candidateEffect, findSuggestions, prepare } from "../whatIfSuggest";
import { MAX_SETUP_LEN, MAX_TAG_LEN } from "../whatIfTypes";
import { ruleSchema } from "../../routes/whatif";
import { dayList, mixedTrades, mk } from "./whatIfFixtures";

const DAYS = dayList(20);
/** `n` plain trades spread over 20 days (one trader, no marks). */
const plain = (n: number, p: Omit<Partial<SimTrade>, "gross"> = {}) => Array.from({ length: n }, (_, i) => mk({ gross: i % 2 ? 5 : -4, day: DAYS[i % 20], ...p }));
const of = (grid: GridCandidate[], type: RuleType) => grid.filter((c) => c.rule.type === type);

describe("grid families appear at their gate and not one below", () => {
  it("excludeImx: 10 IMX trades (and ≥ 30 others)", () => {
    expect(of(suggestionGrid([...plain(30), ...plain(9, { imx: true })]), "excludeImx")).toHaveLength(0);
    expect(of(suggestionGrid([...plain(30), ...plain(10, { imx: true })]), "excludeImx")).toEqual([{ rule: { type: "excludeImx" }, kind: "exante", picked: false }]);
    expect(of(suggestionGrid([...plain(29), ...plain(10, { imx: true })]), "excludeImx")).toHaveLength(0);
  });

  it("noReentry: 10 re-entries", () => {
    expect(of(suggestionGrid([...plain(30), ...plain(9, { reentry: true })]), "noReentry")).toHaveLength(0);
    expect(of(suggestionGrid([...plain(30), ...plain(10, { reentry: true })]), "noReentry")).toHaveLength(1);
  });

  it("maxSizeRel: 10 trades above x (of ≥ 20 with a usual size)", () => {
    const rels = (above: number) => [...plain(20, { sizeRel: 1 }), ...plain(above, { sizeRel: 1.6 })];
    expect(of(suggestionGrid(rels(9)), "maxSizeRel")).toHaveLength(0);
    expect(of(suggestionGrid(rels(10)), "maxSizeRel").map((c) => c.rule)).toEqual([{ type: "maxSizeRel", x: 1.5 }]);
  });

  it("profitGiveback / dailyProfitTarget: 10 green trader-days", () => {
    const greens = (n: number) => dayList(n).map((day, i) => mk({ gross: 100 + i * 10, day }));
    expect(of(suggestionGrid(greens(9)), "profitGiveback")).toHaveLength(0);
    expect(of(suggestionGrid(greens(9)), "dailyProfitTarget")).toHaveLength(0);
    const g = suggestionGrid(greens(10));
    expect(of(g, "profitGiveback").map((c) => c.rule)).toEqual([{ type: "profitGiveback", peak: 150, pct: 30 }, { type: "profitGiveback", peak: 150, pct: 50 }]);
    expect(of(g, "dailyProfitTarget").map((c) => c.rule)).toEqual([{ type: "dailyProfitTarget", usd: 150 }, { type: "dailyProfitTarget", usd: 200 }]);
  });

  it("excludeMistakes: 8 marked trades on ≥ 3 trader-days", () => {
    const marked = (n: number) => Array.from({ length: n }, (_, i) => mk({ gross: i < 2 ? 5 : -20, day: DAYS[i], mistakes: ["fomo"] }));
    expect(of(suggestionGrid([...plain(30), ...marked(7)]), "excludeMistakes")).toHaveLength(0);
    expect(of(suggestionGrid([...plain(30), ...marked(8)]), "excludeMistakes")).toEqual([{ rule: { type: "excludeMistakes", codes: ["fomo"] }, kind: "label", picked: false }]);
  });

  it("excludeMistakes: one combined candidate when ≥ 2 codes qualify; exit-time codes never", () => {
    const marked = (code: "fomo" | "revenge" | "lateExit") => Array.from({ length: 8 }, (_, i) => mk({ gross: i < 2 ? 5 : -20, day: DAYS[i], mistakes: [code] }));
    const g = of(suggestionGrid([...plain(30), ...marked("fomo"), ...marked("revenge"), ...marked("lateExit")]), "excludeMistakes").map((c) => c.rule);
    expect(g).toEqual([{ type: "excludeMistakes", codes: ["fomo"] }, { type: "excludeMistakes", codes: ["revenge"] }, { type: "excludeMistakes", codes: ["fomo", "revenge"] }]);
  });

  it("minGrade: ≥ 30 graded and ≥ 60% of the trades", () => {
    const graded = (g: number) => [...plain(g, { grade: "A" }), ...plain(100 - g)];
    expect(of(suggestionGrid(graded(59)), "minGrade")).toHaveLength(0);
    expect(of(suggestionGrid(graded(60)), "minGrade").map((c) => c.rule)).toEqual([{ type: "minGrade", grade: "A" }, { type: "minGrade", grade: "B" }]);
  });

  it("no pre-market / no after-hours windows need 10 such entries on 3 trader-days", () => {
    const pre = (n: number) => Array.from({ length: n }, (_, i) => mk({ gross: 1, day: DAYS[i % 3], entryMin: 540 }));
    const hasFrom0930 = (g: GridCandidate[]) => g.some((c) => c.rule.type === "timeWindow" && c.rule.from === "09:30" && !c.rule.to);
    expect(hasFrom0930(suggestionGrid([...plain(30), ...pre(9)]))).toBe(false);
    expect(hasFrom0930(suggestionGrid([...plain(30), ...pre(10)]))).toBe(true);
    const post = (n: number, days: number) => Array.from({ length: n }, (_, i) => mk({ gross: 1, day: DAYS[i % days], entryMin: 965 }));
    const afterHours = (g: GridCandidate[]) => g.filter((c) => c.rule.type === "timeWindow" && c.rule.to === "16:00").map((c) => c.rule);
    expect(afterHours(suggestionGrid([...plain(30), ...post(10, 2)]))).toEqual([]);
    expect(afterHours(suggestionGrid([...plain(30), ...post(9, 3)]))).toEqual([]);
    expect(afterHours(suggestionGrid([...plain(30), ...post(10, 3)]))).toEqual([{ type: "timeWindow", to: "16:00" }]);
  });
});

describe("labelling-bias gate", () => {
  const tagged = (losers: number, winners: number) => [
    ...Array.from({ length: losers }, (_, i) => mk({ gross: -20, day: DAYS[i % 20], ptags: ["news"] })),
    ...Array.from({ length: winners }, (_, i) => mk({ gross: 5, day: DAYS[(i + 5) % 20], ptags: ["News"] })),
  ];
  it("a tag only on losers gives no candidate; 15% non-losers make one", () => {
    expect(of(suggestionGrid([...plain(30), ...tagged(12, 0)]), "excludeTags")).toHaveLength(0);
    expect(of(suggestionGrid([...plain(30), ...tagged(12, 1)]), "excludeTags")).toHaveLength(0);
    expect(of(suggestionGrid([...plain(30), ...tagged(11, 2)]), "excludeTags")).toEqual([{ rule: { type: "excludeTags", tags: ["news"] }, kind: "label", picked: true }]);
  });
});

describe("every grid rule can be run (the route's ruleSchema)", () => {
  it("a personal tag or setup longer than a rule takes is never a candidate", () => {
    const long = "earnings gap continuation after the open with heavy premarket volume"; // 70 chars
    expect(long.length).toBeGreaterThan(MAX_TAG_LEN);
    const losers = (p: Omit<Partial<SimTrade>, "gross">) => [
      ...Array.from({ length: 12 }, (_, i) => mk({ gross: -20, day: DAYS[i % 20], ...p })),
      ...Array.from({ length: 3 }, (_, i) => mk({ gross: 5, day: DAYS[(i + 5) % 20], ...p })),
    ];
    const g = suggestionGrid([...plain(40), ...losers({ ptags: [long] }), ...losers({ ptags: ["news"] }), ...losers({ setup: "x".repeat(MAX_SETUP_LEN + 1) })]);
    expect(of(g, "excludeTags").map((c) => c.rule)).toEqual([{ type: "excludeTags", tags: ["news"] }]);
    expect(of(g, "excludeSetups")).toEqual([]);
    for (const c of [...g, ...suggestionGrid(mixedTrades({ traders: 1, days: 60, perDay: 6 }))]) {
      expect(ruleSchema.safeParse(c.rule).success, JSON.stringify(c.rule)).toBe(true);
    }
  });
});

describe("team scope", () => {
  it("no share-size caps and no personal tags; day limits from trader-days", () => {
    const ts = mixedTrades({ traders: 2, days: 20, perDay: 4 });
    const one = suggestionGrid(ts.filter((t) => t.trader === "T0"));
    expect(of(one, "sizeRange").length).toBeGreaterThan(0);
    const team = suggestionGrid(ts, { team: true });
    expect(of(team, "sizeRange")).toHaveLength(0);
    expect(of(team, "excludeTags")).toHaveLength(0);
    expect(of(team, "dailyLossLimit").length).toBeGreaterThan(0);
  });
});

describe("never in the grid", () => {
  it("commission plans, loss caps and minimum holds", () => {
    const grid = suggestionGrid(mixedTrades({ traders: 1, days: 60, perDay: 6 }));
    expect(grid.length).toBeGreaterThan(50);
    expect(grid.length).toBeLessThanOrEqual(80);
    for (const type of ["commissionPlan", "capLoss", "minHold"] as RuleType[]) expect(of(grid, type)).toHaveLength(0);
  });
});

describe("picked on TRAIN, checked on TEST", () => {
  it("a ticker that loses on TRAIN and wins on TEST is generated but dropped by the holdout gate", () => {
    const days = dayList(45);
    const train = trainDays(days.map((day) => mk({ gross: 1, day })))!;
    expect(train.size).toBe(30);
    const ts: SimTrade[] = [];
    days.forEach((day, i) => {
      for (let k = 0; k < 3; k++) ts.push(mk({ gross: k === 1 ? 6 : -2, day, ticker: `N${k}`, entryMin: 600 + k }));
      if (i % 3 === 0) ts.push(mk({ gross: train.has(day) ? -30 : 10, day, ticker: "ZZZ", entryMin: 700 }));
    });
    const rule: Rule = { type: "excludeTickers", tickers: ["ZZZ"] };
    const cand = suggestionGrid(ts).find((c) => JSON.stringify(c.rule) === JSON.stringify(rule));
    expect(cand).toMatchObject({ picked: true, kind: "exante" });
    const e = candidateEffect(prepare(ts), rule);
    expect(e.delta).toBeGreaterThan(0);
    expect(e.holdout!.delta).toBeLessThan(0);
    expect(e.excluded).toBe(15);
    expect(findSuggestions(ts).suggestions.map((s) => JSON.stringify(s.rule))).not.toContain(JSON.stringify(rule));
  });
});
