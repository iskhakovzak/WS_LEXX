import { describe, expect, it } from "vitest";
import { quantileSorted, runScenario, type Rule, type SimTrade } from "../whatIf";
import { suggestionGrid, traderDayResults } from "../whatIfGrid";
import { mk } from "./whatIfFixtures";

/** Two traders whose trades interleave inside one day (the desk-wide scope). */
const A = (gross: number, entryMin: number, p: Omit<Partial<SimTrade>, "gross"> = {}) => mk({ gross, entryMin, trader: "A", ...p });
const B = (gross: number, entryMin: number, p: Omit<Partial<SimTrade>, "gross"> = {}) => mk({ gross, entryMin, trader: "B", ...p });
const run = (trades: SimTrade[], rules: Rule[]) => runScenario(trades, rules, { bootstrap: false });

describe("team scope: day rules run per trader-day", () => {
  const day = [A(10, 600), B(20, 601), A(30, 602), B(40, 603), A(5, 604), B(6, 605)];

  it("maxTradesPerDay 1 keeps each trader's first trade", () => {
    const r = run(day, [{ type: "maxTradesPerDay", n: 1 }]);
    expect(r.keptIds).toEqual([day[0].id, day[1].id]);
  });

  it("maxTradesPerDay 2 keeps two trades of each trader", () => {
    const r = run(day, [{ type: "maxTradesPerDay", n: 2 }]);
    expect(r.keptIds).toEqual([day[0].id, day[1].id, day[2].id, day[3].id]);
  });

  it("one trader's daily loss limit leaves the other trading", () => {
    const ts = [A(-100, 600), B(10, 601), A(10, 602), B(20, 603)];
    const r = run(ts, [{ type: "dailyLossLimit", usd: 50 }]);
    expect(r.excluded.map((e) => e.id)).toEqual([ts[2].id]);
    expect(r.scenario.net).toBe(-70);
    // Same fixture and number as the web preview (edge-tracker components/what-if/rules.test.ts).
    expect(r.scenario.net - r.baseline.net).toBe(-10);
  });

  it("another trader's loss does not start this trader's after-loss pause", () => {
    const ts = [B(-10, 600, { holdSec: 60 }), A(5, 602), B(7, 602.5)];
    const r = run(ts, [{ type: "afterLoss", minutes: 5 }]);
    expect(r.excluded.map((e) => e.id)).toEqual([ts[2].id]);
  });

  it("the profit target and the giveback are per trader", () => {
    const ts = [A(50, 600), B(10, 601), A(10, 602), B(10, 603)];
    expect(run(ts, [{ type: "dailyProfitTarget", usd: 50 }]).excluded.map((e) => e.id)).toEqual([ts[2].id]);
    const gb = [A(100, 600), B(20, 601), A(-50, 602), B(-5, 603), A(30, 604), B(30, 605)];
    expect(run(gb, [{ type: "profitGiveback", peak: 100, pct: 50 }]).excluded.map((e) => e.id)).toEqual([gb[4].id]);
  });

  it("the state resets on the next calendar day", () => {
    const ts = [A(-100, 600), A(10, 610), A(20, 600, { day: "2026-10-02" })];
    expect(run(ts, [{ type: "dailyLossLimit", usd: 50 }]).excluded.map((e) => e.id)).toEqual([ts[1].id]);
  });
});

describe("trader-day quantiles", () => {
  it("two traders each −100 on one day give a typical losing day of 100, not 200", () => {
    const days = traderDayResults([A(-100, 600), B(-60, 601), B(-40, 602)]);
    expect(days.map((d) => [d.trader, d.net, d.trades])).toEqual([["A", -100, 1], ["B", -100, 2]]);
    const losses = days.filter((d) => d.net < 0).map((d) => -d.net).sort((a, b) => a - b);
    expect(quantileSorted(losses, 0.5)).toBe(100);
  });

  it("the grid's daily loss limits come from trader-days", () => {
    const ts: SimTrade[] = [];
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) ts.push(A(-100, 600, { day: d }), B(-100, 601, { day: d }));
    const dll = suggestionGrid(ts, { team: true }).filter((c) => c.rule.type === "dailyLossLimit").map((c) => c.rule);
    expect(dll).toEqual([{ type: "dailyLossLimit", usd: 100 }]);
  });
});

describe("equity and the bootstrap stay on calendar (desk) days", () => {
  it("one point per calendar day, not per trader-day", () => {
    const ts: SimTrade[] = [];
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) ts.push(A(-30, 600, { day: d }), B(20, 601, { day: d }), A(10, 602, { day: d }));
    const r = runScenario(ts, [{ type: "maxTradesPerDay", n: 1 }], { iters: 200 });
    expect(r.scenarioDaily.map((d) => [d.day, d.net, d.trades])).toEqual([["2026-10-01", -10, 2], ["2026-10-02", -10, 2], ["2026-10-03", -10, 2]]);
    expect(r.scenarioEquity).toHaveLength(3);
    expect(r.bootstrap?.days).toBe(3);
  });
});
