import { describe, expect, it } from "vitest";
import {
  breachStats, mondayOf, nextActionFor, normalizeBreachActions, prevTradingDay, templateDiff, tradingPhase,
  trendDirection, weeklyTrend, type LimitFields, type NextActionInput,
} from "../curatorLogic";

const TPL: LimitFields = {
  accountSize: 10_000, dailyLossLimit: 150, weeklyLossLimit: 400, maxDrawdown: 800, maxRiskPerTrade: 50,
  maxPositionUsd: 10_000, maxOvernightExposure: 0, maxOpenPositions: 2, allowOvernight: false, allowSwing: false,
};

describe("curatorLogic time", () => {
  it("phases by NY minutes", () => {
    expect(tradingPhase("2026-10-16", 8 * 60)).toBe("premarket");
    expect(tradingPhase("2026-10-16", 10 * 60)).toBe("session");
    expect(tradingPhase("2026-10-16", 16 * 60)).toBe("afterclose");
    expect(tradingPhase("2026-10-17", 10 * 60)).toBe("weekend");
  });
  it("previous trading day skips weekends", () => {
    expect(prevTradingDay("2026-10-19")).toBe("2026-10-16"); // Mon → Fri
    expect(prevTradingDay("2026-10-16")).toBe("2026-10-15");
    expect(prevTradingDay("2026-10-18")).toBe("2026-10-16"); // Sun → Fri
  });
  it("monday of week", () => {
    expect(mondayOf("2026-10-16")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
  });
});

describe("breachStats (repeat-breach escalation)", () => {
  it("first breach in a week is not a repeat", () => {
    expect(breachStats(["2026-10-16"], "2026-10-16")).toEqual({ days7: 1, repeat: false, prior: [] });
  });
  it("second breach inside 7 days is a repeat", () => {
    const s = breachStats(["2026-10-12", "2026-10-16", "2026-10-16"], "2026-10-16");
    expect(s.repeat).toBe(true);
    expect(s.days7).toBe(2);
    expect(s.prior).toEqual(["2026-10-12"]);
  });
  it("breach older than the window does not count", () => {
    expect(breachStats(["2026-10-09", "2026-10-16"], "2026-10-16").repeat).toBe(false);
    expect(breachStats(["2026-10-10", "2026-10-16"], "2026-10-16").repeat).toBe(true);
  });
  it("no breach today → not a repeat even with older ones", () => {
    expect(breachStats(["2026-10-13", "2026-10-14"], "2026-10-16").repeat).toBe(false);
  });
});

describe("templateDiff", () => {
  it("equal limits → no diff", () => {
    expect(templateDiff({ ...TPL }, TPL)).toEqual([]);
  });
  it("reports changed numbers and booleans", () => {
    const d = templateDiff({ ...TPL, dailyLossLimit: 200, allowSwing: true }, TPL);
    expect(d.map((x) => x.field)).toEqual(["dailyLossLimit", "allowSwing"]);
  });
  it("no limits → every field differs", () => {
    expect(templateDiff(null, TPL).length).toBe(10);
  });
  it("tolerates cents rounding", () => {
    expect(templateDiff({ ...TPL, dailyLossLimit: 150.001 }, TPL)).toEqual([]);
  });
});

describe("weeklyTrend", () => {
  const days = [
    { date: "2026-09-22", pnl: 100, trades: 3 },
    { date: "2026-10-05", pnl: -50, trades: 2 },
    { date: "2026-10-06", pnl: 20, trades: 1 },
    { date: "2026-10-14", pnl: null, trades: 4 },
  ];
  it("buckets by week, oldest first", () => {
    const w = weeklyTrend(days, "2026-10-16", 4);
    expect(w.map((x) => x.week)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(w.map((x) => x.net)).toEqual([100, null, -30, null]);
    expect(w[3].trades).toBe(4);
  });
  it("direction", () => {
    expect(trendDirection([{ week: "a", net: -100, trades: 1 }, { week: "b", net: 200, trades: 1 }])).toBe("up");
    expect(trendDirection([{ week: "a", net: 200, trades: 1 }, { week: "b", net: -100, trades: 1 }])).toBe("down");
    expect(trendDirection([{ week: "a", net: 100, trades: 1 }])).toBe("none");
  });
});

describe("nextActionFor", () => {
  const base: NextActionInput = {
    trader: "Артур", halted: false, nearStop: false, unreviewedBreaches: 0, eodPending: 0, weeklySubmitted: false,
    overdueActions: 0, hasLimits: true, templateDrift: 0, missingPlan: false, missingEod: false, daysSinceOneOnOne: 3,
  };
  it("all fine", () => expect(nextActionFor(base).kind).toBe("none"));
  it("breach review beats everything", () => {
    expect(nextActionFor({ ...base, halted: true, unreviewedBreaches: 1, eodPending: 2 }).kind).toBe("breach_review");
  });
  it("no limits beats missing plan", () => {
    expect(nextActionFor({ ...base, hasLimits: false, missingPlan: true }).kind).toBe("no_limits");
  });
  it("no 1:1 ever", () => {
    expect(nextActionFor({ ...base, daysSinceOneOnOne: null }).kind).toBe("one_on_one");
  });
  it("links encode trader", () => {
    expect(nextActionFor({ ...base, nearStop: true }).href).toBe(`/risk?trader=${encodeURIComponent("Артур")}`);
  });
});

describe("normalizeBreachActions", () => {
  it("drops empty, assigns ids, validates dates", () => {
    const out = normalizeBreachActions([{ title: "  " }, { title: "Стоп на каждой сделке", dueOn: "2026-10-20" }, { title: "x", dueOn: "bad", status: "done" }]);
    expect(out).toEqual([
      { id: "a2", title: "Стоп на каждой сделке", dueOn: "2026-10-20", status: "open" },
      { id: "a3", title: "x", dueOn: null, status: "done" },
    ]);
  });
});
