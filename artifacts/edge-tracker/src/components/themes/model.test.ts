import { describe, expect, it } from "vitest";
import { ageSeconds, barOf, isMetric, panelScale, parseTickers, pollInterval, sortMembers, sortThemes, type ThemeOut } from "./model";

const th = (id: number, name: string, today: number | null, fromOpen: number | null): ThemeOut => ({ id, name, today, fromOpen, members: [], missing: [] });

describe("themes model", () => {
  const themes = [th(1, "Banks", 0.5, -0.2), th(2, "AI", 2.1, 1.4), th(3, "Solar", -3.2, null), th(4, "Gold", null, 0.9)];

  it("sorts best → worst per metric, unknown last", () => {
    expect(sortThemes(themes, "today").map((t) => t.name)).toEqual(["AI", "Banks", "Solar", "Gold"]);
    expect(sortThemes(themes, "fromOpen").map((t) => t.name)).toEqual(["AI", "Gold", "Banks", "Solar"]);
  });

  it("members sort the same way", () => {
    const m = [{ ticker: "B", price: 1, today: null, fromOpen: 1 }, { ticker: "A", price: 1, today: 2, fromOpen: 0 }, { ticker: "C", price: 1, today: -1, fromOpen: 3 }];
    expect(sortMembers(m, "today").map((x) => x.ticker)).toEqual(["A", "C", "B"]);
  });

  it("bar scale = max |value| of the panel; bars fill their half proportionally", () => {
    expect(panelScale(themes, "today")).toBe(3.2);
    expect(panelScale([th(1, "x", null, null)], "today")).toBe(0);
    expect(barOf(-3.2, 3.2)).toEqual({ side: "down", width: 100 });
    expect(barOf(1.6, 3.2)).toEqual({ side: "up", width: 50 });
    expect(barOf(0.001, 3.2)).toEqual({ side: "up", width: 2 });
    expect(barOf(0, 3.2)).toEqual({ side: null, width: 0 });
    expect(barOf(null, 3.2)).toEqual({ side: null, width: 0 });
    expect(barOf(1, 0)).toEqual({ side: null, width: 0 });
  });

  it("polls only while the market can move", () => {
    expect(pollInterval("pre")).toBe(30_000);
    expect(pollInterval("rth")).toBe(30_000);
    expect(pollInterval("post")).toBe(30_000);
    expect(pollInterval("closed")).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });

  it("age in seconds, never negative; stored view validated", () => {
    expect(ageSeconds("2026-10-20T15:00:00.000Z", Date.parse("2026-10-20T15:00:12.400Z"))).toBe(12);
    expect(ageSeconds("2026-10-20T15:00:10.000Z", Date.parse("2026-10-20T15:00:00.000Z"))).toBe(0);
    expect(ageSeconds(null, 0)).toBeNull();
    expect(isMetric("today")).toBe(true);
    expect(isMetric("week")).toBe(false);
  });

  it("parses staff ticker input like the server", () => {
    expect(parseTickers("mu, $wdc  stx;MU")).toEqual({ tickers: ["MU", "WDC", "STX"], invalid: [] });
    expect(parseTickers("brk.b x1")).toEqual({ tickers: ["BRK.B"], invalid: ["X1"] });
  });
});
