/**
 * lib/tradeStrategy — the one strategy derivation (PropReports style) + the IMX mark:
 * boundaries of the IMX window (15:50:00 / 16:00:59 / 16:01:00), OPG / OPGtoDAY / Print, Overnight before MOC, Adjust,
 * OPT, naive ET wall clocks, a custom window; lib/imx tag edits; lib/tradeStrategyStore row derivation from fills.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_IMX_WINDOW, deriveTradeStrategy, entrySecOf, imxWindowOf, inImxWindow, isImxStrategy, nyParts, type StrategyInput } from "../tradeStrategy";
import { withImxTag } from "../imx";
import { deriveRow, strategySig, type StrategyTradeRow } from "../tradeStrategyStore";

// New York is UTC−4 in summer (EDT).
const at = (day: string, hhmmss: string) => new Date(`${day}T${hhmmss}-04:00`).toISOString();
const D = "2026-06-10";
const c = (entry: string | null, exit: string | null, extra: Partial<StrategyInput> = {}) =>
  deriveTradeStrategy({ ticker: "AAPL", date: D, entryAt: entry ? at(D, entry) : null, exitAt: exit ? at(D, exit) : null, ...extra });

describe("IMX window", () => {
  it("default 15:50–16:00, end minute inclusive", () => {
    const w = DEFAULT_IMX_WINDOW;
    expect([w.start, w.end]).toEqual(["15:50", "16:00"]);
    expect(inImxWindow(15 * 3600 + 49 * 60 + 59, w)).toBe(false);
    expect(inImxWindow(15 * 3600 + 50 * 60, w)).toBe(true);
    expect(inImxWindow(16 * 3600, w)).toBe(true);
    expect(inImxWindow(16 * 3600 + 59, w)).toBe(true);
    expect(inImxWindow(16 * 3600 + 60, w)).toBe(false);
  });
  it("parses HH:MM, swaps a reversed pair, falls back on garbage", () => {
    expect(imxWindowOf("15:55", "15:45")).toMatchObject({ start: "15:45", end: "15:55" });
    expect(imxWindowOf("nope", "16:00")).toMatchObject({ start: "15:50", end: "16:00" });
    expect(imxWindowOf("9:30", "9:31")).toMatchObject({ start: "09:30", end: "09:31" });
  });
});

describe("deriveTradeStrategy", () => {
  it("MOC: any fill in 15:50:00–16:00:59 NY", () => {
    expect(c("15:50:00", "15:56:00")).toBe("MOC");
    expect(c("14:00:00", "15:50:00")).toBe("MOC");
    expect(c("14:00:00", "16:00:00")).toBe("MOC");
    expect(c("14:00:00", "16:00:59")).toBe("MOC");
    expect(c("09:30:00", "15:59:58")).toBe("MOC"); // an open trade closed in the auction is an IMX trade too
    expect(c("16:00:00", "17:00:00")).toBe("MOC"); // the closing cross print itself
    expect(c("14:00:00", "15:49:59")).toBe("Day");
    expect(c("14:00:00", "16:01:00")).toBe("AfterMarket");
  });

  it("MOC by a middle fill (a trim inside the window)", () => {
    expect(c("14:00:00", "16:05:00", { fills: [at(D, "14:00:00"), at(D, "15:52:10"), at(D, "16:05:00")] })).toBe("MOC");
    expect(c("14:00:00", "15:40:00", { fills: [at(D, "14:00:00"), at(D, "15:40:00")] })).toBe("Day");
  });

  it("Overnight wins over MOC (held across the close)", () => {
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "15:55:00"), exitAt: at("2026-06-11", "09:31:00") })).toBe("Overnight");
    expect(c("15:55:00", null, { horizon: "overnight" })).toBe("Overnight");
    expect(c("10:00:00", "11:00:00", { exitDate: "2026-06-12" })).toBe("Overnight");
  });

  it("OPG / OPGtoDAY: entry in the opening auction (before 09:31:00)", () => {
    expect(c("09:30:00", "09:45:00")).toBe("OPG");
    expect(c("09:30:59", "10:00:00")).toBe("OPG");
    expect(c("09:30:02", null)).toBe("OPG");
    expect(c("09:30:01", "10:00:01")).toBe("OPGtoDAY");
    expect(c("07:00:00", "13:00:00")).toBe("OPGtoDAY");
    expect(c("09:31:00", "09:45:00")).toBe("Day");
  });

  it("Print: the whole round trip in the pre-market", () => {
    expect(c("08:15:00", "09:20:00")).toBe("Print");
    expect(c("08:15:00", "09:29:59")).toBe("Print");
    expect(c("08:15:00", "09:30:00")).toBe("OPG");
  });

  it("AfterMarket: post-market entry", () => {
    expect(c("16:01:00", "17:00:00")).toBe("AfterMarket");
    expect(c("18:30:00", "19:00:00")).toBe("AfterMarket");
  });

  it("OPT first, Adjust on a zero size / price", () => {
    expect(deriveTradeStrategy({ ticker: "AAPL261016C00230000", horizon: "overnight", qty: 0 })).toBe("OPT");
    expect(c("15:55:00", "15:56:00", { qty: 0 })).toBe("Adjust");
    expect(c("10:00:00", "11:00:00", { entry: "0" })).toBe("Adjust");
    expect(c("10:00:00", "11:00:00", { qty: null, entry: "" })).toBe("Day");
  });

  it("session fallback without fill times", () => {
    expect(deriveTradeStrategy({ ticker: "X", session: "premarket" })).toBe("OPG");
    expect(deriveTradeStrategy({ ticker: "X", session: "postmarket" })).toBe("AfterMarket");
    expect(deriveTradeStrategy({ ticker: "X" })).toBe("Day");
  });

  it("reads naive broker wall clocks as New York time (never through the server zone)", () => {
    expect(nyParts("2026-01-15 15:52:00")).toEqual({ date: "2026-01-15", sec: 15 * 3600 + 52 * 60 });
    expect(deriveTradeStrategy({ ticker: "X", entryAt: "2026-01-15T10:00:00", exitAt: "2026-01-15T15:50:00" })).toBe("MOC");
    expect(entrySecOf({ entryAt: "2026-01-15T09:45:30" })).toBe(9 * 3600 + 45 * 60 + 30);
  });

  it("a custom window moves the rule", () => {
    const w = imxWindowOf("15:30", "15:45");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "14:00:00"), exitAt: at(D, "15:40:00") }, w)).toBe("MOC");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "14:00:00"), exitAt: at(D, "15:52:00") }, w)).toBe("Day");
    expect(isImxStrategy("MOC")).toBe(true);
    expect(isImxStrategy("Day")).toBe(false);
  });
});

describe("IMX tag (lib/imx withImxTag)", () => {
  it("adds once, keeps the other tags, removes when no longer IMX", () => {
    expect(withImxTag(null, true)).toBe("IMX");
    expect(withImxTag("FOMO, A+", true)).toBe("FOMO, A+, IMX");
    expect(withImxTag("imx, FOMO", true)).toBe("imx, FOMO");
    expect(withImxTag("FOMO, IMX", false)).toBe("FOMO");
    expect(withImxTag("IMX", false)).toBeNull();
    expect(withImxTag(" ,FOMO ,", false)).toBe("FOMO");
  });
});

describe("tradeStrategyStore deriveRow", () => {
  const row = (over: Partial<StrategyTradeRow> = {}): StrategyTradeRow => ({
    id: 1, ticker: "AAPL", session: "regular", date: D, exit_date: null, horizon: "intraday", qty: 100, entry: 10,
    tags: "ORB", opened_at: `${D}T14:00:00`, closed_at: `${D}T15:40:00`, strategy: null, entry_sec: null, ...over,
  });
  it("fills win over the snapshot; an exit fill in the window makes an IMX trade with the tag", () => {
    const up = deriveRow(row(), [
      { trade_id: 1, kind: "entry", executed_at: new Date(at(D, "13:00:00")) },
      { trade_id: 1, kind: "exit", executed_at: new Date(at(D, "15:59:59")) },
    ], DEFAULT_IMX_WINDOW);
    expect(up).toEqual({ id: 1, strategy: "MOC", entrySec: 13 * 3600, tags: "ORB, IMX" });
  });
  it("without fills the broker openedAt / closedAt decide; a non-IMX trade loses a stale IMX tag", () => {
    expect(deriveRow(row({ tags: "ORB, IMX" }), [], DEFAULT_IMX_WINDOW)).toEqual({ id: 1, strategy: "Day", entrySec: 14 * 3600, tags: "ORB" });
  });
  it("the signature carries the rule version and the window", () => {
    expect(strategySig(DEFAULT_IMX_WINDOW)).toBe("v1|15:50-16:00");
  });
});
