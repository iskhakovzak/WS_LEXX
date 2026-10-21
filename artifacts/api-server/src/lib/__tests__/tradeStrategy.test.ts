/**
 * lib/tradeStrategy — the one strategy derivation (owner set 2026-10-21) + the IMX mark:
 * boundaries of the IMX window (15:50:00 / 16:00:59 / 16:01:00); pre-market entry 09:29:59 vs 09:30:00; OPG / Print /
 * OPGtoDAY by the exit (09:29:59 / 09:30:00 / 09:30:01 / 09:30:02, the desk cluster before 09:45:00); regular entry MOC /
 * AfterMarket / Day; IMX apart from the strategy; Overnight vs Swing by trading days (Friday → Monday / Tuesday,
 * holidays); Adjust, OPT, naive ET wall clocks, a custom window; lib/imx tag edits; lib/tradeStrategyStore row derivation.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMX_WINDOW, PRINT_CLUSTER_MIN_TRADERS, PRINT_CLUSTER_UNTIL_SEC, PRINT_REPORT_LAG_SEC, TRADE_STRATEGIES, deriveTradeStrategy,
  entrySecOf, imxWindowOf, inImxWindow, isImxTrade, nyParts, tradingDaysAfter, type StrategyInput,
} from "../tradeStrategy";
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
  it("constants and the display order", () => {
    expect([PRINT_REPORT_LAG_SEC, PRINT_CLUSTER_MIN_TRADERS, PRINT_CLUSTER_UNTIL_SEC]).toEqual([1, 3, 9 * 3600 + 45 * 60]);
    expect(TRADE_STRATEGIES).toEqual(["OPG", "Print", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing", "Adjust", "OPT"]);
  });

  it("pre-market entry (before 09:30:00) vs an entry at the print", () => {
    expect(c("09:29:59", "09:30:00")).toBe("Print");
    expect(c("09:30:00", "09:30:00")).toBe("Day");
    expect(c("09:29:59", "11:00:00")).toBe("OPGtoDAY");
    expect(c("09:30:00", "11:00:00")).toBe("Day");
  });

  it("OPG: the pre-market round trip (exit before 09:30:00), or no exit time", () => {
    expect(c("08:15:00", "09:20:00")).toBe("OPG");
    expect(c("04:00:00", "09:29:59")).toBe("OPG");
    expect(c("08:15:00", null)).toBe("OPG");
  });

  it("Print: closed by the opening cross, exit in [09:30:00, 09:30:01]", () => {
    expect(c("08:15:00", "09:30:00")).toBe("Print");
    expect(c("08:15:00", "09:30:01")).toBe("Print");
    expect(c("08:15:00", "09:30:02")).toBe("OPGtoDAY");
  });

  it("Print: the desk cluster (NYSE auction) counts only before 09:45:00", () => {
    const cl = { isOpenPrintCluster: true };
    expect(c("08:15:00", "09:30:02", cl)).toBe("Print");
    expect(c("08:15:00", "09:44:59", cl)).toBe("Print");
    expect(c("08:15:00", "09:45:00", cl)).toBe("OPGtoDAY");
    expect(c("08:15:00", "09:31:10", { isOpenPrintCluster: false })).toBe("OPGtoDAY");
    expect(c("09:30:00", "09:31:10", cl)).toBe("Day"); // the cluster needs a pre-market entry
  });

  it("OPGtoDAY: a pre-market entry closed later the same day — the close auction and the after-market too", () => {
    expect(c("07:00:00", "13:00:00")).toBe("OPGtoDAY");
    expect(c("07:00:00", "15:55:00")).toBe("OPGtoDAY");
    expect(c("07:00:00", "16:00:30")).toBe("OPGtoDAY");
    expect(c("07:00:00", "19:30:00")).toBe("OPGtoDAY");
    expect(isImxTrade({ entryAt: at(D, "07:00:00"), exitAt: at(D, "15:55:00") })).toBe(true); // OPGtoDAY + IMX
  });

  it("regular-session entry: MOC on any fill in 15:50:00–16:00:59, AfterMarket from 16:01:00, else Day", () => {
    expect(c("15:50:00", "15:56:00")).toBe("MOC");
    expect(c("14:00:00", "15:50:00")).toBe("MOC");
    expect(c("14:00:00", "16:00:00")).toBe("MOC");
    expect(c("14:00:00", "16:00:59")).toBe("MOC");
    expect(c("09:30:00", "15:59:58")).toBe("MOC");
    expect(c("14:00:00", "15:49:59")).toBe("Day");
    expect(c("14:00:00", "16:01:00")).toBe("AfterMarket");
    expect(c("09:31:00", "09:45:00")).toBe("Day");
  });

  it("MOC by a middle fill (a trim inside the window)", () => {
    expect(c("14:00:00", "16:05:00", { fills: [at(D, "14:00:00"), at(D, "15:52:10"), at(D, "16:05:00")] })).toBe("MOC");
    expect(c("14:00:00", "15:40:00", { fills: [at(D, "14:00:00"), at(D, "15:40:00")] })).toBe("Day");
  });

  it("AfterMarket: after-market entry (≥ 16:00:00), IMX when a fill is in the window", () => {
    expect(c("16:01:00", "17:00:00")).toBe("AfterMarket");
    expect(c("18:30:00", "19:00:00")).toBe("AfterMarket");
    expect(c("16:00:00", "17:00:00")).toBe("AfterMarket");
    expect(isImxTrade({ entryAt: at(D, "16:00:00"), exitAt: at(D, "17:00:00") })).toBe(true);
  });

  it("IMX is apart from the strategy: any fill in the window", () => {
    expect(isImxTrade({ entryAt: at(D, "14:00:00"), exitAt: at(D, "15:49:59") })).toBe(false);
    expect(isImxTrade({ entryAt: at(D, "14:00:00"), exitAt: at(D, "16:01:00") })).toBe(false);
    expect(isImxTrade({ entryAt: at(D, "14:00:00"), exitAt: at(D, "16:01:00"), fills: [at(D, "15:51:00")] })).toBe(true);
    expect(isImxTrade({ entryAt: at(D, "15:55:00"), exitAt: at("2026-06-11", "09:31:00") })).toBe(true); // Overnight + IMX
  });

  it("Overnight: exit on the next trading day, any session; Swing: 2+ trading days", () => {
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "15:55:00"), exitAt: at("2026-06-11", "09:31:00") })).toBe("Overnight");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "07:00:00"), exitAt: at("2026-06-11", "19:00:00") })).toBe("Overnight");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "18:00:00"), exitAt: at("2026-06-11", "05:00:00") })).toBe("Overnight");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "10:00:00"), exitAt: at("2026-06-12", "10:00:00") })).toBe("Swing");
    // Friday → Monday = the next trading day; Friday → Tuesday = 2
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at("2026-06-12", "15:00:00"), exitAt: at("2026-06-15", "10:00:00") })).toBe("Overnight");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at("2026-06-12", "15:00:00"), exitAt: at("2026-06-16", "10:00:00") })).toBe("Swing");
  });

  it("holidays come from the market calendar (Thursday → Monday over Friday 2026-07-03)", () => {
    const t: StrategyInput = { ticker: "X", entryAt: at("2026-07-02", "15:00:00"), exitAt: at("2026-07-06", "10:00:00") };
    expect(deriveTradeStrategy(t)).toBe("Swing");
    expect(deriveTradeStrategy(t, DEFAULT_IMX_WINDOW, new Set(["2026-07-03"]))).toBe("Overnight");
    expect(tradingDaysAfter("2026-07-02", "2026-07-06", new Set(["2026-07-03"]))).toBe(1);
    expect(tradingDaysAfter("2026-06-12", "2026-06-15")).toBe(1);
    expect(tradingDaysAfter("2026-06-12", "2026-06-12")).toBe(0);
  });

  it("stored dates and horizon without fill times", () => {
    expect(deriveTradeStrategy({ ticker: "X", date: D, exitDate: "2026-06-11" })).toBe("Overnight");
    expect(deriveTradeStrategy({ ticker: "X", date: D, exitDate: "2026-06-12" })).toBe("Swing");
    expect(c("10:00:00", "11:00:00", { exitDate: "2026-06-12" })).toBe("Swing");
    expect(c("15:55:00", null, { horizon: "overnight" })).toBe("Overnight");
    expect(c("10:00:00", "11:00:00", { horizon: "swing" })).toBe("Swing");
  });

  it("OPT first, Adjust on a zero size / price", () => {
    expect(deriveTradeStrategy({ ticker: "AAPL261016C00230000", horizon: "overnight", qty: 0 })).toBe("OPT");
    expect(c("15:55:00", "15:56:00", { qty: 0 })).toBe("Adjust");
    expect(c("10:00:00", "11:00:00", { entry: "0" })).toBe("Adjust");
    expect(c("10:00:00", "11:00:00", { qty: null, entry: "" })).toBe("Day");
  });

  it("session fallback without an entry time", () => {
    expect(deriveTradeStrategy({ ticker: "X", session: "premarket" })).toBe("OPG");
    expect(deriveTradeStrategy({ ticker: "X", session: "postmarket" })).toBe("AfterMarket");
    expect(deriveTradeStrategy({ ticker: "X" })).toBe("Day");
    expect(deriveTradeStrategy({ ticker: "X", exitAt: at(D, "15:55:00") })).toBe("MOC");
  });

  it("reads naive broker wall clocks as New York time (never through the server zone)", () => {
    expect(nyParts("2026-01-15 15:52:00")).toEqual({ date: "2026-01-15", sec: 15 * 3600 + 52 * 60 });
    expect(deriveTradeStrategy({ ticker: "X", entryAt: "2026-01-15T10:00:00", exitAt: "2026-01-15T15:50:00" })).toBe("MOC");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: "2026-10-16T09:27:41", exitAt: "2026-10-16T09:30:00" })).toBe("Print");
    expect(entrySecOf({ entryAt: "2026-01-15T09:45:30" })).toBe(9 * 3600 + 45 * 60 + 30);
  });

  it("a custom window moves the rule", () => {
    const w = imxWindowOf("15:30", "15:45");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "14:00:00"), exitAt: at(D, "15:40:00") }, w)).toBe("MOC");
    expect(deriveTradeStrategy({ ticker: "X", entryAt: at(D, "14:00:00"), exitAt: at(D, "15:52:00") }, w)).toBe("Day");
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
    expect(up).toEqual({ id: 1, strategy: "MOC", isImx: true, entrySec: 13 * 3600, tags: "ORB, IMX" });
  });
  it("a pre-market entry closed in the auction: OPGtoDAY + IMX", () => {
    const up = deriveRow(row(), [
      { trade_id: 1, kind: "entry", executed_at: new Date(at(D, "08:00:00")) },
      { trade_id: 1, kind: "exit", executed_at: new Date(at(D, "16:00:02")) },
    ], DEFAULT_IMX_WINDOW);
    expect(up).toEqual({ id: 1, strategy: "OPGtoDAY", isImx: true, entrySec: 8 * 3600, tags: "ORB, IMX" });
  });
  it("the cluster flag reaches the derivation", () => {
    const r = row({ opened_at: `${D}T09:10:00`, closed_at: `${D}T09:33:12` });
    expect(deriveRow(r, [], DEFAULT_IMX_WINDOW).strategy).toBe("OPGtoDAY");
    expect(deriveRow(r, [], DEFAULT_IMX_WINDOW, true).strategy).toBe("Print");
  });
  it("without fills the broker openedAt / closedAt decide; a non-IMX trade loses a stale IMX tag", () => {
    expect(deriveRow(row({ tags: "ORB, IMX" }), [], DEFAULT_IMX_WINDOW)).toEqual({ id: 1, strategy: "Day", isImx: false, entrySec: 14 * 3600, tags: "ORB" });
  });
  it("the signature carries the rule version and the window", () => {
    expect(strategySig(DEFAULT_IMX_WINDOW)).toBe("v4|15:50-16:00");
  });
});
