// /analytics data plan (owner rule 2026-10-21): staff on one person — themselves by default — get EXACTLY the trader
// path (raw trades on every tab, OverviewTab with the equity chart); the desk aggregate only for «Вся команда» and
// only on the tabs that read it, so an aggregate failure can never blank a per-trade tab.
import { describe, expect, it } from "vitest";
import { RAW_TABS, analyticsDataPlan, type AnalyticsTabKey } from "./data-plan";

const ALL_TABS: AnalyticsTabKey[] = ["overview", "edge", "matrix", "whatif", "montecarlo", "desk", "psychology", "pro"];

describe("analyticsDataPlan", () => {
  it("staff + self (nothing picked) ⇒ the trader path on every tab, with their own name", () => {
    for (const tab of ALL_TABS) {
      const p = analyticsDataPlan({ staff: true, me: "Admin A", picked: "", team: false, tab });
      expect(p).toMatchObject({ aggregate: false, needRaw: true });
      expect(p.scope).toEqual({ trader: "Admin A", team: false, self: true });
    }
  });

  it("staff + another trader ⇒ the trader path for that trader", () => {
    const p = analyticsDataPlan({ staff: true, me: "Admin A", picked: "Bob", team: false, tab: "overview" });
    expect(p).toMatchObject({ aggregate: false, needRaw: true, scope: { trader: "Bob", team: false } });
  });

  it("staff + «Вся команда» ⇒ the aggregate on overview / matrix / desk, raw desk trades on per-trade tabs", () => {
    for (const tab of ALL_TABS) {
      const p = analyticsDataPlan({ staff: true, me: "Admin A", picked: "", team: true, tab });
      const raw = RAW_TABS.includes(tab);
      expect(p.scope).toEqual({ trader: null, team: true, self: false });
      expect(p.aggregate).toBe(!raw);
      expect(p.needRaw).toBe(raw);
    }
  });

  it("a trader never reads the aggregate", () => {
    for (const tab of ALL_TABS) {
      expect(analyticsDataPlan({ staff: false, me: "Ann", picked: "", team: true, tab })).toMatchObject({ aggregate: false, needRaw: true, scope: { trader: null, self: true } });
    }
  });
});
