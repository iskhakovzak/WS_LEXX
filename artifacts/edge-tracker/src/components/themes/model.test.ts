import { describe, expect, it } from "vitest";
import {
  METRICS, ageSeconds, cellIntensity, columnMax, defaultColumn, effectiveSort, hasValues, isMetric, isSort, leadersLaggards, nextSort,
  parseTickers, phoneColumns, pollInterval, sortMembers, sortThemes, splitHalves, type ThemeOut,
} from "./model";

type Vals = Partial<Pick<ThemeOut, "today" | "fromOpen" | "premarket" | "afterHours">>;
const th = (id: number, name: string, v: Vals = {}): ThemeOut => ({
  id, name, today: null, fromOpen: null, premarket: null, afterHours: null, members: [], missing: [], ...v,
});
const mq = (ticker: string, today: number | null, fromOpen: number | null) => ({ ticker, price: 1, today, fromOpen, premarket: null, afterHours: null });

describe("default column by session", () => {
  const all = [th(1, "AI", { premarket: 1, fromOpen: 2, today: 3, afterHours: 4 })];

  it("pre → premarket, rth → from open, post → after hours, closed → today", () => {
    expect(defaultColumn("pre", all)).toBe("premarket");
    expect(defaultColumn("rth", all)).toBe("fromOpen");
    expect(defaultColumn("post", all)).toBe("afterHours");
    expect(defaultColumn("closed", all)).toBe("today");
  });

  it("a column without values is never auto-selected", () => {
    const preNoPrints = [th(1, "AI", { today: 0.5 })];
    expect(defaultColumn("pre", preNoPrints)).toBe("today");
    const rthEarly = [th(1, "AI", { premarket: 1, today: 2 })];
    expect(defaultColumn("rth", rthEarly)).toBe("today");
    expect(defaultColumn("post", [th(1, "AI", { fromOpen: 1 })])).toBe("fromOpen");
    expect(defaultColumn("post", [])).toBe("today");
  });

  it("the user's stored sort wins; junk falls back to the session default", () => {
    expect(effectiveSort({ col: "today", dir: "asc" }, "rth", all)).toEqual({ col: "today", dir: "asc" });
    expect(effectiveSort(null, "rth", all)).toEqual({ col: "fromOpen", dir: "desc" });
    expect(effectiveSort({ col: "week", dir: "desc" }, "pre", all)).toEqual({ col: "premarket", dir: "desc" });
    expect(isSort({ col: "today", dir: "up" })).toBe(false);
  });
});

describe("sorting", () => {
  const themes = [th(1, "Banks", { today: 0.5 }), th(2, "AI", { today: 2.1 }), th(3, "Solar", { today: -3.2 }), th(4, "Gold")];

  it("header click: desc → asc → back to the default; another column starts desc", () => {
    expect(nextSort({ col: "today", dir: "desc" }, "today")).toEqual({ col: "today", dir: "asc" });
    expect(nextSort({ col: "today", dir: "asc" }, "today")).toBeNull();
    expect(nextSort({ col: "today", dir: "asc" }, "premarket")).toEqual({ col: "premarket", dir: "desc" });
  });

  it("best → worst or worst → best; unknown always last", () => {
    expect(sortThemes(themes, { col: "today", dir: "desc" }).map((t) => t.name)).toEqual(["AI", "Banks", "Solar", "Gold"]);
    expect(sortThemes(themes, { col: "today", dir: "asc" }).map((t) => t.name)).toEqual(["Solar", "Banks", "AI", "Gold"]);
    const m = [mq("B", null, 1), mq("A", 2, 0), mq("C", -1, 3)];
    expect(sortMembers(m, { col: "today", dir: "desc" }).map((x) => x.ticker)).toEqual(["A", "C", "B"]);
    expect(sortMembers(m, { col: "fromOpen", dir: "asc" }).map((x) => x.ticker)).toEqual(["A", "B", "C"]);
  });

  it("wide screens split the sorted list in halves: 39 → 20 | 19", () => {
    const rows = Array.from({ length: 39 }, (_, i) => i + 1);
    const [l, r] = splitHalves(rows);
    expect([l.length, r.length, l[0], l.at(-1), r[0], r.at(-1)]).toEqual([20, 19, 1, 20, 21, 39]);
    expect(splitHalves([])).toEqual([[], []]);
  });
});

describe("cells and header strip", () => {
  const themes = [th(1, "AI", { today: 2.1, premarket: 1 }), th(2, "Banks", { today: 0.4 }), th(3, "Solar", { today: -3 }), th(4, "Gold", { today: -1 })];

  it("intensity = |value| / column max, 0 for unknown / zero / empty column", () => {
    expect(columnMax(themes, "today")).toBe(3);
    expect(columnMax(themes, "afterHours")).toBe(0);
    expect(cellIntensity(-3, 3)).toBe(1);
    expect(cellIntensity(1.5, 3)).toBe(0.5);
    expect(cellIntensity(9, 3)).toBe(1);
    expect(cellIntensity(0, 3)).toBe(0);
    expect(cellIntensity(null, 3)).toBe(0);
    expect(cellIntensity(1, 0)).toBe(0);
  });

  it("column availability; phone columns = active + today (today → + from open)", () => {
    expect(hasValues(themes, "premarket")).toBe(true);
    expect(hasValues(themes, "fromOpen")).toBe(false);
    expect(phoneColumns("premarket")).toEqual(["premarket", "today"]);
    expect(phoneColumns("today")).toEqual(["today", "fromOpen"]);
  });

  it("leaders are the best gainers, laggards the worst losers (worst first), never the same theme", () => {
    const { leaders, laggards } = leadersLaggards(themes, "today");
    expect(leaders.map((t) => t.name)).toEqual(["AI", "Banks"]);
    expect(laggards.map((t) => t.name)).toEqual(["Solar", "Gold"]);
    expect(leadersLaggards(themes, "afterHours")).toEqual({ leaders: [], laggards: [] });
  });
});

describe("misc", () => {
  it("polls only while the market can move", () => {
    expect(pollInterval("pre")).toBe(30_000);
    expect(pollInterval("rth")).toBe(30_000);
    expect(pollInterval("post")).toBe(30_000);
    expect(pollInterval("closed")).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });

  it("age in seconds, never negative; metric names validated", () => {
    expect(ageSeconds("2026-10-20T15:00:00.000Z", Date.parse("2026-10-20T15:00:12.400Z"))).toBe(12);
    expect(ageSeconds("2026-10-20T15:00:10.000Z", Date.parse("2026-10-20T15:00:00.000Z"))).toBe(0);
    expect(ageSeconds(null, 0)).toBeNull();
    expect(METRICS).toEqual(["premarket", "fromOpen", "today", "afterHours"]);
    expect(METRICS.every(isMetric)).toBe(true);
    expect(isMetric("week")).toBe(false);
  });

  it("parses staff ticker input like the server", () => {
    expect(parseTickers("mu, $wdc  stx;MU")).toEqual({ tickers: ["MU", "WDC", "STX"], invalid: [] });
    expect(parseTickers("brk.b x1")).toEqual({ tickers: ["BRK.B"], invalid: ["X1"] });
  });
});
