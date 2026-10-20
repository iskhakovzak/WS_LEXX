import { describe, expect, it } from "vitest";
import {
  METRICS, TICKER_COLUMNS, ageSeconds, breadth, breadthColumn, cellIntensity, columnMax, defaultColumn, effectiveSort, emptyColumns, hasValues,
  isMetric, isSortOf, nextSort, nextTab, parseScreenerInput, parseTickers, phoneColumns, planDay, pollInterval, setHidden, sharedRows, sortMembers,
  sortRows, sortThemes, splitColumns, tabOf, tabValue, themeTickerList, themesBoardRows, toggleIn, visibleColumns,
  type PersonalThemeOut, type ThemeMetric, type ThemeOut, type ThemesView, type TickerRow,
} from "./model";

const cols = (...c: ThemeMetric[]): ThemeMetric[] => c;

type Vals = Partial<Pick<ThemeOut, "today" | "fromOpen" | "premarket" | "afterHours">>;
const th = (id: number, name: string, v: Vals = {}): ThemeOut => ({
  id, name, today: null, fromOpen: null, premarket: null, afterHours: null, members: [], missing: [], ...v,
});
const mq = (ticker: string, today: number | null, fromOpen: number | null) => ({ ticker, price: 1, today, fromOpen, premarket: null, afterHours: null });
const tk = (ticker: string, v: Partial<TickerRow> = {}): TickerRow => ({
  ticker, price: 10, premarket: null, fromOpen: null, today: null, afterHours: null, gap: null, rvol: null, float: null, ...v,
});
const view = (over: Partial<ThemesView> = {}): ThemesView => ({ columns: [...METRICS], hidden: [], sort: null, tab: "shared", ...over });

describe("default column by session (visible, non-empty only)", () => {
  const all = [th(1, "AI", { premarket: 1, fromOpen: 2, today: 3, afterHours: 4 })];

  it("pre → premarket, rth → from open, post → after hours, closed → today", () => {
    expect(defaultColumn("pre", all, METRICS)).toBe("premarket");
    expect(defaultColumn("rth", all, METRICS)).toBe("fromOpen");
    expect(defaultColumn("post", all, METRICS)).toBe("afterHours");
    expect(defaultColumn("closed", all, METRICS)).toBe("today");
  });

  it("a column without values or hidden is never auto-selected", () => {
    expect(defaultColumn("pre", [th(1, "AI", { today: 0.5 })], METRICS)).toBe("today");
    expect(defaultColumn("rth", [th(1, "AI", { premarket: 1, today: 2 })], METRICS)).toBe("today");
    expect(defaultColumn("post", [], METRICS)).toBe("today");
    expect(defaultColumn("rth", all, cols("premarket", "afterHours"))).toBe("premarket");
    expect(defaultColumn("rth", [tk("MU", { rvol: 2 })], TICKER_COLUMNS)).toBe("rvol");
  });

  it("the stored sort wins when its column is visible; otherwise the session default", () => {
    expect(effectiveSort({ col: "today", dir: "asc" }, "rth", all, METRICS)).toEqual({ col: "today", dir: "asc" });
    expect(effectiveSort(null, "rth", all, METRICS)).toEqual({ col: "fromOpen", dir: "desc" });
    expect(effectiveSort({ col: "fromOpen", dir: "asc" }, "rth", all, cols("premarket", "today"))).toEqual({ col: "today", dir: "desc" });
    expect(effectiveSort({ col: "gap", dir: "asc" }, "rth", [tk("A", { gap: 1 })], TICKER_COLUMNS)).toEqual({ col: "gap", dir: "asc" });
    expect(isSortOf({ col: "today", dir: "up" }, METRICS)).toBe(false);
  });
});

