/**
 * lib/finviz presets / schedule / cooldown — pure parts: filter parsing, ranking, the screener slots (NY time),
 * the next trading day, the staff refresh cooldown, the enabled switch, snapshot → fundamentals mapping.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setFinvizClientDeps } from "../../finviz/client";
import { fundamentalsFromSnapshot, largeNumberText } from "../../finviz/fundamentals";
import { nextTradingDay, screenerDue } from "../../finviz/jobs";
import { finvizEnabled, parseFilters, presetFilters, rankRows } from "../../finviz/presets";
import { refreshWait, resetRefreshCooldowns, startRefresh } from "../../finviz/refresh";
import { __loadSettingsCache } from "../../settings/registry";
import type { ScreenerRow } from "../../finviz/types";

afterEach(() => { __loadSettingsCache({}); resetRefreshCooldowns(); });

const row = (ticker: string, o: Partial<ScreenerRow> = {}): ScreenerRow => ({
  ticker, company: null, sector: null, price: null, changePct: null, gapPct: null, relVolume: null, volume: null, avgVolume: null,
  float: null, shortFloatPct: null, atr: null, marketCap: null, earningsDate: null, earningsTiming: null, ...o,
});

describe("filters", () => {
  it("parses comma / space separated codes, lower-cases, drops junk and duplicates", () => {
    expect(parseFilters(" geo_usa, SH_PRICE_O2  ta_gap_u4;ta_gap_u4, <script>, a ")).toEqual(["geo_usa", "sh_price_o2", "ta_gap_u4"]);
    expect(parseFilters("")).toEqual([]);
  });

  it("presets read the desk settings", () => {
    expect(presetFilters("gappers")).toContain("ta_gap_u4");
    __loadSettingsCache({ "finviz.gappersFilters": "geo_usa,ta_gap_u10" });
    expect(presetFilters("gappers")).toEqual(["geo_usa", "ta_gap_u10"]);
    expect(presetFilters("earnings_today")).toContain("earningsdate_today");
  });
});

describe("rankRows", () => {
  it("sorts by the preset key desc, nulls last, ties by ticker, keeps max", () => {
    const rows = [row("B", { gapPct: 5 }), row("A", { gapPct: 5 }), row("C", { gapPct: null }), row("D", { gapPct: 12 })];
    expect(rankRows("gappers", rows, 10).map((r) => r.ticker)).toEqual(["D", "A", "B", "C"]);
    expect(rankRows("gappers", rows, 2).map((r) => r.ticker)).toEqual(["D", "A"]);
    expect(rankRows("relvol", [row("X", { relVolume: 2 }), row("Y", { relVolume: 9 })], 5).map((r) => r.ticker)).toEqual(["Y", "X"]);
    expect(rankRows("earnings_today", [row("S", { marketCap: 1e9 }), row("L", { marketCap: 1e12 })], 5)[0].ticker).toBe("L");
  });
});

describe("screenerDue (New York wall clock)", () => {
  // 2026-10-19 is a Monday; EDT = UTC−4
  const at = (hhmm: string, day = "2026-10-19") => new Date(`${day}T${hhmm}:00-04:00`);
  it.each([
    ["06:55", null], ["07:00", "premarket"], ["07:05", "premarket"], ["07:07", null], ["09:30", "premarket"],
    ["09:35", null], ["09:40", null], ["09:45", "rth"], ["10:00", "rth"], ["10:05", null], ["15:45", "rth"],
    ["16:00", "rth"], ["16:15", null],
  ])("%s → %s", (t, want) => {
    expect(screenerDue(at(t))).toBe(want);
  });

  it("weekends never run; winter time (EST) follows NY", () => {
    expect(screenerDue(at("08:00", "2026-10-17"))).toBeNull(); // Saturday
    expect(screenerDue(new Date("2026-12-07T08:00:00-05:00"))).toBe("premarket"); // Monday, EST
    expect(screenerDue(new Date("2026-12-07T11:30:00Z"))).toBeNull(); // 06:30 EST (would be 07:30 EDT)
  });
});

describe("nextTradingDay", () => {
  it("skips weekends and closed days", async () => {
    const closed = async (d: string) => ["2026-10-24", "2026-10-25", "2026-10-26"].includes(d);
    expect(await nextTradingDay("2026-10-19", closed)).toBe("2026-10-20");
    expect(await nextTradingDay("2026-10-23", closed)).toBe("2026-10-27");
  });
});

describe("refresh cooldown", () => {
  it("one window per kind; 429 inside it with retryAfterMs", () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as never;
    startRefresh("screener", res, 1_000_000);
    expect(refreshWait("screener", 1_000_000 + 60_000)).toBe(4 * 60_000);
    expect(() => startRefresh("screener", res, 1_000_000 + 60_000)).toThrow(expect.objectContaining({ code: "RATE_LIMITED", status: 429 }));
    expect(headers["Retry-After"]).toBe("240");
    startRefresh("earnings", res, 1_000_000 + 60_000); // other kind: own window
    expect(() => startRefresh("screener", res, 1_000_000 + 5 * 60_000)).not.toThrow();
    __loadSettingsCache({ "finviz.refreshCooldownMinutes": 30 });
    expect(refreshWait("screener", 1_000_000 + 6 * 60_000)).toBe(29 * 60_000);
  });
});

describe("finvizEnabled", () => {
  it("needs the token and the desk switch", () => {
    const restore = setFinvizClientDeps({ token: () => null });
    expect(finvizEnabled()).toBe(false);
    setFinvizClientDeps({ token: () => "t" });
    expect(finvizEnabled()).toBe(true);
    __loadSettingsCache({ "finviz.enabled": false });
    expect(finvizEnabled()).toBe(false);
    restore();
  });
});

describe("snapshot → old fundamentals shape", () => {
  it("formats large numbers like marketDataService and falls back float → shares outstanding", () => {
    expect(largeNumberText(25_800_000_000)).toBe("25.80B");
    expect(largeNumberText(null)).toBeNull();
    const f = fundamentalsFromSnapshot({
      ticker: "ABCD", company: null, sector: "Healthcare", industry: "Biotechnology", country: "USA", marketCap: 45_300_000,
      float: null, shortFloatPct: 12.5, shortRatio: 1, avgVolume: 1_200_000, relVolume: 22.5, atr: 0.42, beta: null,
      earningsDate: null, earningsTiming: null, asOf: "2026-10-19T10:00:00.000Z", sharesOutstanding: 12_100_000, price: 3.85,
    });
    expect(f).toEqual({
      ticker: "ABCD", marketCap: "45.30M", float: "12.10M", sharesOutstanding: "12.10M", shortInterest: 12.5, atr: 0.42,
      relativeVolume: 22.5, beta: null, averageDailyVolume: "1.20M", sector: "Healthcare", industry: "Biotechnology", longName: "ABCD",
    });
  });
});