describe("sorting and layout", () => {
  const themes = [th(1, "Banks", { today: 0.5 }), th(2, "AI", { today: 2.1 }), th(3, "Solar", { today: -3.2 }), th(4, "Gold")];

  it("header click: desc → asc → back to the default; another column starts desc", () => {
    expect(nextSort({ col: "today", dir: "desc" }, "today")).toEqual({ col: "today", dir: "asc" });
    expect(nextSort({ col: "today", dir: "asc" }, "today")).toBeNull();
    expect(nextSort<string>({ col: "today", dir: "asc" }, "rvol")).toEqual({ col: "rvol", dir: "desc" });
  });

  it("best → worst or worst → best; unknown always last; any column of tickers rows", () => {
    expect(sortThemes(themes, { col: "today", dir: "desc" }).map((t) => t.name)).toEqual(["AI", "Banks", "Solar", "Gold"]);
    expect(sortThemes(themes, { col: "today", dir: "asc" }).map((t) => t.name)).toEqual(["Solar", "Banks", "AI", "Gold"]);
    const m = [mq("B", null, 1), mq("A", 2, 0), mq("C", -1, 3)];
    expect(sortMembers(m, { col: "today", dir: "desc" }).map((x) => x.ticker)).toEqual(["A", "C", "B"]);
    const rows = [tk("A", { rvol: 1.2 }), tk("B", { rvol: 3 }), tk("C")];
    expect(sortRows(rows, { col: "rvol", dir: "desc" }, (r, c) => r[c], (r) => r.ticker).map((r) => r.ticker)).toEqual(["B", "A", "C"]);
  });

  it("wide screens split the sorted list into columns: 39 → 20 | 19, 55 → 19 | 19 | 17", () => {
    const [l, r] = splitColumns(Array.from({ length: 39 }, (_, i) => i + 1), 2);
    expect([l!.length, r!.length, l![0], l!.at(-1), r![0], r!.at(-1)]).toEqual([20, 19, 1, 20, 21, 39]);
    const three = splitColumns(Array.from({ length: 55 }, (_, i) => i + 1), 3);
    expect(three.map((c) => [c.length, c[0], c.at(-1)])).toEqual([[19, 1, 19], [19, 20, 38], [17, 39, 55]]);
    expect(splitColumns([], 2)).toEqual([[], []]);
  });

  it("phones: ≤ 2 of the visible columns — the active one and «За день»", () => {
    expect(phoneColumns("premarket", METRICS)).toEqual(["premarket", "today"]);
    expect(phoneColumns("today", METRICS)).toEqual(["fromOpen", "today"]);
    expect(phoneColumns("today", ["today"])).toEqual(["today"]);
    expect(phoneColumns("rvol", TICKER_COLUMNS)).toEqual(["today", "rvol"]);
  });
});

describe("cells, empty columns, breadth", () => {
  it("intensity = |value| / column max, 0 for unknown / zero / empty column", () => {
    const rows = [th(1, "AI", { today: 2.1 }), th(2, "B", { today: -3 })];
    expect(columnMax(rows, "today")).toBe(3);
    expect(columnMax(rows, "afterHours")).toBe(0);
    expect([cellIntensity(-3, 3), cellIntensity(1.5, 3), cellIntensity(9, 3), cellIntensity(0, 3), cellIntensity(null, 3), cellIntensity(1, 0)]).toEqual([1, 0.5, 1, 0, 0, 0]);
  });

  it("empty columns: visible columns without a single value right now (e.g. from open before 09:30)", () => {
    const pre = [th(1, "AI", { premarket: 1, today: 1 }), th(2, "B", { premarket: -1, today: -1 })];
    expect(emptyColumns(pre, METRICS)).toEqual(["fromOpen", "afterHours"]);
    expect(emptyColumns(pre, ["today"])).toEqual([]);
    expect(emptyColumns([tk("A", { today: 1, gap: 0.5 })], TICKER_COLUMNS)).toEqual(["premarket", "fromOpen", "afterHours", "rvol", "float"]);
    expect(hasValues([], "today")).toBe(false);
  });

  it("breadth: up / down / flat counts and the median, unknown left out", () => {
    expect(breadth([1, -2, 0.5, null, 0, 3])).toEqual({ up: 3, down: 1, flat: 1, total: 5, median: 0.5 });
    expect(breadth([1, -1, 2, -3])).toEqual({ up: 2, down: 2, flat: 0, total: 4, median: 0 });
    expect(breadth([0.123, 0.456]).median).toBe(0.29);
    expect(breadth([null])).toEqual({ up: 0, down: 0, flat: 0, total: 0, median: null });
    expect([breadthColumn("gap"), breadthColumn("rvol"), breadthColumn("float"), breadthColumn("premarket")]).toEqual(["gap", "today", "today", "premarket"]);
  });
});

describe("view, rows, tabs", () => {
  it("visible columns: canonical order, never empty; the last one cannot be switched off", () => {
    expect(visibleColumns({ columns: ["today", "premarket"] })).toEqual(["premarket", "today"]);
    expect(visibleColumns({ columns: [] })).toEqual(METRICS);
    expect(toggleIn(["today"], METRICS, "today")).toEqual(["today"]);
    expect(toggleIn(["today"], METRICS, "premarket")).toEqual(["premarket", "today"]);
    expect(toggleIn(["today", "float"], TICKER_COLUMNS, "gap")).toEqual(["today", "gap", "float"]);
  });

  it("hide / restore a shared theme; shared rows leave hidden ones out", () => {
    expect(setHidden(view({ hidden: [2] }), 5, true).hidden).toEqual([2, 5]);
    expect(setHidden(view({ hidden: [2, 5] }), 2, false).hidden).toEqual([5]);
    expect(sharedRows({ themes: [th(1, "AI"), th(2, "Banks")], view: view({ hidden: [2] }) }).map((r) => [r.key, r.name, r.mine])).toEqual([["b1", "AI", null]]);
  });

  it("a themes board: pinned shared themes, then own themes marked (ids may repeat across the two)", () => {
    const own: PersonalThemeOut = { ...th(1, "My chips", { today: 5 }), kind: "screener", tickers: ["NVDA"], screener: { filters: ["ind_semiconductors"], order: null }, needsFinviz: false, resolvedAt: null };
    const rows = themesBoardRows({ themes: [th(1, "AI", { today: 1 })], personal: [own] });
    expect(rows.map((r) => [r.key, r.name, !!r.mine])).toEqual([["b1", "AI", false], ["p1", "My chips", true]]);
    expect(rows[1]!.mine).toMatchObject({ kind: "screener", tickers: ["NVDA"] });
  });

  it("tabs: values round-trip; ← / → wrap", () => {
    expect([tabValue("shared"), tabValue(7), tabOf("b7"), tabOf("shared"), tabOf("bx")]).toEqual(["shared", "b7", 7, "shared", "shared"]);
    const tabs = ["shared", 3, 9] as const;
    expect([nextTab(tabs, "shared", 1), nextTab(tabs, 9, 1), nextTab(tabs, "shared", -1), nextTab(tabs, 42, 1)]).toEqual([3, "shared", 9, 3]);
  });

  it("«В план дня» date: today until 16:00 NY, then the next session; weekends → Monday", () => {
    expect(planDay(new Date("2026-10-20T14:00:00Z"))).toBe("2026-10-20"); // Tue 10:00 NY
    expect(planDay(new Date("2026-10-20T20:30:00Z"))).toBe("2026-10-21"); // Tue 16:30 NY
    expect(planDay(new Date("2026-10-23T21:00:00Z"))).toBe("2026-10-26"); // Fri 17:00 NY → Mon
    expect(planDay(new Date("2026-10-25T15:00:00Z"))).toBe("2026-10-26"); // Sun
  });

  it("theme tickers = quoted members + missing, unique", () => {
    expect(themeTickerList({ members: [mq("MU", 1, 1), mq("WDC", 1, 1)], missing: ["SNDK", "MU"] })).toEqual(["MU", "WDC", "SNDK"]);
  });
});

describe("misc", () => {
  it("polls only while the market can move", () => {
    expect([pollInterval("pre"), pollInterval("rth"), pollInterval("post"), pollInterval("closed"), pollInterval(undefined)]).toEqual([30_000, 30_000, 30_000, false, false]);
  });

  it("age in seconds, never negative; metric names validated", () => {
    expect(ageSeconds("2026-10-20T15:00:00.000Z", Date.parse("2026-10-20T15:00:12.400Z"))).toBe(12);
    expect(ageSeconds("2026-10-20T15:00:10.000Z", Date.parse("2026-10-20T15:00:00.000Z"))).toBe(0);
    expect(ageSeconds(null, 0)).toBeNull();
    expect(METRICS.every(isMetric)).toBe(true);
    expect(isMetric("gap")).toBe(false);
  });

  it("ticker input and screener input (a pasted URL keeps only f / o; auth dropped; dots allowed)", () => {
    expect(parseTickers("mu, $wdc  stx;MU")).toEqual({ tickers: ["MU", "WDC", "STX"], invalid: [] });
    expect(parseTickers("brk.b x1")).toEqual({ tickers: ["BRK.B"], invalid: ["X1"] });
    const r = parseScreenerInput("https://elite.finviz.com/screener.ashx?v=111&f=sec_energy,cap_large&o=-volume&auth=TOKEN");
    expect(r).toEqual({ ok: true, spec: { filters: ["sec_energy", "cap_large"], order: "-volume" } });
    expect(JSON.stringify(r)).not.toContain("TOKEN");
    expect(parseScreenerInput("sh_relvol_o1.5")).toEqual({ ok: true, spec: { filters: ["sh_relvol_o1.5"], order: null } });
    expect(parseScreenerInput("sec_energy,<x>")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseScreenerInput("  ")).toEqual({ ok: false, reason: "empty" });
  });
});
